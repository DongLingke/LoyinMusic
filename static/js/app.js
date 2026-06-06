/* ═══════════════════════════════════════════════════════════════════
   落音 LoyinMusic — Frontend SPA
   Web-first: runs in any browser, designed for remote access.
   与日迹 DayNote 同属一个系列。
   ═══════════════════════════════════════════════════════════════════ */

// ── API layer ─────────────────────────────────────────────────────
const api = {
  async _req(path, opts) {
    try {
      const r = await fetch(`/api${path}`, opts);
      if (r.status === 401) { location.reload(); return {}; }
      return r.json();
    } catch (e) {
      if (typeof showToast === 'function') showToast('网络请求失败', 'error');
      throw e;
    }
  },
  async get(path) { return this._req(path); },
  async post(path, body) {
    return this._req(path, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  },
  async put(path, body) {
    return this._req(path, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  },
  async del(path) { return this._req(path, { method: 'DELETE' }); },
  async upload(path, file) {
    const fd = new FormData();
    fd.append('file', file);
    return this._req(path, { method: 'POST', body: fd });
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
  localSubView: 'all',     // 'all' | 'albums' | 'artists'
  albums: [],
  artists: [],
  albumFilter: null,       // when viewing one album's tracks
  artistFilter: null,
  addingToPlaylist: null,  // { kind, id } — track pending playlist assignment
};

// ── Wallpaper presets ─────────────────────────────────────────────
// Rich gradients so the frosted glass card has something to refract.
const WALLPAPERS = {
  aurora:   { name: '极光',  css: 'radial-gradient(at 20% 20%, #1a3a5c 0%, transparent 50%), radial-gradient(at 80% 25%, #2d1b4e 0%, transparent 50%), radial-gradient(at 50% 80%, #0d4d4d 0%, transparent 55%), #0a0a14' },
  dusk:     { name: '暮色',  css: 'radial-gradient(at 15% 25%, #4a2545 0%, transparent 50%), radial-gradient(at 85% 30%, #5c3a1e 0%, transparent 50%), radial-gradient(at 50% 90%, #2a1a3e 0%, transparent 55%), #120a14' },
  ocean:    { name: '深海',  css: 'radial-gradient(at 25% 20%, #0d3b66 0%, transparent 55%), radial-gradient(at 75% 35%, #134e5e 0%, transparent 50%), radial-gradient(at 50% 85%, #071e3d 0%, transparent 55%), #060d18' },
  ember:    { name: '炭火',  css: 'radial-gradient(at 20% 25%, #5c1f1f 0%, transparent 50%), radial-gradient(at 80% 20%, #6b3410 0%, transparent 50%), radial-gradient(at 50% 90%, #2e0f0f 0%, transparent 55%), #140807' },
  forest:   { name: '森林',  css: 'radial-gradient(at 25% 20%, #1e4d2b 0%, transparent 52%), radial-gradient(at 80% 30%, #2d5a3d 0%, transparent 50%), radial-gradient(at 50% 88%, #0f2e1a 0%, transparent 55%), #08120c' },
  mono:     { name: '极简',  css: 'radial-gradient(at 30% 25%, #2a2a35 0%, transparent 55%), radial-gradient(at 75% 70%, #1c1c26 0%, transparent 55%), #0c0c12' },
};

// Bundled image wallpapers (ported from Daynote, optimized for web).
const WALLPAPER_IMAGES = Array.from({ length: 14 }, (_, i) => `wp${String(i + 1).padStart(2, '0')}.jpg`);

// Font choices (ported from Daynote).
const FONTS = [
  { key: 'system',    name: '系统',       css: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif' },
  { key: 'rounded',   name: '圆体',       css: '"SF Pro Rounded", ui-rounded, "Hiragino Maru Gothic ProN", "Hiragino Sans GB", system-ui, sans-serif' },
  { key: 'serif',     name: '宋体',       css: 'Georgia, "Songti SC", "STSong", "SimSun", serif' },
  { key: 'fangsong',  name: '仿宋',       css: '"FangSong", "STFangsong", "FangSong_GB2312", serif' },
  { key: 'mono',      name: '等宽',       css: '"SF Mono", Menlo, Consolas, "Courier New", "PingFang SC", monospace' },
  { key: 'humanist',  name: '人文无衬线', css: '"Optima", "Hiragino Sans GB", "PingFang SC", "Helvetica Neue", sans-serif' },
];

// Numeric card-adjustment settings → fallback defaults.
const CARD_DEFAULTS = {
  card_size: '80', card_opacity: '100', card_blur: '48', card_brightness: '104',
  card_saturation: '180', card_radius: '26', card_aspect: '150', card_item_tint: '0',
  font_size: '14', font_weight: '400', font_family: 'system',
};

// UI styles (ported from Daynote): each is a body.style-* class.
const UI_STYLES = [
  { key: 'liquid-glass', name: '液态玻璃' },
  { key: 'flat',         name: '扁平' },
  { key: 'paper',        name: '纸张' },
  { key: 'terminal',     name: '终端' },
];

// Color schemes (ported from Daynote). 'extract' = derive accent from cover.
const COLOR_SCHEMES = [
  { key: 'extract',  name: '自动取色', color: '#888888' },
  { key: 'ocean',    name: '海洋',     color: '#0A84FF' },
  { key: 'morandi',  name: '莫兰迪',   color: '#8B7D6B' },
  { key: 'sakura',   name: '樱花',     color: '#E8829A' },
  { key: 'forest',   name: '森林',     color: '#30A84E' },
  { key: 'sunset',   name: '日落',     color: '#FF6B35' },
  { key: 'lavender', name: '薰衣草',   color: '#9B7BC9' },
  { key: 'mint',     name: '薄荷',     color: '#3DC4A0' },
  { key: 'rose',     name: '玫瑰',     color: '#D24A6B' },
  { key: 'amber',    name: '琥珀',     color: '#C77F2D' },
  { key: 'graphite', name: '石墨',     color: '#5C5C66' },
  { key: 'sky',      name: '天空',     color: '#56A0C7' },
  { key: 'cherry',   name: '樱桃',     color: '#C0392B' },
];

// Apply wallpaper + theme + UI style + card params to the DOM. Reads settings.
function applyAppearance() {
  const s = state.settings;
  const html = document.documentElement;
  const body = document.body;

  // ── Wallpaper: custom URL > image file (wpNN.jpg) > gradient preset ──
  const wpEl = document.getElementById('wallpaper');
  if (wpEl) {
    const wp = s.wallpaper || 'aurora';
    if (s.wallpaper_url) {
      wpEl.style.background = `url("${s.wallpaper_url}") center/cover no-repeat`;
    } else if (/\.(jpg|jpeg|png|webp)$/i.test(wp)) {
      wpEl.style.background = `url("/static/wallpapers/${wp}") center/cover no-repeat`;
    } else {
      wpEl.style.background = (WALLPAPERS[wp] || WALLPAPERS.aurora).css;
    }
  }

  // ── Theme ──
  const isDark = s.theme !== 'light';
  body.classList.toggle('theme-dark', isDark);

  // ── UI style + color scheme classes ──
  body.className = body.className
    .replace(/\bstyle-[\w-]+/g, '').replace(/\bscheme-[\w-]+/g, '').trim();
  body.classList.add(`style-${s.ui_style || 'liquid-glass'}`);
  const scheme = s.color_scheme || 'extract';
  if (scheme !== 'extract') body.classList.add(`scheme-${scheme}`);
  if (scheme !== 'extract' || s.ui_style === 'terminal') {
    html.style.removeProperty('--accent');
    html.style.removeProperty('--accent-hover');
    html.style.removeProperty('--accent-dim');
  }

  // ── Card sizing & glass parameters (ported from Daynote) ──
  const g = k => s[k] || CARD_DEFAULTS[k];
  body.classList.toggle('fullscreen-card', parseInt(g('card_size'), 10) >= 100);
  html.style.setProperty('--card-size', g('card_size'));
  html.style.setProperty('--card-opacity', (parseFloat(g('card_opacity')) / 100).toString());
  const blurPx = parseFloat(g('card_blur'));
  const sat = parseFloat(g('card_saturation')) / 100;
  html.style.setProperty('--glass-blur', `${blurPx}px`);
  html.style.setProperty('--glass-brightness', `${parseFloat(g('card_brightness')) / 100}`);
  html.style.setProperty('--glass-sat', `${sat}`);
  html.style.setProperty('--glass-blur-lg', `${(blurPx * 0.55).toFixed(2)}px`);
  html.style.setProperty('--glass-sat-lg', `${(sat * 1.15).toFixed(3)}`);
  html.style.setProperty('--radius-card', `${g('card_radius')}px`);
  html.style.setProperty('--card-aspect', (parseFloat(g('card_aspect')) / 100).toString());

  // Local-patch tint for items (helps readability on busy wallpapers)
  const tint = parseInt(g('card_item_tint'), 10);
  if (tint > 0) {
    const a = (tint / 100 * 0.32).toFixed(3);
    html.style.setProperty('--item-tint-extra', `rgba(${isDark ? '0,0,0' : '255,255,255'},${a})`);
  } else {
    html.style.removeProperty('--item-tint-extra');
  }

  // ── Fonts ──
  const fnt = FONTS.find(f => f.key === g('font_family')) || FONTS[0];
  html.style.setProperty('--font-size', `${g('font_size')}px`);
  html.style.setProperty('--font-weight', g('font_weight'));
  html.style.setProperty('--font-family', fnt.css);
}

// ── Utilities ─────────────────────────────────────────────────────
const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

function showToast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'error' : ''}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

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
// Parses an LRC string into [{time, text}]. A line may carry several
// timestamps ([t1][t2]text) — each becomes its own entry.
function parseLrcRaw(lrcText) {
  if (!lrcText) return [];
  const out = [];
  lrcText.split('\n').forEach(line => {
    const stamps = [...line.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{2,3}))?\]/g)];
    if (!stamps.length) return;
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) {
      const frac = m[3] ? parseInt(m[3]) / (m[3].length === 3 ? 1000 : 100) : 0;
      out.push({ time: parseInt(m[1]) * 60 + parseInt(m[2]) + frac, text });
    }
  });
  return out.sort((a, b) => a.time - b.time);
}

// Merge a main LRC with an optional translation LRC (tlyric). Lines with
// matching timestamps get a `.trans` field shown under the original.
function parseLrc(lrcText, tlyricText) {
  const main = parseLrcRaw(lrcText);
  if (!tlyricText || state.settings.lyric_show_translation === 'false') return main;
  const trans = parseLrcRaw(tlyricText);
  for (const line of main) {
    const match = trans.find(t => Math.abs(t.time - line.time) < 0.3 && t.text);
    if (match) line.trans = match.text;
  }
  return main;
}

// ── Cover accent color extraction (M6) ────────────────────────
function extractAccentFromCover(imgSrc) {
  if (!imgSrc) return;
  // Only when the color scheme is "extract"; named schemes / terminal own
  // their accent.
  if ((state.settings.color_scheme || 'extract') !== 'extract') return;
  if (state.settings.ui_style === 'terminal') return;
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
const SPEED_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];

