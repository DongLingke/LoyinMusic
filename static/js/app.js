/* ═══════════════════════════════════════════════════════════════════
   听迹 Tunenote — Frontend SPA
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
};

// ── State ─────────────────────────────────────────────────────────
const state = {
  view: 'local',
  localTracks: [],
  tags: [],
  settings: {},
  searchQuery: '',
  scanProgress: null,
};

// ── Utilities ─────────────────────────────────────────────────────
const esc = s => {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
};

function fmtTime(ms) {
  if (!ms || ms <= 0) return '0:00';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function fmtTimeSec(sec) {
  if (!sec || sec <= 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function coverUrl(track) {
  if (track.cover_hash) return `/api/local/cover/${track.cover_hash}`;
  if (track.cover_url) return track.cover_url;
  return null;
}

// ── Player ────────────────────────────────────────────────────────
const player = {
  audio: null,
  queue: [],       // [{kind, id, title, artist, duration_ms, cover_hash, cover_url, path?}]
  current: -1,
  playing: false,
  _startTime: 0,

  init() {
    this.audio = document.getElementById('audio-el');
    this.audio.addEventListener('ended', () => this._onEnded());
    this.audio.addEventListener('timeupdate', () => this._onTimeUpdate());
    this.audio.addEventListener('play', () => { this.playing = true; this._updatePlayBtn(); });
    this.audio.addEventListener('pause', () => { this.playing = false; this._updatePlayBtn(); });

    document.getElementById('btn-play').onclick = () => this.togglePlay();
    document.getElementById('btn-prev').onclick = () => this.prev();
    document.getElementById('btn-next').onclick = () => this.next();

    const prog = document.getElementById('player-progress');
    prog.addEventListener('input', () => {
      if (this.audio.duration) {
        this.audio.currentTime = (prog.value / 100) * this.audio.duration;
      }
    });

    const vol = document.getElementById('volume-slider');
    vol.addEventListener('input', () => {
      this.audio.volume = vol.value / 100;
      api.put('/settings', { volume: vol.value });
    });

    // Restore volume from settings
    api.get('/settings').then(s => {
      state.settings = s;
      const v = parseInt(s.volume || '80', 10);
      vol.value = v;
      this.audio.volume = v / 100;
    });

    // MediaSession
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => this.togglePlay());
      navigator.mediaSession.setActionHandler('pause', () => this.togglePlay());
      navigator.mediaSession.setActionHandler('previoustrack', () => this.prev());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
      navigator.mediaSession.setActionHandler('seekto', (d) => {
        if (d.seekTime != null) this.audio.currentTime = d.seekTime;
      });
    }
  },

  playTrack(track, queue, idx) {
    this.queue = queue || [track];
    this.current = idx ?? 0;
    this._load(track);
  },

  _load(track) {
    const url = track.kind === 'local'
      ? `/api/local/stream/${track.id}`
      : (track.url_cache || track.path || '');
    if (!url) return;
    this.audio.src = url;
    this.audio.play();
    this._startTime = Date.now();
    this._updateBar(track);
    this._updateMediaSession(track);
    // Highlight in table
    document.querySelectorAll('.track-row').forEach(r => {
      r.classList.toggle('playing',
        r.dataset.kind === track.kind && r.dataset.id === String(track.id));
    });
  },

  togglePlay() {
    if (!this.audio.src) return;
    if (this.audio.paused) this.audio.play();
    else this.audio.pause();
  },

  next() {
    if (!this.queue.length) return;
    let idx = this.current + 1;
    if (idx >= this.queue.length) idx = 0;
    this.current = idx;
    this._load(this.queue[idx]);
  },

  prev() {
    if (!this.queue.length) return;
    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return;
    }
    let idx = this.current - 1;
    if (idx < 0) idx = this.queue.length - 1;
    this.current = idx;
    this._load(this.queue[idx]);
  },

  _onEnded() {
    const track = this.queue[this.current];
    if (track) {
      const played = Date.now() - this._startTime;
      api.post('/history', {
        track_kind: track.kind, track_id: track.id,
        duration_played: played,
        completed: played > (track.duration_ms || 0) * 0.8 ? 1 : 0,
      });
    }
    this.next();
  },

  _onTimeUpdate() {
    const prog = document.getElementById('player-progress');
    const cur = document.getElementById('player-time-cur');
    if (this.audio.duration) {
      prog.value = (this.audio.currentTime / this.audio.duration) * 100;
      cur.textContent = fmtTimeSec(this.audio.currentTime);
    }
  },

  _updatePlayBtn() {
    document.getElementById('btn-play').textContent = this.playing ? '⏸' : '▶';
  },

  _updateBar(track) {
    document.getElementById('player-title').textContent = track.title || '未知曲目';
    document.getElementById('player-artist').textContent = track.artist || '';
    document.getElementById('player-time-dur').textContent = fmtTime(track.duration_ms);
    document.getElementById('player-time-cur').textContent = '0:00';
    document.getElementById('player-progress').value = 0;
    const coverEl = document.getElementById('player-cover');
    const src = coverUrl(track);
    coverEl.innerHTML = src ? `<img src="${esc(src)}" alt="">` : '';
  },

  _updateMediaSession(track) {
    if (!('mediaSession' in navigator)) return;
    const artwork = [];
    const src = coverUrl(track);
    if (src) artwork.push({ src, sizes: '512x512', type: 'image/webp' });
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || '未知曲目',
      artist: track.artist || '',
      album: track.album || '',
      artwork,
    });
  },
};

// ── Views ─────────────────────────────────────────────────────────

function renderLocalView() {
  const tracks = state.localTracks;
  const q = state.searchQuery.toLowerCase();
  const filtered = q
    ? tracks.filter(t => (t.title+t.artist+t.album).toLowerCase().includes(q))
    : tracks;

  let html = `
    <div class="view-header">
      <div class="view-title">本地音乐 <span style="font-weight:400;font-size:0.9rem;color:var(--text-tertiary)">(${filtered.length})</span></div>
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input type="search" id="search-input" placeholder="搜索标题 / 艺人 / 专辑..." value="${esc(state.searchQuery)}">
      </div>
    </div>
  `;

  // Scan progress
  if (state.scanProgress && state.scanProgress.running) {
    const p = state.scanProgress;
    const pct = p.total > 0 ? Math.round(p.done / p.total * 100) : 0;
    html += `
      <div class="scan-bar">
        <span>扫描中... ${p.done}/${p.total}</span>
        <div class="scan-bar-progress"><div class="scan-bar-fill" style="width:${pct}%"></div></div>
        <span>${esc(p.current)}</span>
      </div>
    `;
  }

  if (!filtered.length) {
    html += `
      <div class="empty-state">
        <div class="empty-icon">🎵</div>
        <div class="empty-text">
          ${tracks.length === 0
            ? '还没有本地音乐<br>在「设置」中添加扫描目录，然后点击「扫描」'
            : '没有找到匹配的结果'}
        </div>
      </div>
    `;
  } else {
    html += `<table class="track-table">
      <thead><tr>
        <th class="td-idx">#</th>
        <th class="td-cover"></th>
        <th class="td-title">标题</th>
        <th class="td-artist">艺人</th>
        <th class="td-album">专辑</th>
        <th class="td-duration">时长</th>
      </tr></thead>
      <tbody>`;
    filtered.forEach((t, i) => {
      const cv = coverUrl(t);
      const playing = player.queue[player.current];
      const isPlaying = playing && playing.kind === 'local' && playing.id === t.id;
      html += `
        <tr class="track-row ${isPlaying ? 'playing' : ''}"
            data-kind="local" data-id="${t.id}" data-idx="${i}">
          <td class="td-idx">${isPlaying ? '🔊' : i + 1}</td>
          <td class="td-cover">${cv ? `<img src="${esc(cv)}" alt="" loading="lazy">` : '<div style="width:32px;height:32px;border-radius:4px;background:var(--bg-hover)"></div>'}</td>
          <td class="td-title"><span class="track-name">${esc(t.title || t.path)}</span></td>
          <td class="td-artist">${esc(t.artist)}</td>
          <td class="td-album">${esc(t.album)}</td>
          <td class="td-duration">${fmtTime(t.duration_ms)}</td>
        </tr>`;
    });
    html += '</tbody></table>';
  }
  return html;
}

function renderTagsView() {
  const tags = state.tags;
  let html = `
    <div class="view-header">
      <div class="view-title">标签</div>
      <button class="btn btn-primary" id="btn-add-tag">+ 新建标签</button>
    </div>
  `;
  if (!tags.length) {
    html += `<div class="empty-state">
      <div class="empty-icon">🏷</div>
      <div class="empty-text">还没有标签<br>给音乐打上标签来分类管理</div>
    </div>`;
  } else {
    html += '<div class="tags-row" style="gap:10px">';
    tags.forEach(t => {
      const c = t.color || 'var(--accent)';
      html += `<div class="tag-chip" data-tag-id="${t.id}" style="--tc:${c}">
        <span>${esc(t.name)}</span>
        <span class="tag-remove" data-act="del-tag" data-id="${t.id}">&times;</span>
      </div>`;
    });
    html += '</div>';
  }
  return html;
}

function renderSettingsView() {
  const s = state.settings;
  let folders = [];
  try { folders = JSON.parse(s.scan_folders || '[]'); } catch {}

  return `
    <div class="view-header"><div class="view-title">设置</div></div>

    <div class="settings-section">
      <div class="settings-section-title">本地音乐</div>
      <div class="settings-group">
        <div class="settings-row">
          <div>
            <div class="settings-row-label">扫描目录</div>
            <div class="settings-row-sub">添加包含音乐文件的文件夹路径</div>
          </div>
          <button class="btn btn-ghost" id="btn-add-folder">+ 添加目录</button>
        </div>
        ${folders.length ? `<ul class="folder-list">
          ${folders.map((f, i) => `<li class="folder-item">
            <span>${esc(f)}</span>
            <button data-act="remove-folder" data-idx="${i}">&times; 移除</button>
          </li>`).join('')}
        </ul>` : ''}
        <div class="settings-row">
          <div>
            <div class="settings-row-label">扫描音乐库</div>
            <div class="settings-row-sub">扫描以上目录中的音频文件</div>
          </div>
          <button class="btn btn-primary" id="btn-scan">扫描</button>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">启动时自动扫描</div>
          <button class="btn btn-ghost" id="btn-toggle-autoscan">
            ${s.auto_scan_on_start === 'true' ? '✓ 已开启' : '✗ 已关闭'}
          </button>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">播放</div>
      <div class="settings-group">
        <div class="settings-row">
          <div class="settings-row-label">默认音量</div>
          <span>${s.volume || 80}%</span>
        </div>
      </div>
    </div>
  `;
}

// ── Render engine ─────────────────────────────────────────────────
function render() {
  const vc = document.getElementById('view-container');
  switch (state.view) {
    case 'local':    vc.innerHTML = renderLocalView(); break;
    case 'tags':     vc.innerHTML = renderTagsView(); break;
    case 'settings': vc.innerHTML = renderSettingsView(); break;
    default:         vc.innerHTML = renderLocalView();
  }
  bindViewEvents();
}

function bindViewEvents() {
  // Search
  const si = document.getElementById('search-input');
  if (si) {
    si.oninput = () => { state.searchQuery = si.value; render(); };
  }

  // Track row click → play
  document.querySelectorAll('.track-row').forEach(row => {
    row.onclick = () => {
      const kind = row.dataset.kind;
      const id = parseInt(row.dataset.id, 10);
      const tracks = state.localTracks;
      const queue = tracks.map(t => ({ ...t, kind: 'local' }));
      const idx = queue.findIndex(t => t.id === id);
      if (idx >= 0) player.playTrack(queue[idx], queue, idx);
    };
  });

  // Settings: add folder
  const btnAddFolder = document.getElementById('btn-add-folder');
  if (btnAddFolder) {
    btnAddFolder.onclick = async () => {
      const path = prompt('输入音乐文件夹的完整路径\n例如：/home/user/Music');
      if (!path || !path.trim()) return;
      let folders = [];
      try { folders = JSON.parse(state.settings.scan_folders || '[]'); } catch {}
      if (folders.includes(path.trim())) return;
      folders.push(path.trim());
      await api.put('/settings', { scan_folders: JSON.stringify(folders) });
      state.settings.scan_folders = JSON.stringify(folders);
      render();
    };
  }

  // Settings: remove folder
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

  // Settings: scan
  const btnScan = document.getElementById('btn-scan');
  if (btnScan) {
    btnScan.onclick = async () => {
      await api.post('/local/scan', {});
      pollScan();
    };
  }

  // Settings: toggle auto-scan
  const btnAuto = document.getElementById('btn-toggle-autoscan');
  if (btnAuto) {
    btnAuto.onclick = async () => {
      const cur = state.settings.auto_scan_on_start === 'true';
      await api.put('/settings', { auto_scan_on_start: cur ? 'false' : 'true' });
      state.settings.auto_scan_on_start = cur ? 'false' : 'true';
      render();
    };
  }

  // Tags: add
  const btnAddTag = document.getElementById('btn-add-tag');
  if (btnAddTag) {
    btnAddTag.onclick = async () => {
      const name = prompt('标签名称');
      if (!name || !name.trim()) return;
      await api.post('/tags', { name: name.trim() });
      state.tags = await api.get('/tags');
      render();
    };
  }

  // Tags: delete
  document.querySelectorAll('[data-act="del-tag"]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('确定删除这个标签？')) return;
      await api.del(`/tags/${btn.dataset.id}`);
      state.tags = await api.get('/tags');
      render();
    };
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
      clearInterval(_scanPoll);
      _scanPoll = null;
      state.scanProgress = null;
      state.localTracks = await api.get('/local/tracks');
    }
    if (state.view === 'local' || state.view === 'settings') render();
  }, 1000);
}

// ── Navigation ────────────────────────────────────────────────────
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

  // Load initial data in parallel
  const [tracks, tags, settings] = await Promise.all([
    api.get('/local/tracks'),
    api.get('/tags'),
    api.get('/settings'),
  ]);
  state.localTracks = tracks;
  state.tags = tags;
  state.settings = settings;

  render();

  // Check if a scan is running
  const p = await api.get('/local/scan/progress');
  if (p.running) {
    state.scanProgress = p;
    render();
    pollScan();
  }
}

boot();
