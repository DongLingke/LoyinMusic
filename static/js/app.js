/* ═══════════════════════════════════════════════════════════════════
   听迹 Tunenote — Frontend SPA  (M0–M5)
   Web-first: runs in any browser, designed for remote access.
   ═══════════════════════════════════════════════════════════════════ */

// ── API layer ─────────────────────────────────────────────────────
const api = {
  async get(path) { const r = await fetch(`/api${path}`); return r.json(); },
  async post(path, body) {
    const r = await fetch(`/api${path}`, {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body),
    });
    return r.json();
  },
  async put(path, body) {
    const r = await fetch(`/api${path}`, {
      method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body),
    });
    return r.json();
  },
  async del(path) {
    const r = await fetch(`/api${path}`, { method: 'DELETE' });
    return r.json();
  },
  async upload(path, file) {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch(`/api${path}`, { method: 'POST', body: fd });
    return r.json();
  },
};

// ── State ─────────────────────────────────────────────────────────
const state = {
  view: 'local',
  localTracks: [],
  onlineTracks: [],
  tags: [],
  settings: {},
  sources: [],            // installed custom sources
  searchQuery: '',
  onlineSearchQuery: '',
  onlineSearchResults: [], // cross-source search results (transient)
  scanProgress: null,
  activeTagId: null,       // tag view: currently selected tag
  tagTracks: [],           // tracks under the active tag
  taggingTrack: null,      // { kind, id } — track whose tag editor is open
  playlists: [],
  activePlaylist: null,    // { playlist, items }
  historyDate: null,       // 'YYYY-MM-DD' or null → today
  historyMonth: null,      // Date object for calendar month navigation
  historyTracks: [],
  historyDaysWithPlays: new Set(),
};

// ── Utilities ─────────────────────────────────────────────────────
const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

function fmtTime(ms) {
  if (!ms || ms <= 0) return '0:00';
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}
function fmtTimeSec(sec) {
  if (!sec || sec <= 0) return '0:00';
  return `${Math.floor(sec / 60)}:${Math.floor(sec % 60).toString().padStart(2, '0')}`;
}
function coverUrl(track) {
  if (track.cover_hash) return `/api/local/cover/${track.cover_hash}`;
  if (track.cover_url) return track.cover_url;
  return null;
}
// ── LRC lyrics parser (M6) ─────────────────────────────────────
function parseLrc(lrcText) {
  if (!lrcText) return [];
  const lines = [];
  lrcText.split('\n').forEach(line => {
    const m = line.match(/^\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/);
    if (m) {
      const t = parseInt(m[1]) * 60 + parseInt(m[2]) + (parseInt(m[3] || 0) / (m[3]?.length === 3 ? 1000 : 100));
      lines.push({ time: t, text: m[4].trim() });
    }
  });
  return lines.sort((a, b) => a.time - b.time);
}

// ── Cover accent color extraction (M6) ────────────────────────
function extractAccentFromCover(imgSrc) {
  if (!imgSrc) return;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 64, 64);
      const data = ctx.getImageData(0, 0, 64, 64).data;
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < data.length; i += 16) {
        const pr = data[i], pg = data[i+1], pb = data[i+2];
        const sat = Math.max(pr,pg,pb) - Math.min(pr,pg,pb);
        if (sat > 30) { r += pr; g += pg; b += pb; count++; }
      }
      if (count > 0) {
        r = Math.round(r / count); g = Math.round(g / count); b = Math.round(b / count);
        document.documentElement.style.setProperty('--accent', `rgb(${r},${g},${b})`);
        document.documentElement.style.setProperty('--accent-hover', `rgb(${Math.min(r+30,255)},${Math.min(g+30,255)},${Math.min(b+30,255)})`);
        document.documentElement.style.setProperty('--accent-dim', `rgba(${r},${g},${b},0.15)`);
      }
    } catch {}
  };
  img.src = imgSrc;
}

function kindBadge(kind) {
  return kind === 'local'
    ? '<span class="kind-badge local">本地</span>'
    : '<span class="kind-badge online">在线</span>';
}