const player = {
  audio: null,
  queue: [],
  current: -1,
  playing: false,
  _startTime: 0,
  shuffle: false,
  repeat: 'none',   // 'none' | 'all' | 'one'
  _saveTimer: null,
  _speedIdx: 2,     // index into SPEED_STEPS (1x)
  _crossfade: 0,    // crossfade seconds (0=off)
  _audioCtx: null,  // Web Audio context for visualizer
  _analyser: null,
  _vizRAF: null,

  init() {
    this.audio = document.getElementById('audio-el');
    this.audio.addEventListener('ended', () => this._onEnded());
    this.audio.addEventListener('timeupdate', () => this._onTimeUpdate());
    this.audio.addEventListener('play', () => { this.playing = true; this._updatePlayBtn(); this._startVisualizer(); });
    this.audio.addEventListener('pause', () => { this.playing = false; this._updatePlayBtn(); this._stopVisualizer(); });
    this.audio.addEventListener('error', () => this._onError());

    document.getElementById('btn-play').onclick = () => this.togglePlay();
    document.getElementById('btn-prev').onclick = () => this.prev();
    document.getElementById('btn-next').onclick = () => this.next();
    document.getElementById('btn-shuffle').onclick = () => this.toggleShuffle();
    document.getElementById('btn-repeat').onclick = () => this.cycleRepeat();
    document.getElementById('btn-queue').onclick = () => this.toggleQueuePanel();
    document.getElementById('btn-clear-queue').onclick = () => {
      this.queue = []; this.current = -1; this._renderQueue(); this._saveLast();
    };

    // ❤️ Favorite button
    document.getElementById('btn-fav').onclick = () => this._toggleFav();

    // ⏩ Speed button
    document.getElementById('btn-speed').onclick = () => this._cycleSpeed();

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
      this.shuffle = s.shuffle === 'true';
      this.repeat = s.repeat_mode || 'none';
      this._crossfade = parseInt(s.crossfade || '0', 10);
      this._updateModeButtons();
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

    // Init Web Audio for visualizer (deferred until first play)
    this._initAudioContext();
  },

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    api.put('/settings', { shuffle: String(this.shuffle) });
    this._updateModeButtons();
  },
  cycleRepeat() {
    this.repeat = { none: 'all', all: 'one', one: 'none' }[this.repeat];
    api.put('/settings', { repeat_mode: this.repeat });
    this._updateModeButtons();
  },
  _updateModeButtons() {
    const sb = document.getElementById('btn-shuffle');
    const rb = document.getElementById('btn-repeat');
    if (sb) sb.classList.toggle('on', this.shuffle);
    if (rb) {
      rb.classList.toggle('on', this.repeat !== 'none');
      rb.textContent = this.repeat === 'one' ? '🔂' : '🔁';
      rb.title = { none: '循环：关', all: '循环：列表', one: '循环：单曲' }[this.repeat];
    }
  },

  toggleQueuePanel() {
    const p = document.getElementById('queue-panel');
    p.classList.toggle('hidden');
    if (!p.classList.contains('hidden')) this._renderQueue();
  },
  _renderQueue() {
    const el = document.getElementById('queue-list');
    if (!el) return;
    if (!this.queue.length) {
      el.innerHTML = '<div style="padding:16px;color:var(--text-tertiary);text-align:center;font-size:0.8rem">队列为空</div>';
      return;
    }
    el.innerHTML = this.queue.map((t, i) => `
      <div class="queue-item ${i === this.current ? 'current' : ''}" data-qi="${i}">
        <span class="queue-item-idx">${i === this.current ? '🔊' : i + 1}</span>
        <div class="queue-item-meta">
          <div class="queue-item-title">${esc(t.title || '未知')}${t.kind === 'online' && t.source && t.source !== 'url' ? ` <span class="queue-src">${t.source}</span>` : ''}</div>
          <div class="queue-item-artist">${esc(t.artist || '')}</div>
        </div>
        <button class="queue-item-rm" data-qrm="${i}" title="移除">✕</button>
      </div>`).join('');
    el.querySelectorAll('.queue-item').forEach(item => {
      item.onclick = (e) => {
        if (e.target.closest('[data-qrm]')) return;
        const i = parseInt(item.dataset.qi, 10);
        this.current = i; this._load(this.queue[i]); this._renderQueue();
      };
    });
    el.querySelectorAll('[data-qrm]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const i = parseInt(btn.dataset.qrm, 10);
        this.queue.splice(i, 1);
        if (i < this.current) this.current--;
        else if (i === this.current) this.current = Math.min(this.current, this.queue.length - 1);
        this._renderQueue(); this._saveLast();
      };
    });
  },

  playTrack(track, queue, idx) {
    this.queue = queue || [track];
    this.current = idx ?? 0;
    this._load(track);
  },

  /** Insert a track right after the current position in the queue. */
  playNext(track) {
    if (!this.queue.length) {
      // Nothing playing — just start it
      this.playTrack(track, [track], 0);
      return;
    }
    // Remove duplicate if already in queue
    const dup = this.queue.findIndex(t => t.kind === track.kind && t.id === track.id);
    if (dup >= 0) {
      this.queue.splice(dup, 1);
      if (dup < this.current) this.current--;
      else if (dup === this.current) { this.current = Math.min(this.current, this.queue.length - 1); }
    }
    // Insert right after current
    this.queue.splice(this.current + 1, 0, track);
    this._saveLast();
    const qp = document.getElementById('queue-panel');
    if (qp && !qp.classList.contains('hidden')) this._renderQueue();
    showToast(`"${track.title}" 将在下一首播放`);
  },

  async _load(track) {
    let url;
    if (track.kind === 'local') {
      url = `/api/local/stream/${track.id}`;
    } else {
      // Online: try cached URL first — but check expiry (5 min)
      url = track.url_cache || '';
      if (url && track.url_cache_at) {
        const age = Date.now() - new Date(track.url_cache_at).getTime();
        if (age > 5 * 60 * 1000) url = '';  // expired, re-resolve
      }
      if (!url && track.source && track.source !== 'url' && track.source !== 'itunes') {
        try {
          url = await this._resolveOnlineUrl(track);
        } catch (e) {
          showToast(`解析失败: ${e.message || '未知错误'}`, 'error');
        }
      }
      if (!url) url = track.url_cache || track.path || '';
    }
    if (!url) {
      showToast('无法获取播放链接', 'error');
      this.next();
      return;
    }
    this.audio.src = url;
    this.audio.play();
    this._startTime = Date.now();
    this._updateBar(track);
    this._updateMediaSession(track);
    document.querySelectorAll('.track-row').forEach(r => {
      r.classList.toggle('playing',
        r.dataset.kind === track.kind && r.dataset.id === String(track.id));
    });
    const qp = document.getElementById('queue-panel');
    if (qp && !qp.classList.contains('hidden')) this._renderQueue();
    this._saveLast();
  },

  async _resolveOnlineUrl(track) {
    if (!window.sourceHost) throw new Error('no source host');
    const preferred = state.settings.default_quality_online || '320k';
    const fallbackStr = state.settings.quality_fallback_order || 'flac,flac24bit,320k,128k';
    const fallbacks = fallbackStr.split(',').map(s => s.trim());
    // Build ordered list: preferred first, then fallback order (deduped)
    const tryOrder = [preferred, ...fallbacks.filter(q => q !== preferred)];
    const musicInfo = track.source_meta ? JSON.parse(track.source_meta) : { songmid: track.source_id };
    let url = '';
    let usedQuality = preferred;
    for (const q of tryOrder) {
      try {
        const result = await window.sourceHost.request(track.source, 'musicUrl', {
          type: q, musicInfo,
        }, 15000);
        if (result && typeof result === 'string' && result.startsWith('http')) {
          url = result;
          usedQuality = q;
          break;
        }
      } catch { /* try next quality */ }
    }
    if (!url) throw new Error('all qualities failed');
    // Cache it (only for DB-saved tracks with numeric IDs)
    if (typeof track.id === 'number' && track.id > 0) {
      api.put(`/online/tracks/${track.id}`, {
        url_cache: url,
        url_cache_at: new Date().toISOString(),
        url_cache_q: usedQuality,
      });
    }
    return url;
  },

  togglePlay() { if (!this.audio.src) return; this.audio.paused ? this.audio.play() : this.audio.pause(); },

  _nextIndex() {
    if (this.queue.length <= 1) return this.current;
    if (this.shuffle) {
      let i; do { i = Math.floor(Math.random() * this.queue.length); } while (i === this.current);
      return i;
    }
    return (this.current + 1) % this.queue.length;
  },
  next(auto = false) {
    if (!this.queue.length) return;
    // auto = triggered by track ending (respects repeat-none stop-at-end)
    if (auto && this.repeat === 'none' && !this.shuffle && this.current === this.queue.length - 1) {
      this.playing = false; this._updatePlayBtn(); return;
    }
    this.current = this._nextIndex();
    this._load(this.queue[this.current]);
  },
  prev() {
    if (!this.queue.length) return;
    if (this.audio.currentTime > 3) { this.audio.currentTime = 0; return; }
    this.current = this.shuffle ? this._nextIndex() : (this.current - 1 + this.queue.length) % this.queue.length;
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
    if (this.repeat === 'one') { this._load(this.queue[this.current]); return; }
    this.next(true);
  },

  // Persist queue + position so playback resumes after reload (debounced)
  _saveLast() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      const payload = {
        queue: this.queue.map(t => ({ kind: t.kind, id: t.id, title: t.title, artist: t.artist,
          album: t.album, duration_ms: t.duration_ms, cover_hash: t.cover_hash, cover_url: t.cover_url,
          source: t.source, source_id: t.source_id, source_meta: t.source_meta,
          url_cache: t.url_cache, url_cache_at: t.url_cache_at })),
        current: this.current,
        time: Math.floor(this.audio.currentTime || 0),
      };
      api.put('/settings', { last_playing: JSON.stringify(payload) });
    }, 1500);
  },

  // Restore queue on boot WITHOUT autoplaying (browsers block autoplay anyway)
  restoreLast() {
    try {
      const raw = state.settings.last_playing;
      if (!raw) return;
      const d = JSON.parse(raw);
      if (!d.queue || !d.queue.length) return;
      this.queue = d.queue;
      this.current = d.current ?? 0;
      const track = this.queue[this.current];
      if (!track) return;
      this._currentTrack = track;
      this._updateBar(track);
      this._updateMediaSession(track);
      // Prime the audio src + seek position, but stay paused
      const url = track.kind === 'local' ? `/api/local/stream/${track.id}` : (track.url_cache || '');
      if (url) {
        this.audio.src = url;
        this.audio.addEventListener('loadedmetadata', () => {
          if (d.time) this.audio.currentTime = d.time;
        }, { once: true });
      }
    } catch {}
  },
  _onError() {
    const track = this.queue[this.current];
    showToast(`播放出错${track ? ': ' + track.title : ''}，跳过`, 'error');
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
    this._applyCrossfade();
  },
  _updatePlayBtn() {
    document.getElementById('btn-play').textContent = this.playing ? '⏸' : '▶';
    if (!this.playing && !this.audio.src) document.title = '落音 LoyinMusic';
  },
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
    let src = coverUrl(track);
    // #3 pic fallback: if no cover and source has 'pic' action, try it
    if (!src && track.kind === 'online' && track.source && track.source !== 'url'
        && track.source !== 'itunes' && window.sourceHost) {
      this._resolveCover(track).then(url => {
        if (!url) return;
        coverEl.innerHTML = `<img src="${esc(url)}" alt="">`;
        document.getElementById('np-cover-lg').innerHTML = `<img src="${esc(url)}" alt="">`;
        extractAccentFromCover(url);
      });
    }
    coverEl.innerHTML = src ? `<img src="${esc(src)}" alt="">` : '';
    // Now-playing overlay
    const npCover = document.getElementById('np-cover-lg');
    npCover.innerHTML = src ? `<img src="${esc(src)}" alt="">` : '';
    document.getElementById('np-title-lg').textContent = track.title || '未知曲目';
    document.getElementById('np-artist-lg').textContent = track.artist || '';
    document.getElementById('np-album-lg').textContent = track.album || '';
    // Page title
    document.title = `${track.title || '未知曲目'} - ${track.artist || ''} | 落音`.replace(/ - \|/, ' |');
    // Cover accent (M6)
    extractAccentFromCover(src);
    // Load lyrics (M6)
    this.lyrics = [];
    this._loadLyrics(track);
    // Load note (M9)
    this._loadNote(track);
    // Check favorite state
    this._checkFav(track);
  },

  async _resolveCover(track) {
    try {
      const info = track.source_meta ? JSON.parse(track.source_meta) : { songmid: track.source_id };
      const url = await window.sourceHost.request(track.source, 'pic', { musicInfo: info }, 8000);
      if (url && typeof url === 'string') {
        // Cache it
        if (typeof track.id === 'number' && track.id > 0) {
          api.put(`/online/tracks/${track.id}`, { cover_url: url });
        }
        return url;
      }
    } catch {}
    return null;
  },

  async _loadLyrics(track) {
    let lrc = track.lyric_cache || '';
    let tlyric = '';
    // Try fetching from source sandbox
    if (!lrc && track.kind === 'online' && track.source && track.source !== 'url' && window.sourceHost) {
      try {
        const info = track.source_meta ? JSON.parse(track.source_meta) : { songmid: track.source_id };
        const result = await window.sourceHost.request(track.source, 'lyric', { musicInfo: info });
        if (result && typeof result === 'object') { lrc = result.lyric || ''; tlyric = result.tlyric || ''; }
        else if (typeof result === 'string') lrc = result;
        if (lrc && track.id) api.put(`/online/tracks/${track.id}`, { lyric_cache: lrc });
      } catch {}
    }
    this.lyrics = parseLrc(lrc, tlyric);
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
      `<div class="lyric-line" data-lyric-idx="${i}">${esc(l.text || '···')}${l.trans ? `<div class="lyric-trans">${esc(l.trans)}</div>` : ''}</div>`
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

  // ── ❤️ Favorite (auto-creates "我喜欢" tag, toggles for current track) ──
  async _toggleFav() {
    const track = this._currentTrack;
    if (!track || typeof track.id !== 'number') return;
    const kind = track.kind || 'local';
    // Ensure "我喜欢" tag exists
    let favTag = state.tags.find(t => t.name === '我喜欢');
    if (!favTag) {
      favTag = await api.post('/tags', { name: '我喜欢', color: '#FF3B58' });
      state.tags = await api.get('/tags');
    }
    const trackTags = await api.get(`/tracks/${kind}/${track.id}/tags`);
    const tagIds = trackTags.map(t => t.id);
    const isFav = tagIds.includes(favTag.id);
    if (isFav) {
      await api.put(`/tracks/${kind}/${track.id}/tags`, { tag_ids: tagIds.filter(id => id !== favTag.id) });
      showToast('已取消喜欢');
    } else {
      await api.put(`/tracks/${kind}/${track.id}/tags`, { tag_ids: [...tagIds, favTag.id] });
      showToast('已添加到我喜欢 ♥');
    }
    this._updateFavBtn(!isFav);
  },
  _updateFavBtn(isFav) {
    const btn = document.getElementById('btn-fav');
    if (btn) { btn.textContent = isFav ? '♥' : '♡'; btn.classList.toggle('on', isFav); }
  },
  async _checkFav(track) {
    if (!track || typeof track.id !== 'number') { this._updateFavBtn(false); return; }
    const kind = track.kind || 'local';
    try {
      const tags = await api.get(`/tracks/${kind}/${track.id}/tags`);
      this._updateFavBtn(tags.some(t => t.name === '我喜欢'));
    } catch { this._updateFavBtn(false); }
  },

  // ── ⏩ Playback speed ──────────────────────────────────────────
  _cycleSpeed() {
    this._speedIdx = (this._speedIdx + 1) % SPEED_STEPS.length;
    const speed = SPEED_STEPS[this._speedIdx];
    this.audio.playbackRate = speed;
    document.getElementById('btn-speed').textContent = speed === 1 ? '1x' : speed + 'x';
    showToast(`播放速度 ${speed}x`);
  },

  // ── 🔀 Crossfade ──────────────────────────────────────────────
  _applyCrossfade() {
    if (!this._crossfade || !this.audio.duration) return;
    const remaining = this.audio.duration - this.audio.currentTime;
    if (remaining <= this._crossfade && remaining > 0.3 && !this._crossfading) {
      this._crossfading = true;
      // Fade out current
      const fadeOut = setInterval(() => {
        if (this.audio.volume > 0.02) this.audio.volume -= 0.02;
        else { clearInterval(fadeOut); this._crossfading = false; }
      }, this._crossfade * 1000 / 50);
    }
  },

  // ── 🎵 Audio visualizer ──────────────────────────────────────
  _initAudioContext() {
    try {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this._analyser = this._audioCtx.createAnalyser();
      this._analyser.fftSize = 128;
      const source = this._audioCtx.createMediaElementSource(this.audio);
      source.connect(this._analyser);
      this._analyser.connect(this._audioCtx.destination);
    } catch { /* Web Audio not available */ }
  },
  _startVisualizer() {
    if (!this._analyser) return;
    if (this._audioCtx.state === 'suspended') this._audioCtx.resume();
    const canvas = document.getElementById('np-visualizer');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const bufLen = this._analyser.frequencyBinCount;
    const data = new Uint8Array(bufLen);
    const draw = () => {
      this._vizRAF = requestAnimationFrame(draw);
      this._analyser.getByteFrequencyData(data);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barW = canvas.width / bufLen * 2;
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#007AFF';
      ctx.fillStyle = accent;
      for (let i = 0; i < bufLen; i++) {
        const h = (data[i] / 255) * canvas.height;
        ctx.globalAlpha = 0.4 + (data[i] / 255) * 0.6;
        ctx.fillRect(i * barW, canvas.height - h, barW - 1, h);
      }
      ctx.globalAlpha = 1;
    };
    draw();
  },
  _stopVisualizer() {
    if (this._vizRAF) { cancelAnimationFrame(this._vizRAF); this._vizRAF = null; }
  },
};

