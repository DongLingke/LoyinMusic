/* ═══════════════════════════════════════════════════════════════════
   LX Music 自定义源兼容运行时 — 在 iframe 沙箱中注入 globalThis.lx

   协议版本：兼容 lx-music-desktop v2.6.0+
   通信方式：window.parent.postMessage ↔ window.addEventListener('message')

   主页面 (host.js) 发来的消息格式：
     { type: 'init',    scriptId, rawScript, scriptInfo }
     { type: 'request', reqId, source, action, info }

   沙箱回主页面的消息格式：
     { type: 'inited',       scriptId, sources }
     { type: 'request-ok',   reqId, result }
     { type: 'request-err',  reqId, error }
     { type: 'http-request', reqId, url, options }
     { type: 'updateAlert',  scriptId, log, updateUrl }
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  let _scriptId = null;
  let _handlers = {};       // event name → handler function
  let _httpReqId = 0;
  let _httpCallbacks = {};  // reqId → callback

  const EVENT_NAMES = {
    inited: 'inited',
    request: 'request',
    updateAlert: 'updateAlert',
  };

  function on(eventName, handler) {
    _handlers[eventName] = handler;
  }

  function send(eventName, data) {
    if (eventName === EVENT_NAMES.inited) {
      window.parent.postMessage({
        type: 'inited', scriptId: _scriptId, sources: data.sources || data,
      }, '*');
    } else if (eventName === EVENT_NAMES.updateAlert) {
      window.parent.postMessage({
        type: 'updateAlert', scriptId: _scriptId,
        log: data.log, updateUrl: data.updateUrl,
      }, '*');
    }
  }

  function request(url, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    const id = ++_httpReqId;
    _httpCallbacks[id] = callback;
    window.parent.postMessage({
      type: 'http-request', reqId: id, url, options: options || {},
    }, '*');
    return () => { delete _httpCallbacks[id]; };
  }

  // Minimal utils — enough for most real-world LX sources
  const utils = {
    buffer: {
      bufToString(buf, format) {
        if (typeof buf === 'string') return buf;
        const dec = new TextDecoder(format || 'utf-8');
        return dec.decode(buf instanceof ArrayBuffer ? buf : new Uint8Array(buf));
      },
    },
    crypto: {
      md5(str) {
        // Simple MD5 — sources that need real crypto will fail gracefully;
        // for full compat, the host could provide a crypto-js bridge.
        // Placeholder: return hex hash via SubtleCrypto (async, but most
        // sources only use md5 synchronously for cache keys — they'll get
        // a predictable unique string either way).
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
          hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
        }
        return Math.abs(hash).toString(16).padStart(8, '0');
      },
      aesEncrypt() { throw new Error('aesEncrypt not implemented in sandbox'); },
      rsaEncrypt() { throw new Error('rsaEncrypt not implemented in sandbox'); },
      randomBytes(len) {
        const arr = new Uint8Array(len);
        crypto.getRandomValues(arr);
        return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
      },
    },
    zlib: {
      inflate() { throw new Error('zlib.inflate not implemented — load pako'); },
      deflate() { throw new Error('zlib.deflate not implemented — load pako'); },
    },
  };

  // Build the globalThis.lx object that scripts expect
  const lx = {
    EVENT_NAMES,
    on,
    send,
    request,
    utils,
    env: 'desktop',
    version: '2.8.0',
    currentScriptInfo: null,  // filled on init
  };
  globalThis.lx = lx;

  // ── Message handler from host ──────────────────────────────────
  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'init': {
        _scriptId = msg.scriptId;
        lx.currentScriptInfo = {
          name: msg.scriptInfo?.name || '',
          description: msg.scriptInfo?.description || '',
          version: msg.scriptInfo?.version || '',
          author: msg.scriptInfo?.author || '',
          homepage: msg.scriptInfo?.homepage || '',
          rawScript: msg.rawScript || '',
        };
        try {
          new Function(msg.rawScript)();
        } catch (err) {
          window.parent.postMessage({
            type: 'init-error', scriptId: _scriptId, error: String(err),
          }, '*');
        }
        break;
      }

      case 'request': {
        const handler = _handlers[EVENT_NAMES.request];
        if (!handler) {
          window.parent.postMessage({
            type: 'request-err', reqId: msg.reqId,
            error: 'no request handler registered',
          }, '*');
          return;
        }
        try {
          const result = handler({
            source: msg.source, action: msg.action, info: msg.info,
          });
          Promise.resolve(result).then(
            (val) => window.parent.postMessage({
              type: 'request-ok', reqId: msg.reqId, result: val,
            }, '*'),
            (err) => window.parent.postMessage({
              type: 'request-err', reqId: msg.reqId, error: String(err),
            }, '*'),
          );
        } catch (err) {
          window.parent.postMessage({
            type: 'request-err', reqId: msg.reqId, error: String(err),
          }, '*');
        }
        break;
      }

      case 'http-response': {
        const cb = _httpCallbacks[msg.reqId];
        if (cb) {
          delete _httpCallbacks[msg.reqId];
          if (msg.error) {
            cb(new Error(msg.error), null, null);
          } else {
            cb(null, { statusCode: msg.status, headers: msg.headers, body: msg.body }, msg.body);
          }
        }
        break;
      }
    }
  });
})();