// ── Player ────────────────────────────────────────────────────────
const player = {
  audio: null,
  queue: [],
  current: -1,
  playing: false,
  _startTime: 0,

  init() {
    this.audio = document.getElementById('audio-el');
    this.audio.addEventListener('ended', () => this._onEnded());
    this.audio.addEventListener('timeupdate', () => this._onTimeUpdate());
    this.audio.addEventListener('play', () => { this.playing = true; this._updatePlayBtn(); });
    this.audio.addEventListener('pause', () => { this.playing = false; this._updatePlayBtn(); });
    this.audio.addEventListener('error', () => this._onError());

    document.getElementById('btn-play').onclick = () => this.togglePlay();
    document.getElementById('btn-prev').onclick = () => this.prev();
    document.getElementById('btn-next').onclick = () => this.next();

    const prog = document.getElementById('player-progress');
    prog.addEventListener('input', () => {
      if (this.audio.duration) this.audio.currentTime = (prog.value / 100) * this.audio.duration;
    });

    const vol = document.getElementById('volume-slider');
    vol.addEventListener('input', () => {
      this.audio.volume = vol.value / 100;
      api.put('/settings', { volume: vol.value });
    });

    api.get('/settings').then(s => {
      state.settings = s;
      const v = parseInt(s.volume || '80', 10);
      vol.value = v;
      this.audio.volume = v / 100;
    });

    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => this.togglePlay());
      navigator.mediaSession.setActionHandler('pause', () => this.togglePlay());
      navigator.mediaSession.setActionHandler('previoustrack', () => this.prev());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
      navigator.mediaSession.setActionHandler('seekto', d => {
        if (d.seekTime != null) this.audio.currentTime = d.seekTime;
      });
    }
  },

  playTrack(track, queue, idx) {
    this.queue = queue || [track];
    this.current = idx ?? 0;
    this._load(track);
  },

  async _load(track) {
    let url;
    if (track.kind === 'local') {
      url = `/api/local/stream/${track.id}`;
    } else {
      // Online: try cached URL first, else resolve via source
      url = track.url_cache || '';
      if (!url && track.source && track.source !== 'url') {
        try {
          url = await this._resolveOnlineUrl(track);
        } catch { /* fall through */ }
      }
      if (!url) url = track.url_cache || track.path || '';
    }
    if (!url) return;
    this.audio.src = url;
    this.audio.play();
    this._startTime = Date.now();
    this._updateBar(track);
    this._updateMediaSession(track);
    document.querySelectorAll('.track-row').forEach(r => {
      r.classList.toggle('playing',
        r.dataset.kind === track.kind && r.dataset.id === String(track.id));
    });
  },

  async _resolveOnlineUrl(track) {
    if (!window.sourceHost) throw new Error('no source host');
    const quality = state.settings.default_quality_online || '320k';
    const musicInfo = track.source_meta ? JSON.parse(track.source_meta) : { songmid: track.source_id };
    const url = await window.sourceHost.request(track.source, 'musicUrl', {
      type: quality, musicInfo,
    });
    // Cache it
    if (url && track.id) {
      api.put(`/online/tracks/${track.id}`, {
        url_cache: url,
        url_cache_at: new Date().toISOString(),
        url_cache_q: quality,
      });
    }
    return url;
  },

  togglePlay() { if (!this.audio.src) return; this.audio.paused ? this.audio.play() : this.audio.pause(); },
  next() {
    if (!this.queue.length) return;
    this.current = (this.current + 1) % this.queue.length;
    this._load(this.queue[this.current]);
  },
  prev() {
    if (!this.queue.length) return;
    if (this.audio.currentTime > 3) { this.audio.currentTime = 0; return; }
    this.current = (this.current - 1 + this.queue.length) % this.queue.length;
    this._load(this.queue[this.current]);
  },

  _onEnded() {
    const track = this.queue[this.current];
    if (track) {
      const played = Date.now() - this._startTime;
      api.post('/history', {
        track_kind: track.kind, track_id: track.id,
        duration_played: played, completed: played > (track.duration_ms || 0) * 0.8 ? 1 : 0,
      });
    }
    this.next();
  },
  _onError() {
    console.warn('playback error, skipping');
    setTimeout(() => this.next(), 500);
  },
  _onTimeUpdate() {
    const prog = document.getElementById('player-progress');
    const cur = document.getElementById('player-time-cur');
    if (this.audio.duration) {
      prog.value = (this.audio.currentTime / this.audio.duration) * 100;
      cur.textContent = fmtTimeSec(this.audio.currentTime);
    }
    this._syncLyrics();
  },
  _updatePlayBtn() { document.getElementById('btn-play').textContent = this.playing ? '⏸' : '▶'; },
  lyrics: [],      // parsed LRC lines for current track
  _currentTrack: null,

  _updateBar(track) {
    this._currentTrack = track;
    document.getElementById('player-title').textContent = track.title || '未知曲目';
    document.getElementById('player-artist').textContent = track.artist || '';
    document.getElementById('player-time-dur').textContent = fmtTime(track.duration_ms);
    document.getElementById('player-time-cur').textContent = '0:00';
    document.getElementById('player-progress').value = 0;
    const coverEl = document.getElementById('player-cover');
    const src = coverUrl(track);
    coverEl.innerHTML = src ? `<img src="${esc(src)}" alt="">` : '';
    // Now-playing overlay
    const npCover = document.getElementById('np-cover-lg');
    npCover.innerHTML = src ? `<img src="${esc(src)}" alt="">` : '';
    document.getElementById('np-title-lg').textContent = track.title || '未知曲目';
    document.getElementById('np-artist-lg').textContent = track.artist || '';
    document.getElementById('np-album-lg').textContent = track.album || '';
    // Cover accent (M6)
    extractAccentFromCover(src);
    // Load lyrics (M6)
    this.lyrics = [];
    this._loadLyrics(track);
    // Load note (M9)
    this._loadNote(track);
  },

  async _loadLyrics(track) {
    let lrc = track.lyric_cache || '';
    // Try fetching from source sandbox
    if (!lrc && track.kind === 'online' && track.source && track.source !== 'url' && window.sourceHost) {
      try {
        const info = track.source_meta ? JSON.parse(track.source_meta) : { songmid: track.source_id };
        const result = await window.sourceHost.request(track.source, 'lyric', { musicInfo: info });
        if (result && typeof result === 'object') lrc = result.lyric || '';
        else if (typeof result === 'string') lrc = result;
        // Cache it
        if (lrc && track.id) api.put(`/online/tracks/${track.id}`, { lyric_cache: lrc });
      } catch {}
    }
    this.lyrics = parseLrc(lrc);
    this._renderLyrics();
  },

  _renderLyrics() {
    const el = document.getElementById('np-lyrics');
    if (!el) return;
    if (!this.lyrics.length) {
      el.innerHTML = '<div style="padding:20px;color:var(--text-tertiary)">暂无歌词</div>';
      return;
    }
    el.innerHTML = this.lyrics.map((l, i) =>
      `<div class="lyric-line" data-lyric-idx="${i}">${esc(l.text || '···')}</div>`
    ).join('');
  },

  _syncLyrics() {
    if (!this.lyrics.length) return;
    const el = document.getElementById('np-lyrics');
    if (!el) return;
    const t = this.audio.currentTime;
    let activeIdx = 0;
    for (let i = this.lyrics.length - 1; i >= 0; i--) {
      if (this.lyrics[i].time <= t) { activeIdx = i; break; }
    }
    el.querySelectorAll('.lyric-line').forEach((line, i) => {
      const isActive = i === activeIdx;
      line.classList.toggle('active', isActive);
      if (isActive) line.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  },

  async _loadNote(track) {
    const el = document.getElementById('np-note');
    if (!el) return;
    const kind = track.kind || 'local';
    try {
      const d = await api.get(`/tracks/${kind}/${track.id}/note`);
      el.value = d.note || '';
    } catch { el.value = ''; }
  },
  _updateMediaSession(track) {
    if (!('mediaSession' in navigator)) return;
    const artwork = [];
    const src = coverUrl(track);
    if (src) artwork.push({ src, sizes: '512x512', type: 'image/webp' });
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || '未知曲目', artist: track.artist || '', album: track.album || '', artwork,
    });
  },
};