// ── Track table renderer (shared by local / online / tags) ────────
const PAGE_SIZE = 100;
function renderTrackTable(tracks, kindCol = false) {
  if (!tracks.length) return '';
  const total = tracks.length;
  const page = state._trackPage || 0;
  const paged = total > PAGE_SIZE ? tracks.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) : tracks;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  let html = '';
  if (totalPages > 1) {
    html += `<div class="pagination">
      <button class="btn btn-ghost" ${page <= 0 ? 'disabled' : ''} data-act="page-prev">← 上一页</button>
      <span class="page-info">${page + 1} / ${totalPages}（共 ${total} 首）</span>
      <button class="btn btn-ghost" ${page >= totalPages - 1 ? 'disabled' : ''} data-act="page-next">下一页 →</button>
    </div>`;
  }
  html += `<table class="track-table"><thead><tr>
    <th class="td-idx">#</th><th class="td-cover"></th>
    <th class="td-title">标题</th><th class="td-artist">艺人</th>
    <th class="td-album">专辑</th>
    ${kindCol ? '<th class="td-kind">来源</th>' : ''}
    <th class="td-duration">时长</th><th class="td-actions"></th>
  </tr></thead><tbody>`;
  const offset = page * PAGE_SIZE;
  paged.forEach((t, i) => {
    const cv = coverUrl(t);
    const kind = t.kind || t.track_kind || 'local';
    const id = t.id || t.track_id;
    const cur = player.queue[player.current];
    const isPlaying = cur && cur.kind === kind && cur.id === id;
    const num = offset + i;
    html += `<tr class="track-row ${isPlaying ? 'playing' : ''}" data-kind="${kind}" data-id="${id}" data-idx="${num}">
      <td class="td-idx">${isPlaying ? '🔊' : num + 1}</td>
      <td class="td-cover">${cv ? `<img src="${esc(cv)}" alt="" loading="lazy">` : '<div style="width:32px;height:32px;border-radius:4px;background:var(--bg-hover)"></div>'}</td>
      <td class="td-title"><span class="track-name">${esc(t.title || '')}</span></td>
      <td class="td-artist">${esc(t.artist || '')}</td>
      <td class="td-album">${esc(t.album || '')}</td>
      ${kindCol ? `<td class="td-kind">${kindBadge(kind)}</td>` : ''}
      <td class="td-duration">${fmtTime(t.duration_ms)}</td>
      <td class="td-actions">
        <button class="btn-tag-action" data-act="play-next" data-kind="${kind}" data-id="${id}" title="下一首播放">⏭</button>
        <button class="btn-tag-action" data-act="add-to-playlist" data-kind="${kind}" data-id="${id}" title="加入歌单">➕</button>
        <button class="btn-tag-action" data-act="open-tagger" data-kind="${kind}" data-id="${id}" title="标签">🏷</button>
        <button class="btn-tag-action" data-act="del-track" data-kind="${kind}" data-id="${id}" title="删除" style="opacity:0.4">✕</button>
      </td>
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
  const sub = state.localSubView;
  let html = `<div class="view-header">
    <div style="display:flex;align-items:center;gap:12px">
      <div class="view-title">本地音乐</div>
      <button class="btn btn-ghost" data-act="shuffle-all" style="font-size:0.78rem;padding:3px 10px" title="随机播放全部">🎲 随机</button>
      <div class="subtab-row">
        <button class="subtab ${sub==='all'?'active':''}" data-act="local-sub" data-sub="all">全部</button>
        <button class="subtab ${sub==='albums'?'active':''}" data-act="local-sub" data-sub="albums">专辑</button>
        <button class="subtab ${sub==='artists'?'active':''}" data-act="local-sub" data-sub="artists">艺人</button>
      </div>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <select class="settings-select" data-act="set-sort" style="font-size:0.78rem;padding:3px 6px">
        <option value="added_at:desc" ${(state._localSort||'added_at:desc')==='added_at:desc'?'selected':''}>最近添加</option>
        <option value="title:asc" ${state._localSort==='title:asc'?'selected':''}>标题 A-Z</option>
        <option value="artist:asc" ${state._localSort==='artist:asc'?'selected':''}>艺人 A-Z</option>
        <option value="play_count:desc" ${state._localSort==='play_count:desc'?'selected':''}>最多播放</option>
        <option value="duration_ms:desc" ${state._localSort==='duration_ms:desc'?'selected':''}>时长</option>
      </select>
      <div class="search-box"><span class="search-icon">🔍</span>
        <input type="search" id="search-input" placeholder="搜索标题 / 艺人 / 专辑..." value="${esc(state.searchQuery)}">
      </div>
    </div>
  </div>`;

  if (state.scanProgress && state.scanProgress.running) {
    const p = state.scanProgress;
    const pct = p.total > 0 ? Math.round(p.done / p.total * 100) : 0;
    html += `<div class="scan-bar"><span>扫描中... ${p.done}/${p.total}</span>
      <div class="scan-bar-progress"><div class="scan-bar-fill" style="width:${pct}%"></div></div>
      <span>${esc(p.current)}</span></div>`;
  }

  // Drill-down: viewing one album or artist's tracks
  if (state.albumFilter || state.artistFilter) {
    const label = state.albumFilter || state.artistFilter;
    const tracks = state.localTracks.filter(t =>
      state.albumFilter ? t.album === state.albumFilter : t.artist === state.artistFilter);
    html += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <button class="btn btn-ghost" data-act="local-back">← 返回</button>
      <span class="view-title" style="font-size:1.05rem">${esc(label)}</span>
      <span class="count">(${tracks.length})</span>
    </div>`;
    html += renderTrackTable(tracks.map(t => ({ ...t, kind: 'local' })));
    return html;
  }

  const q = state.searchQuery.toLowerCase();

  if (sub === 'albums') {
    const albums = q ? state.albums.filter(a => (a.album+a.album_artist).toLowerCase().includes(q)) : state.albums;
    if (!albums.length) { html += emptyLocal(); return html; }
    html += `<div class="cover-grid">${albums.map(a => `
      <div class="cover-card" data-act="open-album" data-album="${esc(a.album)}">
        <div class="cover-art">${a.cover_hash ? `<img src="/api/local/cover/${a.cover_hash}" loading="lazy">` : '<div class="cover-ph">💿</div>'}</div>
        <div class="cover-name">${esc(a.album)}</div>
        <div class="cover-sub">${esc(a.album_artist || '')} · ${a.track_count}首</div>
      </div>`).join('')}</div>`;
    return html;
  }

  if (sub === 'artists') {
    const artists = q ? state.artists.filter(a => a.artist.toLowerCase().includes(q)) : state.artists;
    if (!artists.length) { html += emptyLocal(); return html; }
    html += `<div class="cover-grid">${artists.map(a => `
      <div class="cover-card artist" data-act="open-artist" data-artist="${esc(a.artist)}">
        <div class="cover-art round"><div class="cover-ph">🎤</div></div>
        <div class="cover-name">${esc(a.artist)}</div>
        <div class="cover-sub">${a.album_count}张专辑 · ${a.track_count}首</div>
      </div>`).join('')}</div>`;
    return html;
  }

  // 'all'
  const tracks = state.localTracks;
  const filtered = q ? tracks.filter(t => (t.title+t.artist+t.album).toLowerCase().includes(q)) : tracks;
  if (!filtered.length) { html += emptyLocal(tracks.length === 0); return html; }
  html += renderTrackTable(filtered.map(t => ({ ...t, kind: 'local' })));
  return html;
}

