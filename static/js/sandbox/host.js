/* ═══════════════════════════════════════════════════════════════════
   LX Music 音源宿主 — 主页面侧

   每个已启用的自定义源脚本运行在独立的隐藏 iframe 中。
   SourceHost 管理所有 iframe 的生命周期，代理 HTTP 请求，
   并提供统一的 request(source, action, info) 接口给播放器调用。
   ═══════════════════════════════════════════════════════════════════ */

class SourceHost {
  constructor() {
    this.frames = {};       // scriptId → { iframe, sources, ready, pending }
    this._reqId = 0;
    this._pending = {};     // reqId → { resolve, reject, timer }
    this._sourceMap = {};   // lx source key (e.g. 'kw') → scriptId

    window.addEventListener('message', (e) => this._onMessage(e));
  }

  async loadAll() {
    const sources = await (await fetch('/api/sources')).json();
    for (const s of sources) {
      if (s.enabled) await this.load(s);
    }
  }

  async load(sourceRow) {
    const id = String(sourceRow.id);
    if (this.frames[id]) this.unload(id);

    const iframe = document.createElement('iframe');
    iframe.src = '/static/js/sandbox/frame.html';
    iframe.style.display = 'none';
    iframe.dataset.scriptId = id;
    document.body.appendChild(iframe);

    const entry = { iframe, sources: null, ready: false, pending: [] };
    this.frames[id] = entry;

    // Wait for iframe to load, then send init
    await new Promise(r => { iframe.onload = r; });

    const scriptResp = await fetch(`/api/sources/${id}/script`);
    const rawScript = await scriptResp.text();

    iframe.contentWindow.postMessage({
      type: 'init',
      scriptId: id,
      rawScript,
      scriptInfo: {
        name: sourceRow.name,
        description: sourceRow.description,
        version: sourceRow.version,
        author: sourceRow.author,
        homepage: sourceRow.homepage,
      },
    }, '*');

    // Wait for inited (max 15s)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        entry.ready = false;
        reject(new Error('init timeout'));
      }, 15000);
      entry._initResolve = (sources) => {
        clearTimeout(timer);
        entry.sources = sources;
        entry.ready = true;
        // Map each source key to this script
        for (const key of Object.keys(sources)) {
          this._sourceMap[key] = id;
        }
        // Persist sources_json to backend
        fetch(`/api/sources/${id}`, {
          method: 'PUT',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ sources_json: JSON.stringify(sources) }),
        });
        resolve(sources);
      };
      entry._initReject = (err) => {
        clearTimeout(timer);
        reject(err);
      };
    });
  }

  unload(scriptId) {
    const entry = this.frames[scriptId];
    if (!entry) return;
    entry.iframe.remove();
    // Clean source map
    if (entry.sources) {
      for (const key of Object.keys(entry.sources)) {
        if (this._sourceMap[key] === scriptId) delete this._sourceMap[key];
      }
    }
    delete this.frames[scriptId];
  }

  getAvailableSources() {
    const result = {};
    for (const [id, entry] of Object.entries(this.frames)) {
      if (entry.ready && entry.sources) {
        for (const [key, info] of Object.entries(entry.sources)) {
          result[key] = { ...info, scriptId: id };
        }
      }
    }
    return result;
  }

  async request(source, action, info, timeout = 30000) {
    const scriptId = this._sourceMap[source];
    if (!scriptId) throw new Error(`no script provides source "${source}"`);
    const entry = this.frames[scriptId];
    if (!entry || !entry.ready) throw new Error(`source "${source}" not ready`);

    const reqId = ++this._reqId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        delete this._pending[reqId];
        reject(new Error('request timeout'));
      }, timeout);
      this._pending[reqId] = { resolve, reject, timer };
      entry.iframe.contentWindow.postMessage({
        type: 'request', reqId, source, action, info,
      }, '*');
    });
  }

  _onMessage(e) {
    const msg = e.data;
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'inited': {
        const entry = this.frames[msg.scriptId];
        if (entry && entry._initResolve) entry._initResolve(msg.sources);
        break;
      }
      case 'init-error': {
        const entry = this.frames[msg.scriptId];
        if (entry && entry._initReject) entry._initReject(new Error(msg.error));
        break;
      }
      case 'request-ok': {
        const p = this._pending[msg.reqId];
        if (p) { clearTimeout(p.timer); delete this._pending[msg.reqId]; p.resolve(msg.result); }
        break;
      }
      case 'request-err': {
        const p = this._pending[msg.reqId];
        if (p) { clearTimeout(p.timer); delete this._pending[msg.reqId]; p.reject(new Error(msg.error)); }
        break;
      }
      case 'http-request': {
        this._proxyHttp(msg.reqId, msg.url, msg.options, e.source);
        break;
      }
      case 'updateAlert': {
        console.log(`[source ${msg.scriptId}] update:`, msg.log, msg.updateUrl);
        break;
      }
    }
  }

  async _proxyHttp(reqId, url, options, source) {
    try {
      const resp = await fetch('/api/proxy', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ url, options }),
      });
      const data = await resp.json();
      if (data.error) {
        source.postMessage({ type: 'http-response', reqId, error: data.error }, '*');
      } else {
        source.postMessage({
          type: 'http-response', reqId,
          status: data.status, headers: data.headers, body: data.body,
        }, '*');
      }
    } catch (err) {
      source.postMessage({ type: 'http-response', reqId, error: String(err) }, '*');
    }
  }
}

// Export as global singleton
window.sourceHost = new SourceHost();