// ── Track table renderer (shared by local / online / tags) ────────
function renderTrackTable(tracks, kindCol = false) {
  if (!tracks.length) return '';
  let html = `<table class="track-table"><thead><tr>
    <th class="td-idx">#</th><th class="td-cover"></th>
    <th class="td-title">标题</th><th class="td-artist">艺人</th>
    <th class="td-album">专辑</th>
    ${kindCol ? '<th class="td-kind">来源</th>' : ''}
    <th class="td-duration">时长</th><th class="td-actions"></th>
  </tr></thead><tbody>`;
  tracks.forEach((t, i) => {
    const cv = coverUrl(t);
    const kind = t.kind || t.track_kind || 'local';
    const id = t.id || t.track_id;
    const cur = player.queue[player.current];
    const isPlaying = cur && cur.kind === kind && cur.id === id;
    html += `<tr class="track-row ${isPlaying ? 'playing' : ''}" data-kind="${kind}" data-id="${id}" data-idx="${i}">
      <td class="td-idx">${isPlaying ? '🔊' : i + 1}</td>
      <td class="td-cover">${cv ? `<img src="${esc(cv)}" alt="" loading="lazy">` : '<div style="width:32px;height:32px;border-radius:4px;background:var(--bg-hover)"></div>'}</td>
      <td class="td-title"><span class="track-name">${esc(t.title || '')}</span></td>
      <td class="td-artist">${esc(t.artist || '')}</td>
      <td class="td-album">${esc(t.album || '')}</td>
      ${kindCol ? `<td class="td-kind">${kindBadge(kind)}</td>` : ''}
      <td class="td-duration">${fmtTime(t.duration_ms)}</td>
      <td class="td-actions"><button class="btn-tag-action" data-act="open-tagger" data-kind="${kind}" data-id="${id}" title="标签">🏷</button></td>
    </tr>`;
  });
  html += '</tbody></table>';
  return html;
}

// ── Tag editor popup (inline) ─────────────────────────────────────
function renderTaggerPopup(kind, id) {
  const allTags = state.tags;
  // We'll load the track's current tags async; for now render skeleton
  return `<div class="tagger-popup" data-tagger-kind="${kind}" data-tagger-id="${id}">
    <div class="tagger-title">标签 <button class="tagger-close" data-act="close-tagger">✕</button></div>
    <div class="tagger-chips" id="tagger-chips">加载中...</div>
  </div>`;
}

async function loadTaggerChips(kind, id) {
  const trackTags = await api.get(`/tracks/${kind}/${id}/tags`);
  const trackTagIds = new Set(trackTags.map(t => t.id));
  const el = document.getElementById('tagger-chips');
  if (!el) return;
  el.innerHTML = state.tags.map(t => `
    <label class="tagger-chip ${trackTagIds.has(t.id) ? 'on' : ''}" data-tag-id="${t.id}">
      <input type="checkbox" ${trackTagIds.has(t.id) ? 'checked' : ''} data-act="toggle-track-tag" data-kind="${kind}" data-id="${id}" data-tag-id="${t.id}">
      ${esc(t.name)}
    </label>
  `).join('') || '<span style="color:var(--text-tertiary)">先创建标签</span>';
}

// ══════════════════════════════════════════════════════════════════
// Views
// ══════════════════════════════════════════════════════════════════

// ── M1: Local view ────────────────────────────────────────────────
function renderLocalView() {
  const tracks = state.localTracks;
  const q = state.searchQuery.toLowerCase();
  const filtered = q ? tracks.filter(t => (t.title+t.artist+t.album).toLowerCase().includes(q)) : tracks;

  let html = `<div class="view-header">
    <div class="view-title">本地音乐 <span class="count">(${filtered.length})</span></div>
    <div class="search-box"><span class="search-icon">🔍</span>
      <input type="search" id="search-input" placeholder="搜索标题 / 艺人 / 专辑..." value="${esc(state.searchQuery)}">
    </div>
  </div>`;

  if (state.scanProgress && state.scanProgress.running) {
    const p = state.scanProgress;
    const pct = p.total > 0 ? Math.round(p.done / p.total * 100) : 0;
    html += `<div class="scan-bar"><span>扫描中... ${p.done}/${p.total}</span>
      <div class="scan-bar-progress"><div class="scan-bar-fill" style="width:${pct}%"></div></div>
      <span>${esc(p.current)}</span></div>`;
  }

  if (!filtered.length) {
    html += `<div class="empty-state"><div class="empty-icon">🎵</div><div class="empty-text">
      ${tracks.length === 0 ? '还没有本地音乐<br>在「设置」中添加扫描目录，然后点击「扫描」' : '没有匹配的结果'}
    </div></div>`;
  } else {
    html += renderTrackTable(filtered.map(t => ({ ...t, kind: 'local' })));
  }
  return html;
}