function emptyLocal(noData = true) {
  return `<div class="empty-state"><div class="empty-icon">🎵</div><div class="empty-text">
    ${noData ? '还没有本地音乐<br>在「设置」中添加扫描目录，然后点击「扫描」' : '没有匹配的结果'}
  </div></div>`;
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
      <button class="btn btn-ghost" id="btn-import-pl">导入歌单</button>
      <div class="search-box"><span class="search-icon">🔍</span>
        <input type="search" id="search-input" placeholder="搜索关键词，回车搜索…" value="${esc(state.searchQuery)}">
      </div>
      <button class="btn btn-primary" id="btn-source-search">搜索</button>
    </div>
  </div>`;

  // Loading state
  if (state._searchLoading) {
    html += `<div class="search-loading"><div class="search-spinner"></div><span>搜索中...</span></div>`;
  }

  // No results message
  if (state._searchNoResults && !state._searchLoading && !state.onlineSearchResults.length) {
    html += `<div style="padding:24px;text-align:center;color:var(--text-tertiary)">没有找到相关歌曲，换个关键词试试</div>`;
  }

  // Search results (iTunes built-in + platform sources)
  if (state.onlineSearchResults.length) {
    // Platform filter tabs
    const allSrcs = state._searchAllSources || [];
    const curFilter = state._searchSourceFilter || 'all';
    const PLATFORM_NAMES = { itunes:'iTunes', kw:'酷我', wy:'网易云', tx:'QQ音乐', kg:'酷狗', mg:'咪咕' };
    html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <div class="settings-section-title" style="margin:0;flex-shrink:0">搜索结果</div>
      <div class="subtab-row" style="flex-wrap:wrap">
        <button class="subtab ${curFilter==='all'?'active':''}" data-act="filter-source" data-src="all">全部 (${state.onlineSearchResults.length})</button>
        ${allSrcs.map(s => {
          const count = state.onlineSearchResults.filter(r => r.source === s).length;
          return `<button class="subtab ${curFilter===s?'active':''}" data-act="filter-source" data-src="${s}">${PLATFORM_NAMES[s]||s} (${count})</button>`;
        }).join('')}
      </div>
      <button class="btn btn-ghost" style="font-size:0.72rem;padding:2px 8px;margin-left:auto" id="btn-clear-results">清除</button>
    </div>`;
    const filtered = curFilter === 'all' ? state.onlineSearchResults : state.onlineSearchResults.filter(r => r.source === curFilter);
    html += renderSearchResults(filtered);
    html += '<div style="margin:18px 0;border-top:1px solid var(--divider)"></div>';
    html += '<div class="settings-section-title">我的收藏</div>';
  }

  if (!filtered.length && !state.onlineSearchResults.length && !state._searchLoading) {
    const history = _getSearchHistory();
    const historyHtml = history.length ? `<div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:6px;justify-content:center">${history.map(h =>
      `<button class="btn btn-ghost" data-act="search-history" data-q="${esc(h)}" style="font-size:0.78rem;padding:3px 10px">${esc(h)}</button>`
    ).join('')}</div>` : '';
    html += `<div class="empty-state"><div class="empty-icon">🌐</div><div class="empty-text">
      搜索框输入关键词即可搜索（内置 5 大平台 + iTunes）<br>装上洛雪音源脚本后可在线播放完整曲目 · 也可「+ 外链」添加直链
      ${historyHtml}
    </div></div>`;
  } else if (filtered.length) {
    html += renderTrackTable(filtered.map(t => ({ ...t, kind: 'online' })));
  }
  return html;
}

// Search results render with a 收藏(save) action (results aren't in DB yet)
function renderSearchResults(results) {
  let html = `<table class="track-table"><thead><tr>
    <th class="td-idx">#</th><th class="td-cover"></th>
    <th class="td-title">标题</th><th class="td-artist">艺人</th>
    <th class="td-album">专辑</th><th class="td-kind">来源</th>
    <th class="td-duration">时长</th><th class="td-actions"></th>
  </tr></thead><tbody>`;
  results.forEach((t, i) => {
    const cv = t.cover_url || '';
    html += `<tr class="track-row" data-search-idx="${i}">
      <td class="td-idx">${i + 1}</td>
      <td class="td-cover">${cv ? `<img src="${esc(cv)}" loading="lazy">` : '<div style="width:28px;height:28px;border-radius:4px;background:var(--item-glass)"></div>'}</td>
      <td class="td-title"><span class="track-name">${esc(t.title || '')}</span>${t.is_preview ? ' <span class="kind-badge online">试听</span>' : ''}</td>
      <td class="td-artist">${esc(t.artist || '')}</td>
      <td class="td-album">${esc(t.album || '')}</td>
      <td class="td-kind">${esc(t.source || '')}</td>
      <td class="td-duration">${fmtTime(t.duration_ms)}</td>
      <td class="td-actions"><button class="btn-tag-action" data-act="save-result" data-search-idx="${i}" title="收藏">⭐</button></td>
    </tr>`;
  });
  html += '</tbody></table>';
  return html;
}

