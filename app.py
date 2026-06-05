#!/usr/bin/env python3
"""听迹 Tunenote — Flask 后端

纯 Web 服务：部署在 Linux 服务器上，手机/电脑通过浏览器访问。
所有数据存储在 TUNENOTE_DATA 目录下（默认 ./data），包括：
  - tunenote.db（SQLite 数据库）
  - covers/（封面缓存）

前端通过 REST API 驱动，未来做客户端只需对接同一组 API。
"""

import os
import sys
import json
import hashlib
import sqlite3
import threading
import time
from datetime import datetime
from pathlib import Path
from io import BytesIO

from flask import (Flask, jsonify, request, send_file, send_from_directory,
                   Response, render_template, abort)
import requests as req_lib
from concurrent.futures import ThreadPoolExecutor, as_completed

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get('TUNENOTE_DATA', str(BASE / 'data')))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / 'tunenote.db'
COVERS_DIR = DATA_DIR / 'covers'
COVERS_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(__name__,
            static_folder=str(BASE / 'static'),
            template_folder=str(BASE / 'templates'))
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.jinja_env.auto_reload = True

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def init_db():
    conn = get_db()
    c = conn.cursor()

    c.executescript('''
        CREATE TABLE IF NOT EXISTS local_tracks (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            path         TEXT NOT NULL UNIQUE,
            title        TEXT DEFAULT '',
            artist       TEXT DEFAULT '',
            album        TEXT DEFAULT '',
            album_artist TEXT DEFAULT '',
            track_no     INTEGER,
            disc_no      INTEGER,
            year         INTEGER,
            genre        TEXT DEFAULT '',
            duration_ms  INTEGER DEFAULT 0,
            bitrate      INTEGER,
            sample_rate  INTEGER,
            channels     INTEGER,
            file_size    INTEGER,
            cover_hash   TEXT,
            added_at     TEXT DEFAULT (datetime('now','localtime')),
            last_played  TEXT,
            play_count   INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS online_tracks (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            source        TEXT NOT NULL,
            source_id     TEXT,
            source_meta   TEXT,
            title         TEXT NOT NULL,
            artist        TEXT DEFAULT '',
            album         TEXT DEFAULT '',
            duration_ms   INTEGER DEFAULT 0,
            cover_url     TEXT,
            default_quality TEXT,
            url_cache     TEXT,
            url_cache_at  TEXT,
            url_cache_q   TEXT,
            lyric_cache   TEXT,
            added_at      TEXT DEFAULT (datetime('now','localtime')),
            last_played   TEXT,
            play_count    INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS tags (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL UNIQUE,
            color      TEXT DEFAULT '',
            kind       TEXT DEFAULT 'user',
            rule_json  TEXT,
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS track_tags (
            track_kind TEXT NOT NULL CHECK (track_kind IN ('local','online')),
            track_id   INTEGER NOT NULL,
            tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            added_at   TEXT DEFAULT (datetime('now','localtime')),
            PRIMARY KEY (track_kind, track_id, tag_id)
        );

        CREATE TABLE IF NOT EXISTS playlists (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            kind       TEXT NOT NULL DEFAULT 'mixed',
            cover_path TEXT,
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS playlist_items (
            playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            position    INTEGER NOT NULL,
            track_kind  TEXT NOT NULL CHECK (track_kind IN ('local','online')),
            track_id    INTEGER NOT NULL,
            PRIMARY KEY (playlist_id, position)
        );

        CREATE TABLE IF NOT EXISTS play_history (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            played_at       TEXT DEFAULT (datetime('now','localtime')),
            track_kind      TEXT NOT NULL,
            track_id        INTEGER NOT NULL,
            duration_played INTEGER NOT NULL,
            completed       INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS custom_sources (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT NOT NULL,
            description  TEXT DEFAULT '',
            version      TEXT,
            author       TEXT,
            homepage     TEXT,
            raw_script   TEXT NOT NULL,
            sources_json TEXT,
            enabled      INTEGER DEFAULT 1,
            installed_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at   TEXT
        );

        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_local_artist ON local_tracks(artist);
        CREATE INDEX IF NOT EXISTS idx_local_album  ON local_tracks(album);
        CREATE INDEX IF NOT EXISTS idx_local_added  ON local_tracks(added_at);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_online_src ON online_tracks(source, source_id);
        CREATE INDEX IF NOT EXISTS idx_online_added ON online_tracks(added_at);
        CREATE INDEX IF NOT EXISTS idx_tt_tag   ON track_tags(tag_id);
        CREATE INDEX IF NOT EXISTS idx_tt_track ON track_tags(track_kind, track_id);
        CREATE INDEX IF NOT EXISTS idx_history_at ON play_history(played_at);
    ''')

    # Default settings
    defaults = {
        'theme': 'dark',
        'ui_style': 'liquid-glass',
        'color_scheme': 'extract',
        'wallpaper': 'aurora',
        'wallpaper_url': '',
        'card_size': '80',
        'card_opacity': '100',
        'card_blur': '48',
        'card_brightness': '104',
        'card_saturation': '180',
        'card_radius': '26',
        'card_aspect': '150',
        'card_item_tint': '0',
        'font_size': '14',
        'font_weight': '400',
        'font_family': 'system',
        'scan_folders': '[]',
        'auto_scan_on_start': 'true',
        'default_quality_online': '320k',
        'quality_fallback_order': 'flac,flac24bit,320k,128k',
        'volume': '80',
        'repeat_mode': 'none',
        'shuffle': 'false',
        'lyric_show_translation': 'true',
        'proxy_allow_outbound': 'true',
        'last_playing': '',
    }
    for k, v in defaults.items():
        c.execute('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)', (k, v))
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# Scan engine
# ---------------------------------------------------------------------------
AUDIO_EXTS = {'.mp3','.flac','.m4a','.aac','.ogg','.opus','.wav','.wv','.aiff','.ape','.wma'}
_scan_lock = threading.Lock()
_scan_progress = {'running': False, 'total': 0, 'done': 0, 'current': ''}