// ── M3: Online view ───────────────────────────────────────────────
function renderOnlineView() {
  const tracks = state.onlineTracks;
  const q = state.searchQuery.toLowerCase();
  const filtered = q ? tracks.filter(t => (t.title+t.artist+t.album).toLowerCase().includes(q)) : tracks;

  // Available sources from sandbox
  const avail = window.sourceHost ? window.sourceHost.getAvailableSources() : {};
  const sourceKeys = Object.keys(avail);

  let html = `<div class="view-header">
    <div class="view-title">在线音乐 <span class="count">(${filtered.length})</span></div>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="btn btn-ghost" id="btn-add-url">+ 外链</button>
      <div class="search-box"><span class="search-icon">🔍</span>
        <input type="search" id="search-input" placeholder="搜索收藏 / 输入关键词搜索音源..." value="${esc(state.searchQuery)}">
      </div>
      ${sourceKeys.length ? `<button class="btn btn-primary" id="btn-source-search">搜索音源</button>` : ''}
    </div>
  </div>`;

  // Cross-source search results
  if (state.onlineSearchResults.length) {
    html += `<div class="settings-section-title" style="margin-top:0">搜索结果 <button class="btn btn-ghost" style="font-size:0.75rem;padding:2px 8px" id="btn-clear-results">清除</button></div>`;
    html += renderTrackTable(state.onlineSearchResults.map(t => ({ ...t, kind: 'online' })));
    html += '<div style="margin:20px 0;border-top:1px solid var(--border)"></div>';
    html += '<div class="settings-section-title">我的收藏</div>';
  }

  if (!filtered.length && !state.onlineSearchResults.length) {
    html += `<div class="empty-state"><div class="empty-icon">🌐</div><div class="empty-text">
      还没有在线音乐<br>点击「+ 外链」添加，或安装音源脚本后搜索
    </div></div>`;
  } else if (filtered.length) {
    html += renderTrackTable(filtered.map(t => ({ ...t, kind: 'online' })));
  }
  return html;
}

// ── M2: Tags view ─────────────────────────────────────────────────
function renderTagsView() {
  let html = `<div class="view-header">
    <div class="view-title">标签</div>
    <button class="btn btn-primary" id="btn-add-tag">+ 新建标签</button>
  </div>`;

  if (!state.tags.length) {
    html += `<div class="empty-state"><div class="empty-icon">🏷</div>
      <div class="empty-text">还没有标签<br>给音乐打上标签来分类管理</div></div>`;
    return html;
  }

  html += '<div class="tags-row" style="gap:8px;margin-bottom:20px">';
  state.tags.forEach(t => {
    const active = state.activeTagId === t.id;
    html += `<div class="tag-chip ${active ? 'active' : ''}" data-act="select-tag" data-tag-id="${t.id}">
      <span>${esc(t.name)}</span>
      <span class="tag-remove" data-act="del-tag" data-id="${t.id}">&times;</span>
    </div>`;
  });
  html += '</div>';

  if (state.activeTagId) {
    const tag = state.tags.find(t => t.id === state.activeTagId);
    html += `<div class="settings-section-title">${tag ? esc(tag.name) : ''} 下的曲目</div>`;
    if (state.tagTracks.length) {
      html += renderTrackTable(state.tagTracks.map(t => ({
        ...t, kind: t.track_kind, id: t.track_id,
      })), true);
    } else {
      html += '<div style="padding:20px;color:var(--text-tertiary);text-align:center">这个标签下还没有曲目</div>';
    }
  } else {
    html += '<div style="padding:20px;color:var(--text-tertiary);text-align:center">点击上方标签查看其中的曲目</div>';
  }
  return html;
}

// ── M8: Playlists view ────────────────────────────────────────────
function renderPlaylistsView() {
  let html = `<div class="view-header">
    <div class="view-title">歌单</div>
    <button class="btn btn-primary" id="btn-add-playlist">+ 新建歌单</button>
  </div>`;

  if (state.activePlaylist) {
    const { playlist, items } = state.activePlaylist;
    html += `<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <button class="btn btn-ghost" id="btn-back-playlists">← 返回</button>
      <span class="view-title" style="font-size:1.2rem">${esc(playlist.name)}</span>
      <span class="count">(${items.length})</span>
    </div>`;
    if (items.length) {
      html += renderTrackTable(items.map(it => ({
        ...it, kind: it.track_kind, id: it.track_id,
      })), true);
    } else {
      html += '<div style="padding:20px;color:var(--text-tertiary);text-align:center">歌单为空 — 在其他视图的曲目上右键可添加到歌单</div>';
    }
    return html;
  }

  if (!state.playlists.length) {
    html += `<div class="empty-state"><div class="empty-icon">📋</div>
      <div class="empty-text">还没有歌单<br>创建歌单来整理你喜欢的音乐</div></div>`;
    return html;
  }

  html += '<div class="playlist-grid">';
  state.playlists.forEach(p => {
    html += `<div class="playlist-card" data-act="open-playlist" data-id="${p.id}">
      <div class="playlist-card-name">${esc(p.name)}</div>
      <div class="playlist-card-count">${p.item_count || 0} 首</div>
      <div class="playlist-card-actions">
        <button class="btn btn-ghost" style="font-size:0.75rem;padding:2px 8px" data-act="rename-playlist" data-id="${p.id}">重命名</button>
        <button class="btn btn-ghost" style="font-size:0.75rem;padding:2px 8px;color:var(--danger)" data-act="del-playlist" data-id="${p.id}">删除</button>
      </div>
    </div>`;
  });
  html += '</div>';
  return html;
}