// ── M2: Tags view ─────────────────────────────────────────────────
function renderTagsView() {
  let html = `<div class="view-header">
    <div class="view-title">标签</div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-ghost" id="btn-add-smart-tag">+ 智能标签</button>
      <button class="btn btn-primary" id="btn-add-tag">+ 新建标签</button>
    </div>
  </div>`;

  if (!state.tags.length) {
    html += `<div class="empty-state"><div class="empty-icon">🏷</div>
      <div class="empty-text">还没有标签<br>「新建标签」手动给音乐分类，或「智能标签」按规则自动聚合</div></div>`;
    return html;
  }

  const userTags = state.tags.filter(t => t.kind !== 'smart');
  const smartTags = state.tags.filter(t => t.kind === 'smart');

  const chip = t => {
    const active = state.activeTagId === t.id;
    const isSmart = t.kind === 'smart';
    const colorStyle = t.color ? `border-left:3px solid ${t.color};` : '';
    return `<div class="tag-chip ${active ? 'active' : ''} ${isSmart ? 'smart' : ''}" data-act="select-tag" data-tag-id="${t.id}" style="${colorStyle}">
      <span>${isSmart ? '⚡ ' : ''}${esc(t.name)}</span>
      <span class="tag-remove" data-act="del-tag" data-id="${t.id}">&times;</span>
    </div>`;
  };

  if (smartTags.length) {
    html += '<div class="settings-section-title" style="margin-top:0">智能标签（自动）</div>';
    html += '<div class="tags-row" style="gap:8px;margin-bottom:16px">' + smartTags.map(chip).join('') + '</div>';
  }
  if (userTags.length) {
    html += '<div class="settings-section-title">我的标签</div>';
    html += '<div class="tags-row" style="gap:8px;margin-bottom:16px">' + userTags.map(chip).join('') + '</div>';
  }

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
      ${items.length ? '<button class="btn btn-primary" id="btn-play-all">▶ 播放全部</button>' : ''}
      ${items.length ? '<button class="btn btn-ghost" id="btn-export-playlist">导出</button>' : ''}
    </div>`;
    if (items.length) {
      // Render with drag handles for reorder
      html += `<table class="track-table playlist-sortable"><thead><tr>
        <th style="width:24px"></th><th class="td-idx">#</th><th class="td-cover"></th>
        <th class="td-title">标题</th><th class="td-artist">艺人</th>
        <th class="td-album">专辑</th><th class="td-kind">来源</th>
        <th class="td-duration">时长</th><th class="td-actions"></th>
      </tr></thead><tbody>`;
      items.forEach((t, i) => {
        const kind = t.track_kind;
        const id = t.track_id;
        const cv = coverUrl(t);
        html += `<tr class="track-row" draggable="true" data-kind="${kind}" data-id="${id}" data-pos="${i}">
          <td class="drag-handle" title="拖拽排序">☰</td>
          <td class="td-idx">${i + 1}</td>
          <td class="td-cover">${cv ? `<img src="${esc(cv)}" loading="lazy">` : '<div style="width:28px;height:28px;border-radius:4px;background:var(--bg-hover)"></div>'}</td>
          <td class="td-title"><span class="track-name">${esc(t.title || '')}</span></td>
          <td class="td-artist">${esc(t.artist || '')}</td>
          <td class="td-album">${esc(t.album || '')}</td>
          <td class="td-kind">${kindBadge(kind)}</td>
          <td class="td-duration">${fmtTime(t.duration_ms)}</td>
          <td class="td-actions">
            <button class="btn-tag-action" data-act="rm-from-playlist" data-pos="${i}" title="移除">✕</button>
          </td>
        </tr>`;
      });
      html += '</tbody></table>';
    } else {
      html += '<div style="padding:20px;color:var(--text-tertiary);text-align:center">歌单为空 — 在其他视图的曲目用 ➕ 加入这里</div>';
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

  // Appearance
  const curWp = s.wallpaper || 'aurora';
  html += `<details class="settings-section" open>
    <summary class="settings-section-title">外观 <button class="btn btn-ghost reset-btn" data-act="reset-section" data-section="appearance" style="font-size:0.7rem;padding:2px 8px;margin-left:8px">恢复默认</button></summary>
    <div class="settings-group">
      <div class="settings-row" style="flex-direction:column;align-items:stretch;gap:10px">
        <div class="settings-row-label">壁纸图片</div>
        <div class="wp-img-grid">
          ${WALLPAPER_IMAGES.map(fn => `
            <div class="wp-img ${!s.wallpaper_url && curWp === fn ? 'active' : ''}"
                 data-act="set-wallpaper" data-wp="${fn}">
              <img src="/static/wallpapers/${fn}" loading="lazy" alt="">
            </div>
          `).join('')}
        </div>
        <div class="settings-row-label" style="margin-top:6px">渐变壁纸</div>
        <div class="wp-grid">
          ${Object.entries(WALLPAPERS).map(([key, wp]) => `
            <div class="wp-swatch ${!s.wallpaper_url && curWp === key ? 'active' : ''}"
                 data-act="set-wallpaper" data-wp="${key}"
                 style="background:${wp.css}" title="${wp.name}">
              <span class="wp-swatch-name">${wp.name}</span>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="settings-row">
        <div><div class="settings-row-label">自定义壁纸</div>
          <div class="settings-row-sub">填入图片 URL（留空则用上方预设）</div></div>
        <button class="btn btn-ghost" id="btn-set-wp-url">${s.wallpaper_url ? '更换' : '设置'}</button>
      </div>
      ${s.wallpaper_url ? `<div class="settings-row">
        <div class="settings-row-sub" style="word-break:break-all;flex:1">${esc(s.wallpaper_url)}</div>
        <button class="btn btn-ghost" style="color:var(--danger)" id="btn-clear-wp-url">清除</button>
      </div>` : ''}
      <div class="settings-row" style="flex-direction:column;align-items:stretch;gap:8px">
        <div class="settings-row-label">界面风格</div>
        <div class="style-grid">
          ${UI_STYLES.map(st => `
            <div class="style-swatch ${(s.ui_style||'liquid-glass')===st.key?'active':''} preview-${st.key}"
                 data-act="set-style" data-style="${st.key}">
              <div class="style-swatch-demo"><span class="sw-card"></span></div>
              <div class="style-swatch-name">${st.name}</div>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="settings-row" style="flex-direction:column;align-items:stretch;gap:8px">
        <div class="settings-row-label">配色方案</div>
        <div class="scheme-grid">
          ${COLOR_SCHEMES.map(c => `
            <div class="scheme-chip ${(s.color_scheme||'extract')===c.key?'active':''}"
                 data-act="set-scheme" data-scheme="${c.key}">
              <span class="scheme-dot" style="background:${c.key==='extract' ? 'conic-gradient(#ff6b35,#0a84ff,#30a84e,#e8829a,#ff6b35)' : c.color}"></span>
              ${c.name}
            </div>
          `).join('')}
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row-label">主题</div>
        <div style="display:flex;gap:4px">
          <button class="btn ${s.theme !== 'light' ? 'btn-primary' : 'btn-ghost'}" data-act="set-theme" data-theme="dark" style="padding:4px 12px;font-size:0.8rem">深色</button>
          <button class="btn ${s.theme === 'light' ? 'btn-primary' : 'btn-ghost'}" data-act="set-theme" data-theme="light" style="padding:4px 12px;font-size:0.8rem">浅色</button>
        </div>
      </div>
    </div>
  </details>`;

  // Card adjustments (ported from Daynote)
  const cg = k => s[k] || CARD_DEFAULTS[k];
  const slider = (k, label, min, max, unit, disp) => `
    <div class="settings-row">
      <div class="settings-row-label">${label}</div>
      <input type="range" class="settings-slider" min="${min}" max="${max}" value="${cg(k)}" data-act="set-slider" data-k="${k}">
      <span class="settings-slider-val" data-valfor="${k}">${disp ? disp(cg(k)) : cg(k) + (unit||'')}</span>
    </div>`;
  html += `<details class="settings-section" open>
    <summary class="settings-section-title">卡片 <button class="btn btn-ghost reset-btn" data-act="reset-section" data-section="card" style="font-size:0.7rem;padding:2px 8px;margin-left:8px">恢复默认</button></summary>
    <div class="settings-group">
      ${slider('card_size', '尺寸', 50, 100, '%')}
      ${slider('card_opacity', '不透明度', 40, 100, '%')}
      ${slider('card_blur', '磨砂强度', 0, 120, 'px')}
      ${slider('card_brightness', '明暗', 20, 200, '%')}
      ${slider('card_saturation', '饱和度', 50, 200, '%')}
      ${slider('card_radius', '圆角', 0, 60, 'px')}
      ${slider('card_item_tint', '局部底纹', 0, 100, '%')}
      ${slider('card_aspect', '宽高比', 100, 220, '', v => (parseFloat(v)/100).toFixed(2))}
    </div>
  </details>`;

  // Fonts (ported from Daynote)
  html += `<details class="settings-section" open>
    <summary class="settings-section-title">字体 <button class="btn btn-ghost reset-btn" data-act="reset-section" data-section="font" style="font-size:0.7rem;padding:2px 8px;margin-left:8px">恢复默认</button></summary>
    <div class="settings-group">
      <div class="settings-row">
        <div class="settings-row-label">字体</div>
        <select class="settings-select" data-act="set-font">
          ${FONTS.map(f => `<option value="${f.key}" ${cg('font_family')===f.key?'selected':''}>${f.name}</option>`).join('')}
        </select>
      </div>
      ${slider('font_size', '字号', 11, 20, 'px')}
      <div class="settings-row">
        <div class="settings-row-label">字重</div>
        <div style="display:flex;gap:4px">
          ${[['300','细'],['400','常规'],['500','中'],['600','粗']].map(([v,n]) => `
            <button class="btn ${cg('font_weight')===v?'btn-primary':'btn-ghost'}" data-act="set-weight" data-w="${v}" style="padding:4px 10px;font-size:0.8rem">${n}</button>
          `).join('')}
        </div>
      </div>
    </div>
  </details>`;

  // Local music
  html += `<details class="settings-section" open>
    <summary class="settings-section-title">本地音乐</summary>
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
  </details>`;

  // M4: Source management
  html += `<details class="settings-section" open>
    <summary class="settings-section-title">音源管理</summary>
    <div class="settings-group">
      <div class="settings-row">
        <div><div class="settings-row-label">安装音源脚本</div>
          <div class="settings-row-sub">上传洛雪兼容的 .js 音源文件，或通过 URL 导入</div></div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost" id="btn-source-url">URL 导入</button>
          <label class="btn btn-primary" style="cursor:pointer">
            选择文件 <input type="file" accept=".js" id="source-file-input" style="display:none">
          </label>
        </div>
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
  html += `</div></details>`;

  // Playback
  html += `<details class="settings-section" open>
    <summary class="settings-section-title">播放 <button class="btn btn-ghost reset-btn" data-act="reset-section" data-section="playback" style="font-size:0.7rem;padding:2px 8px;margin-left:8px">恢复默认</button></summary>
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
      <div class="settings-row">
        <div><div class="settings-row-label">交叉淡入淡出</div>
          <div class="settings-row-sub">切歌时渐隐渐入，避免突兀</div></div>
        <div style="display:flex;gap:4px">
          ${['0','2','4','6'].map(sec => `
            <button class="btn ${(s.crossfade||'0')===sec ? 'btn-primary' : 'btn-ghost'}"
                    data-act="set-crossfade" data-sec="${sec}" style="padding:4px 10px;font-size:0.8rem">${sec === '0' ? '关' : sec + '秒'}</button>
          `).join('')}
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row-label">显示歌词翻译</div>
        <button class="btn btn-ghost" id="btn-toggle-tlyric">
          ${s.lyric_show_translation !== 'false' ? '✓ 已开启' : '✗ 已关闭'}</button>
      </div>
      <div class="settings-row">
        <div><div class="settings-row-label">睡眠定时</div>
          <div class="settings-row-sub">到时间自动暂停播放</div></div>
        <div style="display:flex;gap:4px">
          ${['off','15','30','60','90'].map(m => `
            <button class="btn ${(state._sleepMinutes||'off')===m ? 'btn-primary' : 'btn-ghost'}"
                    data-act="set-sleep" data-m="${m}" style="padding:4px 10px;font-size:0.8rem">${m === 'off' ? '关' : m + '分'}</button>
          `).join('')}
        </div>
      </div>
      ${state._sleepAt ? `<div class="settings-row"><div class="settings-row-sub">将在 ${new Date(state._sleepAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})} 暂停</div></div>` : ''}
    </div>
  </details>`;

  // M9: Export / Import
  html += `<details class="settings-section" open>
    <summary class="settings-section-title">数据备份</summary>
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
      <div class="settings-row">
        <div><div class="settings-row-label">清除播放历史</div>
          <div class="settings-row-sub" style="color:var(--danger)">删除所有播放记录</div></div>
        <button class="btn btn-ghost" style="color:var(--danger)" id="btn-clear-history">清除</button>
      </div>
    </div>
  </details>`;

  // Advanced
  html += `<details class="settings-section">
    <summary class="settings-section-title">高级</summary>
    <div class="settings-group">
      <div class="settings-row">
        <div><div class="settings-row-label">允许音源网络请求</div>
          <div class="settings-row-sub">音源脚本通过代理发送 HTTP 请求</div></div>
        <button class="btn btn-ghost" id="btn-toggle-proxy">
          ${s.proxy_allow_outbound === 'true' ? '✓ 已开启' : '✗ 已关闭'}</button>
      </div>
    </div>
  </details>`;

  // About
  html += `<div class="settings-about">
    <div style="font-size:1.1rem;font-weight:600">落音 LoyinMusic</div>
    <div style="color:var(--text-tertiary);font-size:0.78rem;margin-top:4px">v1.0.0 · 与日迹 DayNote 同属一个系列</div>
    <div style="color:var(--text-tertiary);font-size:0.72rem;margin-top:2px">
      <a href="https://github.com/DongLingke/LoyinMusic" target="_blank" style="color:var(--accent);text-decoration:none">GitHub</a>
    </div>
  </div>`;

  return html;
}

// ── Stats view ───────────────────────────────────────────────────
function renderStatsView() {
  const s = state._stats;
  if (!s) {
    // Fetch stats async then re-render
    api.get('/stats').then(d => { state._stats = d; if (state.view === 'stats') render(); });
    return '<div class="search-loading"><div class="search-spinner"></div><span>加载统计数据...</span></div>';
  }
  const hours = Math.round(s.total_ms / 3600000);
  const mins = Math.round(s.total_ms / 60000);
  let html = `<div class="view-header"><div class="view-title">听歌统计</div></div>`;

  // Summary cards
  html += `<div class="stats-cards">
    <div class="stat-card"><div class="stat-num">${s.total_plays}</div><div class="stat-label">总播放次数</div></div>
    <div class="stat-card"><div class="stat-num">${hours > 0 ? hours + 'h' : mins + 'min'}</div><div class="stat-label">总听歌时长</div></div>
    <div class="stat-card"><div class="stat-num">${s.local_count}</div><div class="stat-label">本地曲目</div></div>
    <div class="stat-card"><div class="stat-num">${s.online_count}</div><div class="stat-label">在线收藏</div></div>
  </div>`;

  // Daily chart (last 30 days) — simple bar chart with CSS
  if (s.daily?.length) {
    const maxPlays = Math.max(...s.daily.map(d => d.plays), 1);
    html += `<div class="settings-section-title" style="margin-top:16px">最近 30 天</div>`;
    html += `<div class="stats-chart">${s.daily.map(d => {
      const pct = Math.round(d.plays / maxPlays * 100);
      const day = d.day.slice(5); // MM-DD
      return `<div class="chart-bar-wrap" title="${d.day}: ${d.plays} 首">
        <div class="chart-bar" style="height:${pct}%"></div>
        <div class="chart-label">${day}</div>
      </div>`;
    }).join('')}</div>`;
  }

  // Top artists
  if (s.top_artists?.length) {
    html += `<div class="settings-section-title">最爱艺人 Top ${s.top_artists.length}</div>`;
    html += '<div class="stats-list">' + s.top_artists.map((a, i) =>
      `<div class="stats-item"><span class="stats-rank">${i + 1}</span><span class="stats-name">${esc(a.artist)}</span><span class="stats-count">${a.plays} 次</span></div>`
    ).join('') + '</div>';
  }

  // Top tracks
  if (s.top_tracks?.length) {
    html += `<div class="settings-section-title">最爱曲目 Top ${s.top_tracks.length}</div>`;
    html += '<div class="stats-list">' + s.top_tracks.map((t, i) =>
      `<div class="stats-item"><span class="stats-rank">${i + 1}</span><span class="stats-name">${esc(t.title)} <span style="color:var(--text-tertiary)">- ${esc(t.artist || '')}</span></span><span class="stats-count">${t.plays} 次</span></div>`
    ).join('') + '</div>';
  }

  // Duplicate detection
  html += `<div class="settings-section-title" style="margin-top:16px">重复曲目检测
    <button class="btn btn-ghost" style="font-size:0.72rem;padding:2px 8px;margin-left:8px" id="btn-check-dupes">检测</button></div>`;
  if (state._dupes?.length) {
    html += '<div class="stats-list">' + state._dupes.map(d =>
      `<div class="stats-item"><span class="stats-name">${esc(d.title)} - ${esc(d.artist || '未知')}</span><span class="stats-count">${d.cnt} 份 (IDs: ${d.ids})</span></div>`
    ).join('') + '</div>';
  } else if (state._dupes) {
    html += '<div style="padding:12px;color:var(--text-tertiary);text-align:center">没有发现重复曲目</div>';
  }

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
    case 'stats':     vc.innerHTML = renderStatsView(); break;
    case 'settings':  vc.innerHTML = renderSettingsView(); break;
    default:          vc.innerHTML = renderLocalView();
  }
  bindViewEvents();
}

