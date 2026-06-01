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
  },
  _updatePlayBtn() { document.getElementById('btn-play').textContent = this.playing ? '⏸' : '▶'; },
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

  return html;
}

// ── Render engine ─────────────────────────────────────────────────
function render() {
  const vc = document.getElementById('view-container');
  switch (state.view) {
    case 'local':    vc.innerHTML = renderLocalView(); break;
    case 'online':   vc.innerHTML = renderOnlineView(); break;
    case 'tags':     vc.innerHTML = renderTagsView(); break;
    case 'settings': vc.innerHTML = renderSettingsView(); break;
    default:         vc.innerHTML = renderLocalView();
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

  const [tracks, onlineTracks, tags, settings, sources] = await Promise.all([
    api.get('/local/tracks'),
    api.get('/online/tracks'),
    api.get('/tags'),
    api.get('/settings'),
    api.get('/sources'),
  ]);
  state.localTracks = tracks;
  state.onlineTracks = onlineTracks;
  state.tags = tags;
  state.settings = settings;
  state.sources = sources;

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