// ── M8: History view (calendar + track list) ──────────────────────
function renderHistoryView() {
  const now = new Date();
  const month = state.historyMonth || new Date(now.getFullYear(), now.getMonth(), 1);
  const y = month.getFullYear(), m = month.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const firstDow = new Date(y, m, 1).getDay(); // 0=Sun
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const selectedDate = state.historyDate || todayStr;
  const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

  let html = `<div class="view-header"><div class="view-title">播放历史</div></div>`;

  // Calendar nav
  html += `<div class="cal-nav">
    <button data-act="cal-prev">◀</button>
    <div class="cal-nav-title">${y}年 ${monthNames[m]}</div>
    <button data-act="cal-next">▶</button>
  </div>`;

  // Calendar grid
  html += '<div class="history-calendar">';
  ['日','一','二','三','四','五','六'].forEach(d => {
    html += `<div class="cal-header">${d}</div>`;
  });
  // Empty cells before first day
  for (let i = 0; i < firstDow; i++) html += '<div class="cal-day empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = dateStr === todayStr;
    const isSelected = dateStr === selectedDate;
    const hasPlays = state.historyDaysWithPlays.has(dateStr);
    html += `<div class="cal-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${hasPlays ? 'has-plays' : ''}"
                  data-act="cal-select" data-date="${dateStr}">${d}</div>`;
  }
  html += '</div>';

  // Selected date's tracks
  html += `<div class="settings-section-title">${selectedDate} 的播放记录</div>`;
  if (state.historyTracks.length) {
    html += '<table class="track-table"><thead><tr><th class="td-idx">#</th><th class="td-title">标题</th><th class="td-artist">艺人</th><th class="td-duration">时间</th></tr></thead><tbody>';
    state.historyTracks.forEach((t, i) => {
      html += `<tr class="track-row" data-kind="${t.track_kind}" data-id="${t.track_id}">
        <td class="td-idx">${i + 1}</td>
        <td class="td-title"><span class="track-name">${esc(t.title || '未知')}</span> ${kindBadge(t.track_kind)}</td>
        <td class="td-artist">${esc(t.artist || '')}</td>
        <td class="td-duration">${t.played_at ? t.played_at.split(' ')[1]?.slice(0,5) || '' : ''}</td>
      </tr>`;
    });
    html += '</tbody></table>';
  } else {
    html += '<div style="padding:20px;color:var(--text-tertiary);text-align:center">这一天没有播放记录</div>';
  }
  return html;
}

// ── Settings view (M1 + M4 source management) ─────────────────────
function renderSettingsView() {
  const s = state.settings;
  let folders = [];
  try { folders = JSON.parse(s.scan_folders || '[]'); } catch {}

  let html = `<div class="view-header"><div class="view-title">设置</div></div>`;

  // Local music
  html += `<div class="settings-section">
    <div class="settings-section-title">本地音乐</div>
    <div class="settings-group">
      <div class="settings-row">
        <div><div class="settings-row-label">扫描目录</div>
          <div class="settings-row-sub">添加包含音乐文件的文件夹路径</div></div>
        <button class="btn btn-ghost" id="btn-add-folder">+ 添加目录</button>
      </div>
      ${folders.length ? `<ul class="folder-list">${folders.map((f, i) => `<li class="folder-item">
        <span>${esc(f)}</span>
        <button data-act="remove-folder" data-idx="${i}">&times; 移除</button>
      </li>`).join('')}</ul>` : ''}
      <div class="settings-row">
        <div><div class="settings-row-label">扫描音乐库</div>
          <div class="settings-row-sub">扫描以上目录中的音频文件</div></div>
        <button class="btn btn-primary" id="btn-scan">扫描</button>
      </div>
      <div class="settings-row">
        <div class="settings-row-label">启动时自动扫描</div>
        <button class="btn btn-ghost" id="btn-toggle-autoscan">
          ${s.auto_scan_on_start === 'true' ? '✓ 已开启' : '✗ 已关闭'}</button>
      </div>
    </div>
  </div>`;

  // M4: Source management
  html += `<div class="settings-section">
    <div class="settings-section-title">音源管理</div>
    <div class="settings-group">
      <div class="settings-row">
        <div><div class="settings-row-label">安装音源脚本</div>
          <div class="settings-row-sub">上传洛雪兼容的 .js 音源文件</div></div>
        <label class="btn btn-primary" style="cursor:pointer">
          选择文件 <input type="file" accept=".js" id="source-file-input" style="display:none">
        </label>
      </div>`;
  if (state.sources.length) {
    state.sources.forEach(src => {
      const sourcesInfo = src.sources_json ? JSON.parse(src.sources_json) : {};
      const keys = Object.keys(sourcesInfo);
      html += `<div class="settings-row" style="flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <div class="settings-row-label">${src.enabled ? '✓' : '✗'} ${esc(src.name)} <span style="color:var(--text-tertiary)">${esc(src.version || '')}</span></div>
          <div class="settings-row-sub">${esc(src.author || '')} ${keys.length ? '· 提供: ' + keys.join(', ') : ''}</div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost" data-act="toggle-source" data-id="${src.id}" data-enabled="${src.enabled}">
            ${src.enabled ? '禁用' : '启用'}</button>
          <button class="btn btn-ghost" style="color:var(--danger)" data-act="del-source" data-id="${src.id}">卸载</button>
        </div>
      </div>`;
    });
  }
  html += `</div></div>`;

  // Playback
  html += `<div class="settings-section">
    <div class="settings-section-title">播放</div>
    <div class="settings-group">
      <div class="settings-row">
        <div class="settings-row-label">默认在线音质</div>
        <div style="display:flex;gap:4px">
          ${['128k','320k','flac','flac24bit'].map(q => `
            <button class="btn ${(s.default_quality_online||'320k')===q ? 'btn-primary' : 'btn-ghost'}"
                    data-act="set-quality" data-q="${q}" style="padding:4px 10px;font-size:0.8rem">${q}</button>
          `).join('')}
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row-label">默认音量</div>
        <span>${s.volume || 80}%</span>
      </div>
    </div>
  </div>`;

  // M9: Export / Import
  html += `<div class="settings-section">
    <div class="settings-section-title">数据备份</div>
    <div class="settings-group">
      <div class="settings-row">
        <div><div class="settings-row-label">导出全部数据</div>
          <div class="settings-row-sub">下载 JSON 备份文件</div></div>
        <button class="btn btn-ghost" id="btn-export">导出</button>
      </div>
      <div class="settings-row">
        <div><div class="settings-row-label">导入数据</div>
          <div class="settings-row-sub" style="color:var(--danger)">会合并到当前数据，请先导出做备份</div></div>
        <label class="btn btn-ghost" style="cursor:pointer">
          导入 <input type="file" accept=".json" id="import-file-input" style="display:none">
        </label>
      </div>
    </div>
  </div>`;

  return html;
}