// ── Event binding ─────────────────────────────────────────────────
function bindViewEvents() {
  // Pagination
  document.querySelector('[data-act="page-prev"]')?.addEventListener('click', () => {
    state._trackPage = Math.max(0, (state._trackPage || 0) - 1);
    render();
    document.getElementById('view-container')?.scrollTo(0, 0);
  });
  document.querySelector('[data-act="page-next"]')?.addEventListener('click', () => {
    state._trackPage = (state._trackPage || 0) + 1;
    render();
    document.getElementById('view-container')?.scrollTo(0, 0);
  });

  // Sort control
  document.querySelector('[data-act="set-sort"]')?.addEventListener('change', async (e) => {
    state._localSort = e.target.value;
    state._trackPage = 0;  // reset to first page
    const [sort, order] = e.target.value.split(':');
    state.localTracks = await api.get(`/local/tracks?sort=${sort}&order=${order}`);
    render();
  });

  // Search (shared by local + online)
  const si = document.getElementById('search-input');
  if (si) {
    si.oninput = () => { state.searchQuery = si.value; if (state.view === 'local') render(); };
    // On the online view, Enter triggers a real search instead of live-filtering
    if (state.view === 'online') {
      si.onkeydown = (e) => { if (e.key === 'Enter') doOnlineSearch(); };
    }
    const val = si.value; si.focus(); si.value = ''; si.value = val;
  }

  // Track row click → play (DB-backed rows)
  // Build queue from the FULL data pool, not just visible DOM rows (pagination)
  document.querySelectorAll('.track-row[data-id]').forEach(row => {
    row.onclick = (e) => {
      if (e.target.closest('[data-act]')) return;
      const kind = row.dataset.kind;
      const id = parseInt(row.dataset.id, 10);
      // Use the full pool for the queue so all tracks are playable
      let fullPool;
      if (state.view === 'local') fullPool = state.localTracks.map(t => ({ ...t, kind: 'local' }));
      else if (state.view === 'online') fullPool = state.onlineTracks.map(t => ({ ...t, kind: 'online' }));
      else if (state.view === 'playlists' && state.activePlaylist) fullPool = state.activePlaylist.items.map(t => ({ ...t, kind: t.track_kind, id: t.track_id }));
      else if (state.view === 'tags') fullPool = state.tagTracks.map(t => ({ ...t, kind: t.track_kind, id: t.track_id }));
      else {
        const rows = [...document.querySelectorAll('.track-row[data-id]')];
        fullPool = rows.map(r => {
          const k = r.dataset.kind, tid = parseInt(r.dataset.id, 10);
          const pool = k === 'local' ? state.localTracks : state.onlineTracks;
          const track = pool.find(t => t.id === tid);
          return track ? { ...track, kind: k, id: tid } : null;
        }).filter(Boolean);
      }
      const idx = fullPool.findIndex(t => t.kind === kind && t.id === id);
      if (idx >= 0) player.playTrack(fullPool[idx], fullPool, idx);
    };
  });

  // Search-result row click → play preview/resolved url directly.
  // Builds a queue from all result rows so next/prev walks the results.
  document.querySelectorAll('.track-row[data-search-idx]').forEach(row => {
    row.onclick = (e) => {
      if (e.target.closest('[data-act]')) return;
      const idx = parseInt(row.dataset.searchIdx, 10);
      const queue = state.onlineSearchResults.map((t, i) => ({ ...t, kind: 'online', id: t.id || `search-${i}` }));
      if (queue[idx]) player.playTrack(queue[idx], queue, idx);
    };
  });

  // ── Right-click context menu ────────────────────────────────
  document.querySelectorAll('.track-row[data-id]').forEach(row => {
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      _showContextMenu(e.clientX, e.clientY, row.dataset.kind, parseInt(row.dataset.id, 10));
    });
  });

  // ── Tag actions (M2) ──────────────────────────────────────────
  document.getElementById('btn-add-tag')?.addEventListener('click', async () => {
    const name = prompt('标签名称');
    if (!name?.trim()) return;
    const TAG_COLORS = ['#007AFF','#30A84E','#FF6B35','#9B7BC9','#E8829A','#C77F2D','#56A0C7','#C0392B'];
    const color = TAG_COLORS[state.tags.length % TAG_COLORS.length];
    await api.post('/tags', { name: name.trim(), color });
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

  // ── Smart tag creation ────────────────────────────────────────
  document.getElementById('btn-add-smart-tag')?.addEventListener('click', async () => {
    const presets = [
      { name: '最近添加', rule: { added_within: '7d' } },
      { name: '常听', rule: { play_count_gte: 5 } },
      { name: '从未播放', rule: { play_count_eq: 0 } },
      { name: '本月新增', rule: { added_within: '30d' } },
    ];
    const choice = prompt(
      '选择智能标签规则（输入编号）：\n' +
      presets.map((p, i) => `${i + 1}. ${p.name}`).join('\n'),
      '1'
    );
    const idx = parseInt(choice, 10) - 1;
    if (isNaN(idx) || !presets[idx]) return;
    await api.post('/tags', {
      name: presets[idx].name, kind: 'smart',
      rule_json: JSON.stringify(presets[idx].rule),
    });
    state.tags = await api.get('/tags');
    render();
  });

  // ── Local sub-views (全部/专辑/艺人) ──────────────────────────
  document.querySelectorAll('[data-act="local-sub"]').forEach(btn => {
    btn.onclick = async () => {
      state.localSubView = btn.dataset.sub;
      state.albumFilter = null; state.artistFilter = null;
      state.searchQuery = '';
      if (btn.dataset.sub === 'albums' && !state.albums.length) {
        state.albums = await api.get('/local/albums');
      } else if (btn.dataset.sub === 'artists' && !state.artists.length) {
        state.artists = await api.get('/local/artists');
      }
      render();
    };
  });
  document.querySelectorAll('[data-act="open-album"]').forEach(el => {
    el.onclick = () => { state.albumFilter = el.dataset.album; render(); };
  });
  document.querySelectorAll('[data-act="open-artist"]').forEach(el => {
    el.onclick = () => { state.artistFilter = el.dataset.artist; render(); };
  });
  document.querySelector('[data-act="local-back"]')?.addEventListener('click', () => {
    state.albumFilter = null; state.artistFilter = null; render();
  });

  // ── Add to playlist ───────────────────────────────────────────
  document.querySelectorAll('[data-act="add-to-playlist"]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const kind = btn.dataset.kind, id = parseInt(btn.dataset.id, 10);
      if (!state.playlists.length) {
        const name = prompt('还没有歌单，输入名称新建一个：', '我的歌单');
        if (!name?.trim()) return;
        const pl = await api.post('/playlists', { name: name.trim() });
        state.playlists = await api.get('/playlists');
        await api.post(`/playlists/${pl.id}/items`, { track_kind: kind, track_id: id });
        btn.textContent = '✓';
        return;
      }
      const list = state.playlists.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
      const choice = prompt(`加入哪个歌单？（输入编号）\n${list}`, '1');
      const idx = parseInt(choice, 10) - 1;
      if (isNaN(idx) || !state.playlists[idx]) return;
      await api.post(`/playlists/${state.playlists[idx].id}/items`, { track_kind: kind, track_id: id });
      state.playlists = await api.get('/playlists');
      btn.textContent = '✓';
    };
  });

  // ── Play next ─────────────────────────────────────────────────
  document.querySelectorAll('[data-act="play-next"]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const kind = btn.dataset.kind, id = parseInt(btn.dataset.id, 10);
      const pool = kind === 'local' ? state.localTracks : state.onlineTracks;
      const track = pool.find(t => t.id === id);
      if (track) player.playNext({ ...track, kind, id });
    };
  });

  // ── Track delete ───────────────────────────────────────────────
  document.querySelectorAll('[data-act="del-track"]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const kind = btn.dataset.kind, id = parseInt(btn.dataset.id, 10);
      if (!confirm(`确定删除这首${kind === 'local' ? '本地' : '在线'}曲目？`)) return;
      await api.del(`/${kind === 'local' ? 'local' : 'online'}/tracks/${id}`);
      if (kind === 'local') state.localTracks = await api.get('/local/tracks');
      else state.onlineTracks = await api.get('/online/tracks');
      showToast('已删除');
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

  // ── Online: search (M5) ───────────────────────────────────────
  document.getElementById('btn-source-search')?.addEventListener('click', doOnlineSearch);

  document.getElementById('btn-clear-results')?.addEventListener('click', () => {
    state.onlineSearchResults = [];
    state._searchAllSources = [];
    render();
  });

  // Search history quick chips
  document.querySelectorAll('[data-act="search-history"]').forEach(btn => {
    btn.onclick = () => {
      state.searchQuery = btn.dataset.q;
      const si = document.getElementById('search-input');
      if (si) si.value = btn.dataset.q;
      doOnlineSearch();
    };
  });

  // Platform filter tabs
  document.querySelectorAll('[data-act="filter-source"]').forEach(btn => {
    btn.onclick = () => {
      state._searchSourceFilter = btn.dataset.src;
      render();
    };
  });

  document.getElementById('btn-import-pl')?.addEventListener('click', async () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,.lxmf,.m3u,.m3u8,.txt';
    inp.onchange = async () => {
      const file = inp.files[0];
      if (!file) return;
      const text = await file.text();
      const isJson = file.name.endsWith('.json') || file.name.endsWith('.lxmf') || text.trim().startsWith('{') || text.trim().startsWith('[');
      const r = await fetch('/api/online/import', {
        method: 'POST',
        headers: { 'Content-Type': isJson ? 'application/json' : 'text/plain' },
        body: text,
      });
      const d = await r.json();
      showToast(`导入完成，新增 ${d.added || 0} 首`);
      state.onlineTracks = await api.get('/online/tracks');
      render();
    };
    inp.click();
  });

  // Save a search result into the online library (⭐)
  document.querySelectorAll('[data-act="save-result"]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const t = state.onlineSearchResults[parseInt(btn.dataset.searchIdx, 10)];
      if (!t) return;
      // source_meta from backend is already a JSON string; backend handles both
      await api.post('/online/tracks', {
        source: t.source, source_id: t.source_id, title: t.title, artist: t.artist,
        album: t.album, duration_ms: t.duration_ms, cover_url: t.cover_url,
        url: t.url_cache || '', source_meta: t.source_meta,
        default_quality: t.source !== 'itunes' ? '320k' : undefined,
      });
      state.onlineTracks = await api.get('/online/tracks');
      btn.textContent = '✓';
    };
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

  // ── Settings: reset-to-default (#5) ────────────────────────────
  document.querySelectorAll('[data-act="reset-section"]').forEach(btn => {
    btn.onclick = async () => {
      const section = btn.dataset.section;
      const SECTION_KEYS = {
        appearance: ['theme', 'ui_style', 'color_scheme', 'wallpaper', 'wallpaper_url'],
        card: ['card_size', 'card_opacity', 'card_blur', 'card_brightness',
               'card_saturation', 'card_radius', 'card_aspect', 'card_item_tint'],
        font: ['font_size', 'font_weight', 'font_family'],
        playback: ['default_quality_online', 'volume', 'repeat_mode', 'shuffle'],
      };
      const keys = SECTION_KEYS[section];
      if (!keys) return;
      try {
        const defaults = await api.get('/settings/defaults');
        const patch = {};
        for (const k of keys) { if (defaults[k] !== undefined) patch[k] = defaults[k]; }
        await api.put('/settings', patch);
        Object.assign(state.settings, patch);
        applyAppearance();
        if (section === 'playback') {
          const vol = parseInt(patch.volume || '80', 10);
          document.getElementById('volume-slider').value = vol;
          player.audio.volume = vol / 100;
          player.shuffle = patch.shuffle === 'true';
          player.repeat = patch.repeat_mode || 'none';
          player._updateModeButtons();
        }
        render();
      } catch {}
    };
  });

  // ── Settings: source URL import ───────────────────────────────
  document.getElementById('btn-source-url')?.addEventListener('click', async () => {
    const url = prompt('输入音源脚本 URL\n例如 GitHub raw 链接');
    if (!url?.trim()) return;
    try {
      const r = await api.post('/sources', { url: url.trim() });
      if (r.error) { showToast('导入失败: ' + r.error, 'error'); return; }
      state.sources = await api.get('/sources');
      try { await window.sourceHost.loadAll(); state.sources = await api.get('/sources'); } catch {}
      showToast('音源安装成功');
      render();
    } catch (e) { showToast('导入失败: ' + e.message, 'error'); }
  });

  // ── Settings: sources (M4) ────────────────────────────────────
  document.getElementById('source-file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await api.upload('/sources', file);
    state.sources = await api.get('/sources');
    // Re-init sandbox
    try { await window.sourceHost.loadAll(); state.sources = await api.get('/sources'); } catch {}
    render();
  });

  document.querySelectorAll('[data-act="toggle-source"]').forEach(btn => {
    btn.onclick = async () => {
      const enabled = btn.dataset.enabled === '1' ? 0 : 1;
      await api.put(`/sources/${btn.dataset.id}`, { enabled });
      state.sources = await api.get('/sources');
      try { await window.sourceHost.loadAll(); state.sources = await api.get('/sources'); } catch {}
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

  // ── Appearance: wallpaper + theme ───────────────────────────────
  document.querySelectorAll('[data-act="set-wallpaper"]').forEach(el => {
    el.onclick = async () => {
      await api.put('/settings', { wallpaper: el.dataset.wp, wallpaper_url: '' });
      state.settings.wallpaper = el.dataset.wp;
      state.settings.wallpaper_url = '';
      applyAppearance();
      render();
    };
  });

  document.getElementById('btn-set-wp-url')?.addEventListener('click', async () => {
    const url = prompt('输入壁纸图片 URL', state.settings.wallpaper_url || '');
    if (url === null) return;
    await api.put('/settings', { wallpaper_url: url.trim() });
    state.settings.wallpaper_url = url.trim();
    applyAppearance();
    render();
  });

  document.getElementById('btn-clear-wp-url')?.addEventListener('click', async () => {
    await api.put('/settings', { wallpaper_url: '' });
    state.settings.wallpaper_url = '';
    applyAppearance();
    render();
  });

  document.querySelectorAll('[data-act="set-theme"]').forEach(btn => {
    btn.onclick = async () => {
      await api.put('/settings', { theme: btn.dataset.theme });
      state.settings.theme = btn.dataset.theme;
      applyAppearance();
      render();
    };
  });

  document.querySelectorAll('[data-act="set-style"]').forEach(el => {
    el.onclick = async () => {
      await api.put('/settings', { ui_style: el.dataset.style });
      state.settings.ui_style = el.dataset.style;
      applyAppearance();
      // Re-tint from the current cover if scheme is 'extract'
      if (player._currentTrack) extractAccentFromCover(coverUrl(player._currentTrack));
      render();
    };
  });

  document.querySelectorAll('[data-act="set-scheme"]').forEach(el => {
    el.onclick = async () => {
      await api.put('/settings', { color_scheme: el.dataset.scheme });
      state.settings.color_scheme = el.dataset.scheme;
      applyAppearance();
      if (el.dataset.scheme === 'extract' && player._currentTrack) {
        extractAccentFromCover(coverUrl(player._currentTrack));
      }
      render();
    };
  });

  // ── Card sliders: live preview on input, debounced save ─────────
  document.querySelectorAll('[data-act="set-slider"]').forEach(sl => {
    const k = sl.dataset.k;
    sl.oninput = () => {
      state.settings[k] = sl.value;
      applyAppearance();
      const val = document.querySelector(`[data-valfor="${k}"]`);
      if (val) {
        const unit = { card_blur: 'px', card_radius: 'px', font_size: 'px' }[k];
        val.textContent = k === 'card_aspect'
          ? (parseFloat(sl.value) / 100).toFixed(2)
          : sl.value + (unit || (k === 'card_aspect' ? '' : '%'));
      }
      clearTimeout(_settingSaveTimer);
      _settingSaveTimer = setTimeout(() => api.put('/settings', { [k]: sl.value }), 400);
    };
  });

  document.querySelector('[data-act="set-font"]')?.addEventListener('change', async (e) => {
    state.settings.font_family = e.target.value;
    applyAppearance();
    await api.put('/settings', { font_family: e.target.value });
  });

  document.querySelectorAll('[data-act="set-weight"]').forEach(btn => {
    btn.onclick = async () => {
      state.settings.font_weight = btn.dataset.w;
      applyAppearance();
      await api.put('/settings', { font_weight: btn.dataset.w });
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
    a.download = `loyin-backup-${new Date().toISOString().slice(0,10)}.json`;
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
      showToast('数据导入成功');
      location.reload();
    } catch (err) {
      showToast('导入失败: ' + err.message, 'error');
    }
  });

  // ── Crossfade setting ──────────────────────────────────────────
  document.querySelectorAll('[data-act="set-crossfade"]').forEach(btn => {
    btn.onclick = async () => {
      await api.put('/settings', { crossfade: btn.dataset.sec });
      state.settings.crossfade = btn.dataset.sec;
      player._crossfade = parseInt(btn.dataset.sec, 10);
      render();
    };
  });

  // ── Lyric translation toggle ──────────────────────────────────
  document.getElementById('btn-toggle-tlyric')?.addEventListener('click', async () => {
    const cur = state.settings.lyric_show_translation !== 'false';
    await api.put('/settings', { lyric_show_translation: cur ? 'false' : 'true' });
    state.settings.lyric_show_translation = cur ? 'false' : 'true';
    render();
  });

  // ── Sleep timer ───────────────────────────────────────────────
  document.querySelectorAll('[data-act="set-sleep"]').forEach(btn => {
    btn.onclick = () => {
      const m = btn.dataset.m;
      clearTimeout(state._sleepTimer);
      if (m === 'off') {
        state._sleepMinutes = 'off';
        state._sleepAt = null;
      } else {
        const ms = parseInt(m) * 60 * 1000;
        state._sleepMinutes = m;
        state._sleepAt = Date.now() + ms;
        state._sleepTimer = setTimeout(() => {
          player.audio.pause();
          state._sleepMinutes = 'off';
          state._sleepAt = null;
          showToast('睡眠定时到，已暂停播放');
          if (state.view === 'settings') render();
        }, ms);
      }
      render();
    };
  });

  // ── Clear history ─────────────────────────────────────────────
  document.getElementById('btn-clear-history')?.addEventListener('click', async () => {
    if (!confirm('确定清除所有播放历史？此操作不可撤销。')) return;
    await api.del('/history');
    state.historyTracks = [];
    state.historyDaysWithPlays = new Set();
    showToast('播放历史已清除');
    render();
  });

  // ── Proxy toggle ──────────────────────────────────────────────
  document.getElementById('btn-toggle-proxy')?.addEventListener('click', async () => {
    const cur = state.settings.proxy_allow_outbound === 'true';
    await api.put('/settings', { proxy_allow_outbound: cur ? 'false' : 'true' });
    state.settings.proxy_allow_outbound = cur ? 'false' : 'true';
    render();
  });

  // ── 🎲 Shuffle all ────────────────────────────────────────────
  document.querySelector('[data-act="shuffle-all"]')?.addEventListener('click', () => {
    const all = [
      ...state.localTracks.map(t => ({ ...t, kind: 'local' })),
      ...state.onlineTracks.map(t => ({ ...t, kind: 'online' })),
    ];
    if (!all.length) { showToast('没有可播放的曲目'); return; }
    // Fisher-Yates shuffle
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    player.shuffle = true;
    player._updateModeButtons();
    player.playTrack(all[0], all, 0);
    showToast(`随机播放 ${all.length} 首`);
  });

  // ── 📊 Stats: duplicate check ─────────────────────────────────
  document.getElementById('btn-check-dupes')?.addEventListener('click', async () => {
    state._dupes = await api.get('/local/duplicates');
    render();
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

  document.getElementById('btn-play-all')?.addEventListener('click', () => {
    const items = state.activePlaylist?.items || [];
    if (!items.length) return;
    const queue = items.map(it => ({ ...it, kind: it.track_kind, id: it.track_id }));
    player.playTrack(queue[0], queue, 0);
  });

  document.getElementById('btn-export-playlist')?.addEventListener('click', () => {
    const { playlist, items } = state.activePlaylist || {};
    if (!items?.length) return;
    const m3u = '#EXTM3U\n' + items.map(it => {
      const dur = Math.round((it.duration_ms || 0) / 1000);
      return `#EXTINF:${dur},${it.artist || ''} - ${it.title || ''}\n${it.track_kind === 'local' ? `/api/local/stream/${it.track_id}` : (it.url_cache || it.cover_url || '#')}`;
    }).join('\n');
    const blob = new Blob([m3u], { type: 'audio/x-mpegurl' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${playlist.name || 'playlist'}.m3u`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('歌单已导出为 m3u');
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

  // ── #1: Playlist drag-to-reorder ────────────────────────────────
  const sortable = document.querySelector('.playlist-sortable tbody');
  if (sortable) {
    let dragRow = null;
    sortable.querySelectorAll('tr[draggable]').forEach(row => {
      row.addEventListener('dragstart', (e) => {
        dragRow = row;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        dragRow = null;
        sortable.querySelectorAll('.drag-over').forEach(r => r.classList.remove('drag-over'));
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (row !== dragRow) {
          sortable.querySelectorAll('.drag-over').forEach(r => r.classList.remove('drag-over'));
          row.classList.add('drag-over');
        }
      });
      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        if (!dragRow || row === dragRow) return;
        // Reorder: move dragRow before/after this row
        const rows = [...sortable.querySelectorAll('tr[draggable]')];
        const fromIdx = rows.indexOf(dragRow);
        const toIdx = rows.indexOf(row);
        if (fromIdx < 0 || toIdx < 0) return;
        // Reorder items in state
        const items = state.activePlaylist.items;
        const [moved] = items.splice(fromIdx, 1);
        items.splice(toIdx, 0, moved);
        // Save to backend
        await api.put(`/playlists/${state.activePlaylist.playlist.id}/items`, {
          items: items.map(it => ({ track_kind: it.track_kind, track_id: it.track_id })),
        });
        render();
      });
    });
  }

  // Playlist item removal
  document.querySelectorAll('[data-act="rm-from-playlist"]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const pos = parseInt(btn.dataset.pos, 10);
      const items = state.activePlaylist.items;
      items.splice(pos, 1);
      await api.put(`/playlists/${state.activePlaylist.playlist.id}/items`, {
        items: items.map(it => ({ track_kind: it.track_kind, track_id: it.track_id })),
      });
      state.playlists = await api.get('/playlists');
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
let _settingSaveTimer = null;
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
      state.albums = []; state.artists = []; // invalidate caches after scan
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
// ── Search history (localStorage) ────────────────────────────────
function _getSearchHistory() {
  try { return JSON.parse(localStorage.getItem('loyin_search_history') || '[]').slice(0, 8); } catch { return []; }
}
function _addSearchHistory(q) {
  const h = _getSearchHistory().filter(x => x !== q);
  h.unshift(q);
  try { localStorage.setItem('loyin_search_history', JSON.stringify(h.slice(0, 8))); } catch {}
}

// ── Online search: backend-driven (iTunes + platform adapters) ───
let _searchAbort = null;
async function doOnlineSearch() {
  const q = state.searchQuery.trim();
  if (!q) return;
  _addSearchHistory(q);

  // Show loading state
  state.onlineSearchResults = [];
  state._searchLoading = true;
  state._searchSourceFilter = 'all';  // reset filter
  render();

  // Build sources list: always iTunes + any installed LX source platforms
  const avail = window.sourceHost ? window.sourceHost.getAvailableSources() : {};
  const platformKeys = Object.keys(avail).filter(k => k !== 'local');
  const sources = ['itunes', ...platformKeys].join(',');

  try {
    const data = await api.get(`/online/search?q=${encodeURIComponent(q)}&sources=${sources}`);
    const raw = Array.isArray(data) ? data : [];
    // Dedup: keep first occurrence per (title+artist, normalized)
    const seen = new Map();
    const deduped = [];
    for (const r of raw) {
      const key = (r.title + '|' + r.artist).toLowerCase().replace(/\s+/g, '');
      if (!seen.has(key)) {
        seen.set(key, r);
        // Collect which platforms have this song
        r._platforms = [r.source];
        deduped.push(r);
      } else {
        // Merge platform into existing entry's _platforms
        const existing = seen.get(key);
        if (!existing._platforms.includes(r.source)) {
          existing._platforms.push(r.source);
        }
        // Prefer non-iTunes (has full track) and non-empty cover
        if (r.source !== 'itunes' && existing.source === 'itunes') {
          // Swap: use platform result as primary
          Object.assign(existing, r, { _platforms: existing._platforms });
        }
        if (!existing.cover_url && r.cover_url) existing.cover_url = r.cover_url;
      }
    }
    state.onlineSearchResults = deduped;
    state._searchAllSources = [...new Set(deduped.map(r => r.source))].sort();
  } catch {
    state.onlineSearchResults = [];
    state._searchAllSources = [];
  }
  state._searchLoading = false;
  if (!state.onlineSearchResults.length) state._searchNoResults = true;
  else state._searchNoResults = false;
  render();
}

function _parseDur(s) {
  // "mm:ss" → ms
  if (typeof s === 'number') return s * 1000;
  const m = String(s).match(/(\d+):(\d+)/);
  return m ? (parseInt(m[1]) * 60 + parseInt(m[2])) * 1000 : 0;
}

function bindNowPlaying() {
  // Click on player cover or track info → open overlay
  document.getElementById('player-info-clickable')?.addEventListener('click', () => {
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
  document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
    btn.onclick = () => {
      state.view = btn.dataset.view;
      state.searchQuery = '';
      state._trackPage = 0;
      state._searchNoResults = false;
      if (btn.dataset.view === 'stats') state._stats = null;  // refresh stats
      document.querySelectorAll('.nav-btn[data-view]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      render();
    };
  });
}

// ── Global keyboard shortcuts ────────────────────────────────────
// ── 🔍 Global search (Cmd/Ctrl+K) ──────────────────────────────
function doGlobalSearch(q) {
  if (!q) return;
  const lower = q.toLowerCase();
  const results = [];
  // Search local tracks
  state.localTracks.forEach(t => {
    if ((t.title + t.artist + t.album).toLowerCase().includes(lower))
      results.push({ ...t, kind: 'local', _type: '本地' });
  });
  // Search online tracks
  state.onlineTracks.forEach(t => {
    if ((t.title + t.artist + t.album).toLowerCase().includes(lower))
      results.push({ ...t, kind: 'online', _type: '在线' });
  });
  // Search playlists
  state.playlists.forEach(p => {
    if (p.name.toLowerCase().includes(lower))
      results.push({ _type: '歌单', _playlist: p, title: p.name, artist: `${p.item_count || 0} 首` });
  });
  return results.slice(0, 30);
}

function showGlobalSearch() {
  let overlay = document.getElementById('global-search-overlay');
  if (overlay) { overlay.remove(); return; }
  overlay = document.createElement('div');
  overlay.id = 'global-search-overlay';
  overlay.className = 'global-search-overlay';
  overlay.innerHTML = `
    <div class="global-search-box">
      <input type="search" id="global-search-input" placeholder="搜索本地 / 在线 / 歌单..." autofocus>
      <div id="global-search-results" class="global-search-results"></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  const input = document.getElementById('global-search-input');
  input.oninput = () => {
    const results = doGlobalSearch(input.value.trim());
    const el = document.getElementById('global-search-results');
    if (!results?.length) { el.innerHTML = input.value ? '<div style="padding:16px;text-align:center;color:var(--text-tertiary)">无结果</div>' : ''; return; }
    el.innerHTML = results.map((r, i) => `
      <div class="gs-item" data-gs-idx="${i}">
        <span class="gs-type">${r._type}</span>
        <span class="gs-title">${esc(r.title || '')}</span>
        <span class="gs-artist">${esc(r.artist || '')}</span>
      </div>`).join('');
    el.querySelectorAll('.gs-item').forEach((item, i) => {
      item.onclick = () => {
        const r = results[i];
        overlay.remove();
        if (r._playlist) {
          state.view = 'playlists';
          api.get(`/playlists/${r._playlist.id}`).then(d => { state.activePlaylist = d; render(); });
        } else {
          player.playTrack(r, [r], 0);
        }
      };
    });
  };
  input.onkeydown = (e) => { if (e.key === 'Escape') overlay.remove(); };
}

// ── 📱 Mobile swipe gestures ────────────────────────────────────
function bindGestures() {
  let touchStartX = 0, touchStartY = 0;
  const bar = document.getElementById('player-bar');
  if (!bar) return;
  bar.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  bar.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return; // too short or vertical
    if (dx > 0) player.next();
    else player.prev();
  }, { passive: true });
}

function bindGlobalKeys() {
  document.addEventListener('keydown', (e) => {
    // Ignore when typing in an input/textarea
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        player.togglePlay();
        break;
      case 'ArrowRight':
        if (e.metaKey || e.ctrlKey) { player.next(); e.preventDefault(); }
        break;
      case 'ArrowLeft':
        if (e.metaKey || e.ctrlKey) { player.prev(); e.preventDefault(); }
        break;
      case 'ArrowUp':
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          const vol = document.getElementById('volume-slider');
          vol.value = Math.min(100, parseInt(vol.value) + 5);
          vol.dispatchEvent(new Event('input'));
        }
        break;
      case 'ArrowDown':
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          const vol = document.getElementById('volume-slider');
          vol.value = Math.max(0, parseInt(vol.value) - 5);
          vol.dispatchEvent(new Event('input'));
        }
        break;
      case 'KeyM':
        if (e.metaKey || e.ctrlKey) { // Cmd/Ctrl+M = mute toggle
          e.preventDefault();
          player.audio.muted = !player.audio.muted;
        }
        break;
      case 'KeyK':
        if (e.metaKey || e.ctrlKey) { // Cmd/Ctrl+K = global search
          e.preventDefault();
          showGlobalSearch();
        }
        break;
    }
  });
}

// ── Context menu ─────────────────────────────────────────────────
function _showContextMenu(x, y, kind, id) {
  _closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.innerHTML = `
    <div class="ctx-item" data-ctx="play">▶ 播放</div>
    <div class="ctx-item" data-ctx="queue">📜 加入队列</div>
    <div class="ctx-divider"></div>
    <div class="ctx-item" data-ctx="playlist">➕ 加入歌单</div>
    <div class="ctx-item" data-ctx="tag">🏷 标签</div>
    ${kind === 'online' ? '<div class="ctx-divider"></div><div class="ctx-item danger" data-ctx="delete">🗑 删除</div>' : ''}
  `;
  // Position: keep within viewport
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + 'px';

  menu.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-ctx]')?.dataset.ctx;
    if (!act) return;
    _closeContextMenu();
    const pool = kind === 'local' ? state.localTracks : state.onlineTracks;
    const track = pool.find(t => t.id === id);
    if (!track) return;
    switch (act) {
      case 'play':
        player.playTrack({ ...track, kind, id }, [{ ...track, kind, id }], 0);
        break;
      case 'queue':
        player.queue.push({ ...track, kind, id });
        showToast('已加入队列');
        break;
      case 'playlist': {
        if (!state.playlists.length) { showToast('请先创建歌单', 'error'); return; }
        const list = state.playlists.map((p, i) => `${i+1}. ${p.name}`).join('\n');
        const ch = prompt(`加入哪个歌单？\n${list}`, '1');
        const idx = parseInt(ch, 10) - 1;
        if (!isNaN(idx) && state.playlists[idx]) {
          await api.post(`/playlists/${state.playlists[idx].id}/items`, { track_kind: kind, track_id: id });
          state.playlists = await api.get('/playlists');
          showToast('已加入歌单');
        }
        break;
      }
      case 'tag': {
        // Simulate clicking the tag button on this row
        const btn = document.querySelector(`.track-row[data-kind="${kind}"][data-id="${id}"] [data-act="open-tagger"]`);
        if (btn) btn.click();
        break;
      }
      case 'delete':
        if (!confirm('确定删除？')) return;
        await api.del(`/online/tracks/${id}`);
        state.onlineTracks = await api.get('/online/tracks');
        render();
        break;
    }
  });
  // Close on click outside
  setTimeout(() => document.addEventListener('click', _closeContextMenu, { once: true }), 0);
}
function _closeContextMenu() {
  document.querySelectorAll('.ctx-menu').forEach(m => m.remove());
}

// ── Boot ──────────────────────────────────────────────────────────
async function boot() {
  player.init();
  bindNav();
  bindNowPlaying();
  bindGlobalKeys();
  bindGestures();

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

  applyAppearance();
  player.restoreLast();

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