def _extract_cover(audio_file, path_str):
    """Extract cover art, save as webp to COVERS_DIR, return hash or None."""
    try:
        from mutagen import File as MFile
        from PIL import Image
        mf = MFile(path_str)
        if mf is None:
            return None
        data = None
        # ID3 (mp3)
        if hasattr(mf, 'tags') and mf.tags:
            for k in mf.tags:
                if k.startswith('APIC'):
                    data = mf.tags[k].data
                    break
        # FLAC
        if data is None and hasattr(mf, 'pictures') and mf.pictures:
            data = mf.pictures[0].data
        # MP4/M4A
        if data is None and hasattr(mf, 'tags') and mf.tags and 'covr' in mf.tags:
            data = bytes(mf.tags['covr'][0])
        if not data:
            return None
        h = hashlib.md5(data).hexdigest()
        out = COVERS_DIR / f'{h}.webp'
        if not out.exists():
            img = Image.open(BytesIO(data))
            img = img.convert('RGB')
            img.thumbnail((512, 512), Image.LANCZOS)
            img.save(str(out), 'WEBP', quality=85)
        return h
    except Exception:
        return None


def _scan_folder(folder, conn):
    """Scan a single folder tree, upsert tracks."""
    import mutagen
    folder = Path(folder)
    if not folder.is_dir():
        return
    files = [p for p in folder.rglob('*') if p.suffix.lower() in AUDIO_EXTS and p.is_file()]
    _scan_progress['total'] += len(files)
    for p in files:
        path_str = str(p)
        _scan_progress['current'] = p.name
        try:
            st = p.stat()
            existing = conn.execute(
                'SELECT id, file_size FROM local_tracks WHERE path=?', (path_str,)
            ).fetchone()
            if existing and existing['file_size'] == st.st_size:
                _scan_progress['done'] += 1
                continue
            mf = mutagen.File(path_str, easy=True)
            if mf is None:
                _scan_progress['done'] += 1
                continue
            info = mf.info if hasattr(mf, 'info') else None
            duration_ms = int((info.length if info else 0) * 1000)
            bitrate = int(getattr(info, 'bitrate', 0) / 1000) if info else 0
            sample_rate = getattr(info, 'sample_rate', 0) if info else 0
            channels = getattr(info, 'channels', 0) if info else 0
            tags = mf.tags or {}
            get = lambda k: (tags.get(k, [''])[0] if isinstance(tags.get(k), list) else tags.get(k, '')) or ''
            title = get('title') or p.stem
            artist = get('artist')
            album = get('album')
            album_artist = get('albumartist') or get('album_artist')
            genre = get('genre')
            year_raw = get('date') or get('year')
            year = None
            if year_raw:
                try:
                    year = int(str(year_raw)[:4])
                except (ValueError, TypeError):
                    pass
            track_no = None
            tn = get('tracknumber')
            if tn:
                try:
                    track_no = int(str(tn).split('/')[0])
                except (ValueError, TypeError):
                    pass
            disc_no = None
            dn = get('discnumber')
            if dn:
                try:
                    disc_no = int(str(dn).split('/')[0])
                except (ValueError, TypeError):
                    pass
            cover_hash = _extract_cover(mf, path_str)
            if existing:
                conn.execute('''UPDATE local_tracks SET
                    title=?, artist=?, album=?, album_artist=?, track_no=?, disc_no=?,
                    year=?, genre=?, duration_ms=?, bitrate=?, sample_rate=?, channels=?,
                    file_size=?, cover_hash=?
                    WHERE id=?''',
                    (title, artist, album, album_artist, track_no, disc_no,
                     year, genre, duration_ms, bitrate, sample_rate, channels,
                     st.st_size, cover_hash, existing['id']))
            else:
                conn.execute('''INSERT INTO local_tracks
                    (path, title, artist, album, album_artist, track_no, disc_no,
                     year, genre, duration_ms, bitrate, sample_rate, channels,
                     file_size, cover_hash)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                    (path_str, title, artist, album, album_artist, track_no, disc_no,
                     year, genre, duration_ms, bitrate, sample_rate, channels,
                     st.st_size, cover_hash))
            conn.commit()
        except Exception as e:
            print(f'scan error {path_str}: {e}', file=sys.stderr)
        _scan_progress['done'] += 1


def run_scan(folders=None):
    if not _scan_lock.acquire(blocking=False):
        return
    try:
        _scan_progress.update(running=True, total=0, done=0, current='')
        conn = get_db()
        if folders is None:
            s = conn.execute("SELECT value FROM settings WHERE key='scan_folders'").fetchone()
            folders = json.loads(s['value']) if s else []
        for folder in folders:
            _scan_folder(folder, conn)
        # Remove tracks whose files no longer exist
        all_tracks = conn.execute('SELECT id, path FROM local_tracks').fetchall()
        gone = [t['id'] for t in all_tracks if not Path(t['path']).exists()]
        if gone:
            conn.executemany('DELETE FROM local_tracks WHERE id=?', [(i,) for i in gone])
            conn.commit()
        conn.close()
    finally:
        _scan_progress['running'] = False
        _scan_lock.release()


# ---------------------------------------------------------------------------
# Routes — Pages
# ---------------------------------------------------------------------------
@app.route('/')
def index():
    return render_template('index.html')


# ---------------------------------------------------------------------------
# Routes — Settings
# ---------------------------------------------------------------------------
@app.route('/api/settings', methods=['GET'])
def get_settings():
    conn = get_db()
    rows = conn.execute('SELECT key, value FROM settings').fetchall()
    conn.close()
    return jsonify({r['key']: r['value'] for r in rows})


@app.route('/api/settings', methods=['PUT'])
def update_settings():
    d = request.json
    conn = get_db()
    for k, v in d.items():
        conn.execute('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', (k, str(v)))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/settings/defaults')
def get_defaults():
    """Return the default settings for reset-to-default UI."""
    defaults = {
        'theme': 'dark', 'ui_style': 'liquid-glass', 'color_scheme': 'extract',
        'wallpaper': 'aurora', 'wallpaper_url': '',
        'card_size': '80', 'card_opacity': '100', 'card_blur': '48',
        'card_brightness': '104', 'card_saturation': '180', 'card_radius': '26',
        'card_aspect': '150', 'card_item_tint': '0',
        'font_size': '14', 'font_weight': '400', 'font_family': 'system',
        'default_quality_online': '320k',
        'quality_fallback_order': 'flac,flac24bit,320k,128k',
        'volume': '80', 'repeat_mode': 'none', 'shuffle': 'false',
        'lyric_show_translation': 'true', 'proxy_allow_outbound': 'true',
    }
    return jsonify(defaults)


# ---------------------------------------------------------------------------
# Routes — Local tracks
# ---------------------------------------------------------------------------
@app.route('/api/local/tracks')
def list_local_tracks():
    conn = get_db()
    q = request.args.get('q', '').strip()
    sort = request.args.get('sort', 'added_at')
    order = request.args.get('order', 'desc')
    allowed_sorts = {'title','artist','album','added_at','duration_ms','play_count'}
    if sort not in allowed_sorts:
        sort = 'added_at'
    if order not in ('asc','desc'):
        order = 'desc'
    if q:
        like = f'%{q}%'
        rows = conn.execute(
            f'SELECT * FROM local_tracks WHERE title LIKE ? OR artist LIKE ? OR album LIKE ? ORDER BY {sort} {order}',
            (like, like, like)
        ).fetchall()
    else:
        rows = conn.execute(f'SELECT * FROM local_tracks ORDER BY {sort} {order}').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/local/tracks/<int:tid>')
def get_local_track(tid):
    conn = get_db()
    row = conn.execute('SELECT * FROM local_tracks WHERE id=?', (tid,)).fetchone()
    conn.close()
    if not row:
        abort(404)
    return jsonify(dict(row))


@app.route('/api/local/stream/<int:tid>')
def stream_local(tid):
    conn = get_db()
    row = conn.execute('SELECT path FROM local_tracks WHERE id=?', (tid,)).fetchone()
    conn.close()
    if not row or not Path(row['path']).exists():
        abort(404)
    return send_file(row['path'], conditional=True)


@app.route('/api/local/cover/<cover_hash>')
def get_cover(cover_hash):
    if not cover_hash or len(cover_hash) != 32:
        abort(404)
    path = COVERS_DIR / f'{cover_hash}.webp'
    if not path.exists():
        abort(404)
    return send_file(str(path), mimetype='image/webp')


@app.route('/api/local/albums')
def list_albums():
    conn = get_db()
    rows = conn.execute('''
        SELECT album, album_artist, MIN(cover_hash) as cover_hash,
               COUNT(*) as track_count, MIN(year) as year
        FROM local_tracks WHERE album != ''
        GROUP BY album ORDER BY album
    ''').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/local/artists')
def list_artists():
    conn = get_db()
    rows = conn.execute('''
        SELECT artist, COUNT(*) as track_count, COUNT(DISTINCT album) as album_count
        FROM local_tracks WHERE artist != ''
        GROUP BY artist ORDER BY artist
    ''').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/local/scan', methods=['POST'])
def start_scan():
    d = request.json or {}
    folders = d.get('folders')
    if _scan_progress['running']:
        return jsonify({'error': 'scan_already_running'}), 409
    threading.Thread(target=run_scan, args=(folders,), daemon=True).start()
    return jsonify({'ok': True, 'message': 'scan_started'})


@app.route('/api/local/scan/progress')
def scan_progress():
    return jsonify(_scan_progress)


@app.route('/api/local/tracks/<int:tid>', methods=['DELETE'])
def delete_local_track(tid):
    conn = get_db()
    conn.execute('DELETE FROM local_tracks WHERE id=?', (tid,))
    conn.execute('DELETE FROM track_tags WHERE track_kind=? AND track_id=?', ('local', tid))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ---------------------------------------------------------------------------
# Routes — Tags
# ---------------------------------------------------------------------------
def compile_rule(rule):
    """Compile a smart-tag rule dict into (where_sql, params) over a tracks
    table. Supported leaf rules:
      {"added_within": "7d"}        added_at within N days
      {"play_count_gte": 10}        play_count >= N
      {"play_count_eq": 0}          play_count == N
      {"genre_contains": "jazz"}    genre LIKE %x%  (local only)
      {"and": [...]} / {"or": [...]} combine
    Returns ('1=1', []) for empty/unknown.
    """
    if not rule:
        return '1=1', []
    if 'and' in rule or 'or' in rule:
        op = 'AND' if 'and' in rule else 'OR'
        parts, params = [], []
        for sub in rule.get('and') or rule.get('or'):
            w, p = compile_rule(sub)
            parts.append(f'({w})')
            params.extend(p)
        return (f' {op} '.join(parts) if parts else '1=1'), params
    if 'added_within' in rule:
        days = int(str(rule['added_within']).rstrip('d') or 7)
        return "added_at >= datetime('now','localtime',?)", [f'-{days} days']
    if 'play_count_gte' in rule:
        return 'play_count >= ?', [int(rule['play_count_gte'])]
    if 'play_count_eq' in rule:
        return 'play_count = ?', [int(rule['play_count_eq'])]
    if 'genre_contains' in rule:
        return 'genre LIKE ?', [f"%{rule['genre_contains']}%"]
    return '1=1', []


@app.route('/api/tags')
def list_tags():
    conn = get_db()
    rows = conn.execute('SELECT * FROM tags ORDER BY kind DESC, name').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/tags', methods=['POST'])
def create_tag():
    d = request.json
    conn = get_db()
    cur = conn.execute(
        'INSERT INTO tags (name, color, kind, rule_json) VALUES (?,?,?,?)',
        (d['name'], d.get('color',''), d.get('kind','user'), d.get('rule_json'))
    )
    conn.commit()
    tag = dict(conn.execute('SELECT * FROM tags WHERE id=?', (cur.lastrowid,)).fetchone())
    conn.close()
    return jsonify(tag), 201


@app.route('/api/tags/<int:tid>', methods=['PUT'])
def update_tag(tid):
    d = request.json
    conn = get_db()
    allowed = {'name','color','kind','rule_json'}
    fields = [f'{k}=?' for k in d if k in allowed]
    values = [d[k] for k in d if k in allowed] + [tid]
    if fields:
        conn.execute(f'UPDATE tags SET {",".join(fields)} WHERE id=?', values)
        conn.commit()
    tag = conn.execute('SELECT * FROM tags WHERE id=?', (tid,)).fetchone()
    conn.close()
    return jsonify(dict(tag)) if tag else abort(404)


@app.route('/api/tags/<int:tid>', methods=['DELETE'])
def delete_tag(tid):
    conn = get_db()
    conn.execute('DELETE FROM tags WHERE id=?', (tid,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/tags/<int:tid>/tracks')
def tag_tracks(tid):
    conn = get_db()
    tag = conn.execute('SELECT * FROM tags WHERE id=?', (tid,)).fetchone()
    if not tag:
        conn.close()
        abort(404)
    # Smart tag: compute matching tracks on the fly from the rule
    if tag['kind'] == 'smart' and tag['rule_json']:
        try:
            rule = json.loads(tag['rule_json'])
        except (ValueError, TypeError):
            rule = {}
        where, params = compile_rule(rule)
        local = conn.execute(
            f"SELECT id as track_id, 'local' as track_kind, title, artist, album, "
            f"duration_ms, cover_hash, NULL as cover_url FROM local_tracks WHERE {where} "
            f"ORDER BY added_at DESC", params
        ).fetchall()
        # play_count / added_within rules also apply to online tracks
        online = conn.execute(
            f"SELECT id as track_id, 'online' as track_kind, title, artist, album, "
            f"duration_ms, NULL as cover_hash, cover_url FROM online_tracks WHERE {where} "
            f"ORDER BY added_at DESC", params
        ).fetchall() if 'genre' not in where else []
        conn.close()
        return jsonify([dict(r) for r in (list(local) + list(online))])
    rows = conn.execute('''
        SELECT tt.track_kind, tt.track_id,
               CASE tt.track_kind
                 WHEN 'local' THEN lt.title
                 WHEN 'online' THEN ot.title
               END as title,
               CASE tt.track_kind
                 WHEN 'local' THEN lt.artist
                 WHEN 'online' THEN ot.artist
               END as artist,
               CASE tt.track_kind
                 WHEN 'local' THEN lt.album
                 WHEN 'online' THEN ot.album
               END as album,
               CASE tt.track_kind
                 WHEN 'local' THEN lt.duration_ms
                 WHEN 'online' THEN ot.duration_ms
               END as duration_ms,
               CASE tt.track_kind
                 WHEN 'local' THEN lt.cover_hash
                 ELSE NULL
               END as cover_hash,
               CASE tt.track_kind
                 WHEN 'online' THEN ot.cover_url
                 ELSE NULL
               END as cover_url
        FROM track_tags tt
        LEFT JOIN local_tracks lt ON tt.track_kind='local' AND tt.track_id=lt.id
        LEFT JOIN online_tracks ot ON tt.track_kind='online' AND tt.track_id=ot.id
        WHERE tt.tag_id=?
    ''', (tid,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/tracks/<kind>/<int:tid>/tags', methods=['PUT'])
def set_track_tags(kind, tid):
    if kind not in ('local','online'):
        abort(400)
    d = request.json
    tag_ids = d.get('tag_ids', [])
    conn = get_db()
    conn.execute('DELETE FROM track_tags WHERE track_kind=? AND track_id=?', (kind, tid))
    for tag_id in tag_ids:
        conn.execute('INSERT INTO track_tags (track_kind, track_id, tag_id) VALUES (?,?,?)',
                     (kind, tid, tag_id))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/tracks/<kind>/<int:tid>/tags', methods=['GET'])
def get_track_tags(kind, tid):
    if kind not in ('local','online'):
        abort(400)
    conn = get_db()
    rows = conn.execute('''
        SELECT t.* FROM tags t
        JOIN track_tags tt ON tt.tag_id=t.id
        WHERE tt.track_kind=? AND tt.track_id=?
    ''', (kind, tid)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# ---------------------------------------------------------------------------
# Routes — Play history
# ---------------------------------------------------------------------------
@app.route('/api/history')
def get_history():
    conn = get_db()
    limit = min(int(request.args.get('limit', 100)), 500)
    date = request.args.get('date')
    if date:
        rows = conn.execute('''
            SELECT ph.*,
              CASE ph.track_kind
                WHEN 'local' THEN lt.title WHEN 'online' THEN ot.title END as title,
              CASE ph.track_kind
                WHEN 'local' THEN lt.artist WHEN 'online' THEN ot.artist END as artist,
              CASE ph.track_kind
                WHEN 'local' THEN lt.cover_hash ELSE NULL END as cover_hash,
              CASE ph.track_kind
                WHEN 'online' THEN ot.cover_url ELSE NULL END as cover_url
            FROM play_history ph
            LEFT JOIN local_tracks lt ON ph.track_kind='local' AND ph.track_id=lt.id
            LEFT JOIN online_tracks ot ON ph.track_kind='online' AND ph.track_id=ot.id
            WHERE date(ph.played_at)=? ORDER BY ph.played_at DESC LIMIT ?
        ''', (date, limit)).fetchall()
    else:
        rows = conn.execute('''
            SELECT ph.*,
              CASE ph.track_kind
                WHEN 'local' THEN lt.title WHEN 'online' THEN ot.title END as title,
              CASE ph.track_kind
                WHEN 'local' THEN lt.artist WHEN 'online' THEN ot.artist END as artist,
              CASE ph.track_kind
                WHEN 'local' THEN lt.cover_hash ELSE NULL END as cover_hash,
              CASE ph.track_kind
                WHEN 'online' THEN ot.cover_url ELSE NULL END as cover_url
            FROM play_history ph
            LEFT JOIN local_tracks lt ON ph.track_kind='local' AND ph.track_id=lt.id
            LEFT JOIN online_tracks ot ON ph.track_kind='online' AND ph.track_id=ot.id
            ORDER BY ph.played_at DESC LIMIT ?
        ''', (limit,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/history', methods=['POST'])
def record_history():
    d = request.json
    if d.get('duration_played', 0) < 5000:
        return jsonify({'ok': False, 'reason': 'too_short'})
    conn = get_db()
    conn.execute(
        'INSERT INTO play_history (track_kind, track_id, duration_played, completed) VALUES (?,?,?,?)',
        (d['track_kind'], d['track_id'], d['duration_played'], d.get('completed', 0))
    )
    # Bump play_count + last_played on the track
    table = 'local_tracks' if d['track_kind'] == 'local' else 'online_tracks'
    conn.execute(
        f"UPDATE {table} SET play_count=play_count+1, last_played=datetime('now','localtime') WHERE id=?",
        (d['track_id'],)
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ---------------------------------------------------------------------------
# Routes — Online tracks
# ---------------------------------------------------------------------------
@app.route('/api/online/tracks')
def list_online_tracks():
    conn = get_db()
    q = request.args.get('q', '').strip()
    sort = request.args.get('sort', 'added_at')
    order = request.args.get('order', 'desc')
    allowed_sorts = {'title','artist','album','added_at','duration_ms','play_count','source'}
    if sort not in allowed_sorts:
        sort = 'added_at'
    if order not in ('asc','desc'):
        order = 'desc'
    if q:
        like = f'%{q}%'
        rows = conn.execute(
            f'SELECT * FROM online_tracks WHERE title LIKE ? OR artist LIKE ? OR album LIKE ? ORDER BY {sort} {order}',
            (like, like, like)
        ).fetchall()
    else:
        rows = conn.execute(f'SELECT * FROM online_tracks ORDER BY {sort} {order}').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/online/tracks/<int:tid>')
def get_online_track(tid):
    conn = get_db()
    row = conn.execute('SELECT * FROM online_tracks WHERE id=?', (tid,)).fetchone()
    conn.close()
    if not row:
        abort(404)
    return jsonify(dict(row))


@app.route('/api/online/tracks', methods=['POST'])
def add_online_track():
    d = request.json
    conn = get_db()
    cur = conn.execute('''INSERT INTO online_tracks
        (source, source_id, source_meta, title, artist, album, duration_ms,
         cover_url, default_quality, url_cache, url_cache_at, url_cache_q)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)''',
        (d.get('source', 'url'), d.get('source_id'),
         d.get('source_meta') if isinstance(d.get('source_meta'), str) else (json.dumps(d.get('source_meta')) if d.get('source_meta') else None),
         d['title'], d.get('artist',''), d.get('album',''),
         d.get('duration_ms', 0), d.get('cover_url'),
         d.get('default_quality'), d.get('url', ''),
         datetime.now().strftime('%Y-%m-%d %H:%M:%S') if d.get('url') else None,
         d.get('default_quality')))
    conn.commit()
    track = dict(conn.execute('SELECT * FROM online_tracks WHERE id=?', (cur.lastrowid,)).fetchone())
    conn.close()
    return jsonify(track), 201


@app.route('/api/online/tracks/<int:tid>', methods=['PUT'])
def update_online_track(tid):
    d = request.json
    conn = get_db()
    allowed = {'title','artist','album','duration_ms','cover_url','default_quality',
               'url_cache','url_cache_at','url_cache_q','lyric_cache','source_meta'}
    fields = [f'{k}=?' for k in d if k in allowed]
    values = [d[k] for k in d if k in allowed] + [tid]
    if fields:
        conn.execute(f'UPDATE online_tracks SET {",".join(fields)} WHERE id=?', values)
        conn.commit()
    track = conn.execute('SELECT * FROM online_tracks WHERE id=?', (tid,)).fetchone()
    conn.close()
    return jsonify(dict(track)) if track else abort(404)


@app.route('/api/online/tracks/<int:tid>', methods=['DELETE'])
def delete_online_track(tid):
    conn = get_db()
    conn.execute('DELETE FROM online_tracks WHERE id=?', (tid,))
    conn.execute('DELETE FROM track_tags WHERE track_kind=? AND track_id=?', ('online', tid))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ---------------------------------------------------------------------------
# Platform search adapters (server-side search for LX-compatible sources)
# ---------------------------------------------------------------------------
# Standard LX custom sources only declare musicUrl — search is the host app's
# job.  These adapters query each platform's public search API and return
# results with source_meta that the source script's musicUrl can consume.
# ---------------------------------------------------------------------------
_SEARCH_UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
              '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36')


def _search_wy(keyword, limit=30):
    """网易云音乐"""
    resp = req_lib.post(
        'https://music.163.com/api/search/get/web',
        data={'s': keyword, 'type': 1, 'offset': 0, 'limit': limit, 'total': 'true'},
        headers={'User-Agent': _SEARCH_UA, 'Referer': 'https://music.163.com',
                 'Content-Type': 'application/x-www-form-urlencoded'},
        timeout=10,
    )
    data = resp.json()
    out = []
    for item in data.get('result', {}).get('songs', []):
        sid = str(item.get('id', ''))
        artists = ', '.join(a.get('name', '') for a in item.get('artists', []))
        album = item.get('album', {})
        img = album.get('picUrl', '') or album.get('blurPicUrl', '')
        if img and '?' not in img:
            img += '?param=300y300'
        meta = {'name': item.get('name', ''), 'singer': artists, 'source': 'wy',
                'songmid': sid, 'albumName': album.get('name', ''),
                'albumId': str(album.get('id', '')), 'img': img}
        out.append({
            'source': 'wy', 'source_id': sid,
            'title': item.get('name', ''), 'artist': artists,
            'album': album.get('name', ''),
            'duration_ms': item.get('duration', 0),
            'cover_url': img,
            'source_meta': json.dumps(meta),
        })
    return out


def _search_kw(keyword, limit=30):
    """酷我音乐 (uses the search.kuwo.cn/r.s endpoint — no CSRF needed)"""
    import re as _re
    resp = req_lib.get(
        'http://search.kuwo.cn/r.s',
        params={'all': keyword, 'ft': 'music', 'rn': str(limit), 'pn': '0',
                'rformat': 'json', 'encoding': 'utf8', 'vipver': 'MUSIC_9.1.0'},
        headers={'User-Agent': _SEARCH_UA},
        timeout=10,
    )
    # Response uses single-quoted pseudo-JSON with HTML entities
    text = resp.text.replace("'", '"').replace('&nbsp;', ' ')
    data = json.loads(text)
    out = []
    for item in data.get('abslist', []):
        musicrid = item.get('MUSICRID', '')
        if musicrid.startswith('MUSIC_'):
            musicrid = musicrid[6:]
        songmid = musicrid or str(item.get('DC_TARGETID', ''))
        artist = item.get('ARTIST', '')
        img = item.get('web_albumpic_short', '') or item.get('hts_MVPIC', '')
        if img and not img.startswith('http'):
            img = 'https://img2.kuwo.cn/star/albumcover/' + img if img else ''
        meta = {'name': item.get('SONGNAME', ''), 'singer': artist,
                'source': 'kw', 'songmid': songmid, 'rid': songmid,
                'albumName': item.get('ALBUM', ''),
                'albumId': item.get('ALBUMID', ''),
                'img': img}
        out.append({
            'source': 'kw', 'source_id': songmid,
            'title': item.get('SONGNAME', ''), 'artist': artist,
            'album': item.get('ALBUM', ''),
            'duration_ms': int(item.get('DURATION', 0)) * 1000,
            'cover_url': img,
            'source_meta': json.dumps(meta),
        })
    return out


def _search_tx(keyword, limit=30):
    """QQ 音乐"""
    resp = req_lib.get(
        'https://c.y.qq.com/soso/fcgi-bin/client_search_cp',
        params={'w': keyword, 'p': 1, 'n': limit, 'format': 'json'},
        headers={'User-Agent': _SEARCH_UA, 'Referer': 'https://y.qq.com'},
        timeout=10,
    )
    data = resp.json()
    out = []
    for item in data.get('data', {}).get('song', {}).get('list', []):
        mid = item.get('songmid', '')
        singer = ', '.join(s.get('name', '') for s in item.get('singer', []))
        album_mid = item.get('albummid', '')
        img = (f'https://y.gtimg.cn/music/photo_new/T002R300x300M000{album_mid}.jpg'
               if album_mid else '')
        meta = {'name': item.get('songname', ''), 'singer': singer, 'source': 'tx',
                'songmid': mid, 'strMediaMid': item.get('strMediaMid', mid),
                'albumName': item.get('albumname', ''),
                'albumId': str(item.get('albumid', '')),
                'albummid': album_mid, 'img': img,
                'interval': item.get('interval', 0),
                'songid': item.get('songid', '')}
        out.append({
            'source': 'tx', 'source_id': mid,
            'title': item.get('songname', ''), 'artist': singer,
            'album': item.get('albumname', ''),
            'duration_ms': item.get('interval', 0) * 1000,
            'cover_url': img,
            'source_meta': json.dumps(meta),
        })
    return out


def _search_kg(keyword, limit=30):
    """酷狗音乐"""
    resp = req_lib.get(
        'http://mobilecdn.kugou.com/api/v3/search/song',
        params={'keyword': keyword, 'page': 1, 'pagesize': limit, 'showtype': 1},
        headers={'User-Agent': _SEARCH_UA},
        timeout=10,
    )
    data = resp.json()
    out = []
    for item in data.get('data', {}).get('info', []):
        h = item.get('hash', '')
        meta = {'name': item.get('songname', ''), 'singer': item.get('singername', ''),
                'source': 'kg', 'songmid': str(item.get('album_audio_id', h)),
                'hash': h, 'sqhash': item.get('sqhash', ''),
                '320hash': item.get('320hash', ''),
                'albumName': item.get('album_name', ''),
                'albumId': str(item.get('album_id', '')), 'img': ''}
        out.append({
            'source': 'kg', 'source_id': h,
            'title': item.get('songname', ''), 'artist': item.get('singername', ''),
            'album': item.get('album_name', ''),
            'duration_ms': item.get('duration', 0) * 1000,
            'cover_url': '',
            'source_meta': json.dumps(meta),
        })
    return out


def _search_mg(keyword, limit=30):
    """咪咕音乐 (MIGUM2.0 search_all API)"""
    resp = req_lib.get(
        'https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/search_all.do',
        params={'ua': 'Android_migu', 'version': '5.0.1', 'text': keyword,
                'pageNo': 1, 'pageSize': limit,
                'searchSwitch': json.dumps({'song': 1})},
        headers={'User-Agent': _SEARCH_UA, 'Referer': 'https://m.music.migu.cn'},
        timeout=10,
    )
    data = resp.json()
    out = []
    for item in data.get('songResultData', {}).get('result', []):
        cid = str(item.get('copyrightId', item.get('id', '')))
        singers = ', '.join(s.get('name', '') for s in item.get('singers', []))
        albums = item.get('albums', [{}])
        album_name = albums[0].get('albumName', '') if albums else ''
        img = ''
        if albums and albums[0].get('albumPicM'):
            img = albums[0]['albumPicM']
            if img.startswith('//'): img = 'https:' + img
        meta = {'name': item.get('name', ''), 'singer': singers,
                'source': 'mg', 'songmid': cid, 'copyrightId': cid,
                'albumName': album_name, 'img': img}
        out.append({
            'source': 'mg', 'source_id': cid,
            'title': item.get('name', ''), 'artist': singers,
            'album': album_name,
            'duration_ms': 0,
            'cover_url': img,
            'source_meta': json.dumps(meta),
        })
    return out


_PLATFORM_SEARCH = {
    'kw': _search_kw, 'wy': _search_wy, 'tx': _search_tx,
    'kg': _search_kg, 'mg': _search_mg,
}


@app.route('/api/online/search')
def online_search():
    """Search music across iTunes + installed LX source platforms.

    Accepts `sources` query param (comma-separated platform keys).
    Runs all platform searches concurrently for low latency.
    """
    keyword = request.args.get('q', '').strip()
    if not keyword:
        return jsonify([])

    sources_param = request.args.get('sources', 'itunes')
    source_list = [s.strip() for s in sources_param.split(',') if s.strip()]

    def _do_itunes():
        r = req_lib.get('https://itunes.apple.com/search', params={
            'term': keyword, 'media': 'music', 'entity': 'song', 'limit': 20,
        }, timeout=10)
        data = r.json()
        out = []
        for item in data.get('results', []):
            art = item.get('artworkUrl100', '').replace('100x100', '300x300')
            out.append({
                'source': 'itunes',
                'source_id': str(item.get('trackId', '')),
                'title': item.get('trackName', ''),
                'artist': item.get('artistName', ''),
                'album': item.get('collectionName', ''),
                'duration_ms': item.get('trackTimeMillis', 0),
                'cover_url': art,
                'url_cache': item.get('previewUrl', ''),
                'is_preview': True,
            })
        return out

    def _do_platform(platform):
        fn = _PLATFORM_SEARCH.get(platform)
        return fn(keyword) if fn else []

    results = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {}
        for src in source_list:
            if src == 'itunes':
                futures[pool.submit(_do_itunes)] = 'itunes'
            elif src in _PLATFORM_SEARCH:
                futures[pool.submit(_do_platform, src)] = src
        for future in as_completed(futures, timeout=15):
            try:
                results.extend(future.result())
            except Exception as e:
                print(f'{futures[future]} search error: {e}', file=sys.stderr)

    return jsonify(results)


@app.route('/api/online/import', methods=['POST'])
def online_import():
    """Import a playlist. Supports LX Music export (.lxmf JSON) and m3u/m3u8."""
    conn = get_db()
    added = 0
    content_type = request.content_type or ''
    if 'application/json' in content_type:
        d = request.json or {}
        # LX Music .lxmf format: { "list": [ {name, singer, source, songmid, ...} ] }
        items = d.get('list') or d.get('tracks') or (d if isinstance(d, list) else [])
        for it in items:
            title = it.get('name') or it.get('title') or ''
            if not title:
                continue
            try:
                conn.execute('''INSERT OR IGNORE INTO online_tracks
                    (source, source_id, source_meta, title, artist, album, cover_url)
                    VALUES (?,?,?,?,?,?,?)''',
                    (it.get('source', 'url'), str(it.get('songmid', '')),
                     json.dumps(it), title,
                     it.get('singer') or it.get('artist', ''),
                     it.get('albumName') or it.get('album', ''),
                     it.get('img') or it.get('cover_url', '')))
                added += 1
            except Exception:
                pass
    else:
        # m3u: lines of URLs, optional #EXTINF:dur,Artist - Title
        text = request.get_data(as_text=True)
        pending_title, pending_artist = '', ''
        for line in text.splitlines():
            line = line.strip()
            if line.startswith('#EXTINF:'):
                meta = line.split(',', 1)
                if len(meta) == 2:
                    name = meta[1].strip()
                    if ' - ' in name:
                        pending_artist, pending_title = name.split(' - ', 1)
                    else:
                        pending_title = name
            elif line and not line.startswith('#'):
                conn.execute('''INSERT OR IGNORE INTO online_tracks
                    (source, title, artist, url_cache) VALUES (?,?,?,?)''',
                    ('url', pending_title or line.split('/')[-1], pending_artist, line))
                added += 1
                pending_title, pending_artist = '', ''
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'added': added})


# ---------------------------------------------------------------------------
# Routes — Custom sources (LX Music compatible)
# ---------------------------------------------------------------------------
@app.route('/api/sources')
def list_sources():
    conn = get_db()
    rows = conn.execute('SELECT id, name, description, version, author, homepage, sources_json, enabled, installed_at, updated_at FROM custom_sources ORDER BY name').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/sources', methods=['POST'])
def install_source():
    import re
    raw = None
    if request.content_type and 'multipart' in request.content_type:
        f = request.files.get('file')
        if f:
            raw = f.read().decode('utf-8', errors='replace')
    else:
        d = request.json or {}
        raw = d.get('raw_script', '')
    if not raw:
        # Try URL import
        url = (request.json or {}).get('url', '') if not (request.content_type and 'multipart' in request.content_type) else ''
        if url:
            try:
                resp = req_lib.get(url, headers={'User-Agent': _SEARCH_UA}, timeout=15)
                resp.raise_for_status()
                raw = resp.text
            except Exception as e:
                return jsonify({'error': f'fetch_failed: {e}'}), 400
    if not raw:
        return jsonify({'error': 'no_script'}), 400
    # Parse JSDoc metadata from ONLY the first comment block (the source's own
    # header). Scripts that bundle libraries (e.g. js-sha256) have their own
    # @name/@version/@author blocks right after — don't let those clobber it.
    end = raw.find('*/')
    header = raw[:end] if 0 < end < 2000 else raw[:2000]
    meta = {}
    for m in re.finditer(r'@(\w+)\s+(.+)', header):
        if m.group(1) not in meta:   # first occurrence wins
            meta[m.group(1)] = m.group(2).strip()
    conn = get_db()
    cur = conn.execute(
        'INSERT INTO custom_sources (name, description, version, author, homepage, raw_script) VALUES (?,?,?,?,?,?)',
        (meta.get('name','未命名源'), meta.get('description',''), meta.get('version',''),
         meta.get('author',''), meta.get('homepage',''), raw))
    conn.commit()
    row = dict(conn.execute('SELECT id, name, description, version, author, homepage, sources_json, enabled, installed_at FROM custom_sources WHERE id=?', (cur.lastrowid,)).fetchone())
    conn.close()
    return jsonify(row), 201


@app.route('/api/sources/<int:sid>', methods=['PUT'])
def update_source(sid):
    d = request.json
    conn = get_db()
    allowed = {'enabled','sources_json','updated_at'}
    fields = [f'{k}=?' for k in d if k in allowed]
    values = [d[k] for k in d if k in allowed] + [sid]
    if fields:
        conn.execute(f'UPDATE custom_sources SET {",".join(fields)} WHERE id=?', values)
        conn.commit()
    row = conn.execute('SELECT id, name, description, version, author, homepage, sources_json, enabled, installed_at, updated_at FROM custom_sources WHERE id=?', (sid,)).fetchone()
    conn.close()
    return jsonify(dict(row)) if row else abort(404)


@app.route('/api/sources/<int:sid>', methods=['DELETE'])
def delete_source(sid):
    conn = get_db()
    conn.execute('DELETE FROM custom_sources WHERE id=?', (sid,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/sources/<int:sid>/script')
def get_source_script(sid):
    conn = get_db()
    row = conn.execute('SELECT raw_script FROM custom_sources WHERE id=?', (sid,)).fetchone()
    conn.close()
    if not row:
        abort(404)
    return Response(row['raw_script'], mimetype='application/javascript')


# ---------------------------------------------------------------------------
# Routes — Playlists (M8)
# ---------------------------------------------------------------------------
@app.route('/api/playlists')
def list_playlists():
    conn = get_db()
    rows = conn.execute('SELECT * FROM playlists ORDER BY created_at DESC').fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d['item_count'] = conn.execute(
            'SELECT COUNT(*) as n FROM playlist_items WHERE playlist_id=?', (r['id'],)
        ).fetchone()['n']
        result.append(d)
    conn.close()
    return jsonify(result)


@app.route('/api/playlists', methods=['POST'])
def create_playlist():
    d = request.json
    conn = get_db()
    cur = conn.execute('INSERT INTO playlists (name, kind) VALUES (?,?)',
                       (d['name'], d.get('kind', 'mixed')))
    conn.commit()
    pl = dict(conn.execute('SELECT * FROM playlists WHERE id=?', (cur.lastrowid,)).fetchone())
    conn.close()
    return jsonify(pl), 201


@app.route('/api/playlists/<int:pid>')
def get_playlist(pid):
    conn = get_db()
    pl = conn.execute('SELECT * FROM playlists WHERE id=?', (pid,)).fetchone()
    if not pl:
        conn.close()
        abort(404)
    items = conn.execute('''
        SELECT pi.position, pi.track_kind, pi.track_id,
               CASE pi.track_kind WHEN 'local' THEN lt.title WHEN 'online' THEN ot.title END as title,
               CASE pi.track_kind WHEN 'local' THEN lt.artist WHEN 'online' THEN ot.artist END as artist,
               CASE pi.track_kind WHEN 'local' THEN lt.album WHEN 'online' THEN ot.album END as album,
               CASE pi.track_kind WHEN 'local' THEN lt.duration_ms WHEN 'online' THEN ot.duration_ms END as duration_ms,
               CASE pi.track_kind WHEN 'local' THEN lt.cover_hash ELSE NULL END as cover_hash,
               CASE pi.track_kind WHEN 'online' THEN ot.cover_url ELSE NULL END as cover_url
        FROM playlist_items pi
        LEFT JOIN local_tracks lt ON pi.track_kind='local' AND pi.track_id=lt.id
        LEFT JOIN online_tracks ot ON pi.track_kind='online' AND pi.track_id=ot.id
        WHERE pi.playlist_id=? ORDER BY pi.position
    ''', (pid,)).fetchall()
    conn.close()
    return jsonify({'playlist': dict(pl), 'items': [dict(i) for i in items]})


@app.route('/api/playlists/<int:pid>', methods=['PUT'])
def update_playlist(pid):
    d = request.json
    conn = get_db()
    if 'name' in d:
        conn.execute('UPDATE playlists SET name=? WHERE id=?', (d['name'], pid))
    conn.commit()
    pl = conn.execute('SELECT * FROM playlists WHERE id=?', (pid,)).fetchone()
    conn.close()
    return jsonify(dict(pl)) if pl else abort(404)


@app.route('/api/playlists/<int:pid>', methods=['DELETE'])
def delete_playlist(pid):
    conn = get_db()
    conn.execute('DELETE FROM playlists WHERE id=?', (pid,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/playlists/<int:pid>/items', methods=['PUT'])
def set_playlist_items(pid):
    d = request.json
    items = d.get('items', [])
    conn = get_db()
    conn.execute('DELETE FROM playlist_items WHERE playlist_id=?', (pid,))
    for i, item in enumerate(items):
        conn.execute('INSERT INTO playlist_items (playlist_id, position, track_kind, track_id) VALUES (?,?,?,?)',
                     (pid, i, item['track_kind'], item['track_id']))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/playlists/<int:pid>/items', methods=['POST'])
def add_playlist_item(pid):
    d = request.json
    conn = get_db()
    pos = conn.execute('SELECT COALESCE(MAX(position)+1, 0) as n FROM playlist_items WHERE playlist_id=?',
                       (pid,)).fetchone()['n']
    conn.execute('INSERT INTO playlist_items (playlist_id, position, track_kind, track_id) VALUES (?,?,?,?)',
                 (pid, pos, d['track_kind'], d['track_id']))
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'position': pos})


# ---------------------------------------------------------------------------
# Routes — Export / Import (M9)
# ---------------------------------------------------------------------------
@app.route('/api/export')
def export_data():
    conn = get_db()
    data = {
        'local_tracks': [dict(r) for r in conn.execute('SELECT * FROM local_tracks').fetchall()],
        'online_tracks': [dict(r) for r in conn.execute('SELECT * FROM online_tracks').fetchall()],
        'tags': [dict(r) for r in conn.execute('SELECT * FROM tags').fetchall()],
        'track_tags': [dict(r) for r in conn.execute('SELECT * FROM track_tags').fetchall()],
        'playlists': [dict(r) for r in conn.execute('SELECT * FROM playlists').fetchall()],
        'playlist_items': [dict(r) for r in conn.execute('SELECT * FROM playlist_items').fetchall()],
        'play_history': [dict(r) for r in conn.execute('SELECT * FROM play_history').fetchall()],
        'settings': {r['key']: r['value'] for r in conn.execute('SELECT * FROM settings').fetchall()},
    }
    conn.close()
    return jsonify(data)


@app.route('/api/import', methods=['POST'])
def import_data():
    d = request.json or {}
    conn = get_db()
    # Import online tracks
    for t in d.get('online_tracks', []):
        conn.execute('''INSERT OR IGNORE INTO online_tracks
            (source, source_id, title, artist, album, duration_ms, cover_url, default_quality, url_cache)
            VALUES (?,?,?,?,?,?,?,?,?)''',
            (t.get('source','url'), t.get('source_id'), t['title'], t.get('artist',''),
             t.get('album',''), t.get('duration_ms',0), t.get('cover_url'),
             t.get('default_quality'), t.get('url_cache','')))
    # Import tags
    for t in d.get('tags', []):
        conn.execute('INSERT OR IGNORE INTO tags (name, color, kind, rule_json) VALUES (?,?,?,?)',
                     (t['name'], t.get('color',''), t.get('kind','user'), t.get('rule_json')))
    # Import playlists
    for p in d.get('playlists', []):
        conn.execute('INSERT OR IGNORE INTO playlists (name, kind) VALUES (?,?)',
                     (p['name'], p.get('kind','mixed')))
    # Import settings
    for k, v in d.get('settings', {}).items():
        conn.execute('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', (k, str(v)))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ---------------------------------------------------------------------------
# Routes — Song notes / annotations (M9)
# ---------------------------------------------------------------------------
@app.route('/api/tracks/<kind>/<int:tid>/note', methods=['GET'])
def get_track_note(kind, tid):
    if kind not in ('local','online'):
        abort(400)
    conn = get_db()
    row = conn.execute('SELECT value FROM settings WHERE key=?',
                       (f'note_{kind}_{tid}',)).fetchone()
    conn.close()
    return jsonify({'note': row['value'] if row else ''})


@app.route('/api/tracks/<kind>/<int:tid>/note', methods=['PUT'])
def set_track_note(kind, tid):
    if kind not in ('local','online'):
        abort(400)
    d = request.json
    conn = get_db()
    conn.execute('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)',
                 (f'note_{kind}_{tid}', d.get('note', '')))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# ---------------------------------------------------------------------------
# Routes — HTTP proxy for source sandbox
# ---------------------------------------------------------------------------
@app.route('/api/proxy', methods=['POST'])
def proxy():
    import requests as req_lib
    conn = get_db()
    allowed = conn.execute("SELECT value FROM settings WHERE key='proxy_allow_outbound'").fetchone()
    conn.close()
    if not allowed or allowed['value'] != 'true':
        return jsonify({'error': 'outbound_disabled'}), 403
    d = request.json
    url = d.get('url', '')
    opts = d.get('options', {})
    from urllib.parse import urlparse
    parsed = urlparse(url)
    hostname = parsed.hostname or ''
    blocked = {'127.0.0.1','localhost','0.0.0.0','[::1]'}
    if hostname in blocked or hostname.startswith('10.') or hostname.startswith('192.168.') or hostname.startswith('172.'):
        return jsonify({'error': 'blocked_target'}), 403
    try:
        resp = req_lib.request(
            method=opts.get('method','GET').upper(),
            url=url,
            headers=opts.get('headers', {}),
            data=opts.get('body'),
            timeout=min(opts.get('timeout', 15000) / 1000.0, 30),
        )
        return jsonify({
            'status': resp.status_code,
            'headers': dict(resp.headers),
            'body': resp.text,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 502


# ---------------------------------------------------------------------------
# Boot
# ---------------------------------------------------------------------------
init_db()

if __name__ == '__main__':
    import logging
    # Disable Werkzeug's ANSI color codes so preview tools can parse stdout
    os.environ['NO_COLOR'] = '1'
    logging.getLogger('werkzeug').setLevel(logging.WARNING)

    port = int(os.environ.get('PORT', 5088))
    host = os.environ.get('HOST', '0.0.0.0')
    # Auto-scan on start
    conn = get_db()
    auto = conn.execute("SELECT value FROM settings WHERE key='auto_scan_on_start'").fetchone()
    conn.close()
    if auto and auto['value'] == 'true':
        threading.Thread(target=run_scan, daemon=True).start()

    print(f' * Running on http://{host}:{port}', flush=True)
    app.run(host=host, port=port, debug=False)