// ── Render engine ─────────────────────────────────────────────────
function render() {
  const vc = document.getElementById('view-container');
  switch (state.view) {
    case 'local':    vc.innerHTML = renderLocalView(); break;
    case 'online':   vc.innerHTML = renderOnlineView(); break;
    case 'tags':     vc.innerHTML = renderTagsView(); break;
    case 'playlists': vc.innerHTML = renderPlaylistsView(); break;
    case 'history':   vc.innerHTML = renderHistoryView(); break;
    case 'settings':  vc.innerHTML = renderSettingsView(); break;
    default:          vc.innerHTML = renderLocalView();
  }
  bindViewEvents();
}

// ── Event binding ─────────────────────────────────────────────────
function bindViewEvents() {
  // Search (shared by local + online)
  const si = document.getElementById('search-input');
  if (si) {
    si.oninput = () => { state.searchQuery = si.value; render(); };
    // Re-focus after render so typing isn't interrupted
    const val = si.value; si.focus(); si.value = ''; si.value = val;
  }

  // Track row click → play
  document.querySelectorAll('.track-row').forEach(row => {
    row.onclick = (e) => {
      if (e.target.closest('[data-act]')) return; // don't play when clicking action buttons
      const kind = row.dataset.kind;
      const id = parseInt(row.dataset.id, 10);
      // Build queue from all visible rows
      const rows = [...document.querySelectorAll('.track-row')];
      const queue = rows.map(r => {
        const k = r.dataset.kind;
        const tid = parseInt(r.dataset.id, 10);
        const source = k === 'local' ? state.localTracks : state.onlineTracks;
        const track = source.find(t => t.id === tid) || state.onlineSearchResults.find(t => t.id === tid);
        return track ? { ...track, kind: k } : null;
      }).filter(Boolean);
      const idx = queue.findIndex(t => t.kind === kind && t.id === id);
      if (idx >= 0) player.playTrack(queue[idx], queue, idx);
    };
  });

  // ── Tag actions (M2) ──────────────────────────────────────────
  document.getElementById('btn-add-tag')?.addEventListener('click', async () => {
    const name = prompt('标签名称');
    if (!name?.trim()) return;
    await api.post('/tags', { name: name.trim() });
    state.tags = await api.get('/tags');
    render();
  });

  document.querySelectorAll('[data-act="del-tag"]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('确定删除这个标签？')) return;
      await api.del(`/tags/${btn.dataset.id}`);
      state.tags = await api.get('/tags');
      if (state.activeTagId === parseInt(btn.dataset.id, 10)) { state.activeTagId = null; state.tagTracks = []; }
      render();
    };
  });

  document.querySelectorAll('[data-act="select-tag"]').forEach(chip => {
    chip.onclick = async (e) => {
      if (e.target.closest('[data-act="del-tag"]')) return;
      const tid = parseInt(chip.dataset.tagId, 10);
      state.activeTagId = state.activeTagId === tid ? null : tid;
      if (state.activeTagId) {
        state.tagTracks = await api.get(`/tags/${state.activeTagId}/tracks`);
      } else {
        state.tagTracks = [];
      }
      render();
    };
  });

  // ── Inline tagger (open/close/toggle) ─────────────────────────
  document.querySelectorAll('[data-act="open-tagger"]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const kind = btn.dataset.kind, id = parseInt(btn.dataset.id, 10);
      // Close existing
      document.querySelectorAll('.tagger-popup').forEach(p => p.remove());
      // Insert after this row
      const row = btn.closest('.track-row');
      if (!row) return;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="8" style="padding:0">${renderTaggerPopup(kind, id)}</td>`;
      row.after(tr);
      state.taggingTrack = { kind, id };
      await loadTaggerChips(kind, id);
    };
  });

  document.addEventListener('click', (e) => {
    if (e.target.matches('[data-act="close-tagger"]')) {
      e.target.closest('tr')?.remove();
      state.taggingTrack = null;
    }
  });

  document.addEventListener('change', async (e) => {
    if (e.target.matches('[data-act="toggle-track-tag"]')) {
      const { kind, id, tagId } = e.target.dataset;
      const trackTags = await api.get(`/tracks/${kind}/${id}/tags`);
      let tagIds = trackTags.map(t => t.id);
      const tid = parseInt(tagId, 10);
      if (e.target.checked) { if (!tagIds.includes(tid)) tagIds.push(tid); }
      else { tagIds = tagIds.filter(x => x !== tid); }
      await api.put(`/tracks/${kind}/${id}/tags`, { tag_ids: tagIds });
      e.target.closest('.tagger-chip')?.classList.toggle('on', e.target.checked);
    }
  });

  // ── Online: add URL (M3) ──────────────────────────────────────
  document.getElementById('btn-add-url')?.addEventListener('click', async () => {
    const url = prompt('输入音频链接\n支持 mp3 / flac / m3u 等直链');
    if (!url?.trim()) return;
    const title = prompt('曲目标题', '未知曲目') || '未知曲目';
    const artist = prompt('艺人（可选）', '') || '';
    await api.post('/online/tracks', { source: 'url', title, artist, url: url.trim() });
    state.onlineTracks = await api.get('/online/tracks');
    render();
  });

  // ── Online: cross-source search (M5) ──────────────────────────
  document.getElementById('btn-source-search')?.addEventListener('click', async () => {
    const q = state.searchQuery.trim();
    if (!q) { alert('请先输入搜索关键词'); return; }
    const avail = window.sourceHost ? window.sourceHost.getAvailableSources() : {};
    const results = [];
    for (const [sourceKey, info] of Object.entries(avail)) {
      if (sourceKey === 'local') continue;
      try {
        const data = await window.sourceHost.request(sourceKey, 'musicUrl', {
          type: state.settings.default_quality_online || '320k',
          musicInfo: { keyword: q },
        });
        // Some sources return a URL for musicUrl with keyword — that's search
        // For real search, the protocol doesn't have a standard 'search' action,
        // so this is a best-effort pass-through
        if (typeof data === 'string') {
          results.push({
            id: null, source: sourceKey, source_id: q, title: q,
            artist: sourceKey, url_cache: data, kind: 'online',
          });
        }
      } catch { /* source doesn't support search-by-keyword */ }
    }
    state.onlineSearchResults = results;
    render();
  });

  document.getElementById('btn-clear-results')?.addEventListener('click', () => {
    state.onlineSearchResults = [];
    render();
  });

  // ── Settings: folders + scan ──────────────────────────────────
  document.getElementById('btn-add-folder')?.addEventListener('click', async () => {
    const path = prompt('输入音乐文件夹路径\n例如：/home/user/Music');
    if (!path?.trim()) return;
    let folders = [];
    try { folders = JSON.parse(state.settings.scan_folders || '[]'); } catch {}
    if (folders.includes(path.trim())) return;
    folders.push(path.trim());
    await api.put('/settings', { scan_folders: JSON.stringify(folders) });
    state.settings.scan_folders = JSON.stringify(folders);
    render();
  });

  document.querySelectorAll('[data-act="remove-folder"]').forEach(btn => {
    btn.onclick = async () => {
      let folders = [];
      try { folders = JSON.parse(state.settings.scan_folders || '[]'); } catch {}
      folders.splice(parseInt(btn.dataset.idx, 10), 1);
      await api.put('/settings', { scan_folders: JSON.stringify(folders) });
      state.settings.scan_folders = JSON.stringify(folders);
      render();
    };
  });

  document.getElementById('btn-scan')?.addEventListener('click', async () => {
    await api.post('/local/scan', {});
    pollScan();
  });

  document.getElementById('btn-toggle-autoscan')?.addEventListener('click', async () => {
    const cur = state.settings.auto_scan_on_start === 'true';
    await api.put('/settings', { auto_scan_on_start: cur ? 'false' : 'true' });
    state.settings.auto_scan_on_start = cur ? 'false' : 'true';
    render();
  });

  // ── Settings: sources (M4) ────────────────────────────────────
  document.getElementById('source-file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await api.upload('/sources', file);
    state.sources = await api.get('/sources');
    // Re-init sandbox
    try { await window.sourceHost.loadAll(); } catch {}
    render();
  });

  document.querySelectorAll('[data-act="toggle-source"]').forEach(btn => {
    btn.onclick = async () => {
      const enabled = btn.dataset.enabled === '1' ? 0 : 1;
      await api.put(`/sources/${btn.dataset.id}`, { enabled });
      state.sources = await api.get('/sources');
      try { await window.sourceHost.loadAll(); } catch {}
      render();
    };
  });

  document.querySelectorAll('[data-act="del-source"]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('确定卸载这个音源？')) return;
      window.sourceHost.unload(btn.dataset.id);
      await api.del(`/sources/${btn.dataset.id}`);
      state.sources = await api.get('/sources');
      render();
    };
  });

  document.querySelectorAll('[data-act="set-quality"]').forEach(btn => {
    btn.onclick = async () => {
      await api.put('/settings', { default_quality_online: btn.dataset.q });
      state.settings.default_quality_online = btn.dataset.q;
      render();
    };
  });

  // ── M9: Export / Import ─────────────────────────────────────────
  document.getElementById('btn-export')?.addEventListener('click', async () => {
    const data = await api.get('/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tunenote-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('import-file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      await api.post('/import', data);
      alert('导入成功！');
      location.reload();
    } catch (err) {
      alert('导入失败: ' + err.message);
    }
  });

  // ── M8: Playlists ──────────────────────────────────────────────
  document.getElementById('btn-add-playlist')?.addEventListener('click', async () => {
    const name = prompt('歌单名称');
    if (!name?.trim()) return;
    await api.post('/playlists', { name: name.trim() });
    state.playlists = await api.get('/playlists');
    render();
  });

  document.getElementById('btn-back-playlists')?.addEventListener('click', () => {
    state.activePlaylist = null;
    render();
  });

  document.querySelectorAll('[data-act="open-playlist"]').forEach(el => {
    el.onclick = async (e) => {
      if (e.target.closest('[data-act="rename-playlist"]') || e.target.closest('[data-act="del-playlist"]')) return;
      const d = await api.get(`/playlists/${el.dataset.id}`);
      state.activePlaylist = d;
      render();
    };
  });

  document.querySelectorAll('[data-act="rename-playlist"]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const name = prompt('新名称');
      if (!name?.trim()) return;
      await api.put(`/playlists/${btn.dataset.id}`, { name: name.trim() });
      state.playlists = await api.get('/playlists');
      render();
    };
  });

  document.querySelectorAll('[data-act="del-playlist"]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('确定删除这个歌单？')) return;
      await api.del(`/playlists/${btn.dataset.id}`);
      state.playlists = await api.get('/playlists');
      state.activePlaylist = null;
      render();
    };
  });

  // ── M8: History calendar ───────────────────────────────────────
  document.querySelectorAll('[data-act="cal-select"]').forEach(el => {
    el.onclick = async () => {
      state.historyDate = el.dataset.date;
      state.historyTracks = await api.get(`/history?date=${el.dataset.date}&limit=200`);
      render();
    };
  });

  document.querySelector('[data-act="cal-prev"]')?.addEventListener('click', async () => {
    const cur = state.historyMonth || new Date();
    state.historyMonth = new Date(cur.getFullYear(), cur.getMonth() - 1, 1);
    await loadHistoryMonth();
    render();
  });

  document.querySelector('[data-act="cal-next"]')?.addEventListener('click', async () => {
    const cur = state.historyMonth || new Date();
    state.historyMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    await loadHistoryMonth();
    render();
  });
}

// ── Scan polling ──────────────────────────────────────────────────
let _scanPoll = null;
async function pollScan() {
  if (_scanPoll) return;
  _scanPoll = setInterval(async () => {
    const p = await api.get('/local/scan/progress');
    state.scanProgress = p;
    if (!p.running) {
      clearInterval(_scanPoll); _scanPoll = null;
      state.scanProgress = null;
      state.localTracks = await api.get('/local/tracks');
    }
    if (state.view === 'local' || state.view === 'settings') render();
  }, 1000);
}

// ── Navigation ────────────────────────────────────────────────────
// ── History helpers ───────────────────────────────────────────────
async function loadHistoryMonth() {
  // Load all history dates for the month to show dots on the calendar
  const m = state.historyMonth || new Date();
  const all = await api.get(`/history?limit=500`);
  state.historyDaysWithPlays = new Set(
    all.map(h => h.played_at?.split(' ')[0]).filter(Boolean)
  );
}

// ── Now-playing overlay ──────────────────────────────────────────
function bindNowPlaying() {
  // Click on player cover or track info → open overlay
  document.querySelector('.player-track-info')?.addEventListener('click', () => {
    if (!player._currentTrack) return;
    document.getElementById('now-playing-overlay').classList.remove('hidden');
  });
  document.getElementById('np-close')?.addEventListener('click', () => {
    document.getElementById('now-playing-overlay').classList.add('hidden');
  });
  // Auto-save note on blur
  const noteEl = document.getElementById('np-note');
  let _noteTimer = null;
  noteEl?.addEventListener('input', () => {
    clearTimeout(_noteTimer);
    _noteTimer = setTimeout(async () => {
      const track = player._currentTrack;
      if (!track) return;
      const kind = track.kind || 'local';
      await api.put(`/tracks/${kind}/${track.id}/note`, { note: noteEl.value });
    }, 1000);
  });
}

function bindNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.onclick = () => {
      state.view = btn.dataset.view;
      state.searchQuery = '';
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      render();
    };
  });
}

// ── Boot ──────────────────────────────────────────────────────────
async function boot() {
  player.init();
  bindNav();
  bindNowPlaying();

  const [tracks, onlineTracks, tags, settings, sources, playlists] = await Promise.all([
    api.get('/local/tracks'),
    api.get('/online/tracks'),
    api.get('/tags'),
    api.get('/settings'),
    api.get('/sources'),
    api.get('/playlists'),
  ]);
  state.localTracks = tracks;
  state.onlineTracks = onlineTracks;
  state.tags = tags;
  state.settings = settings;
  state.sources = sources;
  state.playlists = playlists;

  // Pre-load today's history
  const today = new Date().toISOString().slice(0, 10);
  state.historyDate = today;
  state.historyTracks = await api.get(`/history?date=${today}&limit=200`);
  await loadHistoryMonth();

  render();

  // Init LX source sandbox
  if (window.sourceHost) {
    try { await window.sourceHost.loadAll(); } catch (e) { console.warn('source init:', e); }
  }

  // Check scan
  const p = await api.get('/local/scan/progress');
  if (p.running) { state.scanProgress = p; render(); pollScan(); }
}

boot();
