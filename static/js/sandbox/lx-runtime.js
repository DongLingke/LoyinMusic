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

  // Real crypto/zlib backed by crypto-js + pako (loaded in frame.html).
  // Matches the LX Music utils API so most real-world sources work unchanged.
  const CJS = globalThis.CryptoJS;
  const PAKO = globalThis.pako;

  // Coerce LX-style key/data args into CryptoJS WordArrays.
  function toWA(v) {
    if (v == null) return CJS.lib.WordArray.create();
    if (typeof v === 'string') return CJS.enc.Utf8.parse(v);
    if (v.words) return v; // already a WordArray
    // Buffer / Uint8Array / Array
    const bytes = v instanceof Uint8Array ? v : new Uint8Array(v);
    return CJS.lib.WordArray.create(bytes);
  }
  const MODES = { CBC: 'CBC', ECB: 'ECB', CFB: 'CFB', OFB: 'OFB', CTR: 'CTR' };
  const PADS = { Pkcs7: 'Pkcs7', PKCS7: 'Pkcs7', NoPadding: 'NoPadding', ZeroPadding: 'ZeroPadding', Iso10126: 'Iso10126' };

  const utils = {
    buffer: {
      from(data, enc) {
        if (typeof data === 'string') {
          if (enc === 'base64') return CJS.enc.Base64.parse(data);
          if (enc === 'hex') return CJS.enc.Hex.parse(data);
          return CJS.enc.Utf8.parse(data);
        }
        return toWA(data);
      },
      bufToString(buf, format) {
        if (typeof buf === 'string') return buf;
        const wa = buf && buf.words ? buf : toWA(buf);
        if (format === 'base64') return CJS.enc.Base64.stringify(wa);
        if (format === 'hex') return CJS.enc.Hex.stringify(wa);
        return CJS.enc.Utf8.stringify(wa);
      },
    },
    crypto: {
      md5(str, format = 'hex') {
        const h = CJS.MD5(typeof str === 'string' ? str : toWA(str));
        return format === 'base64' ? CJS.enc.Base64.stringify(h) : h.toString();
      },
      sha256(str, format = 'hex') {
        const h = CJS.SHA256(typeof str === 'string' ? str : toWA(str));
        return format === 'base64' ? CJS.enc.Base64.stringify(h) : h.toString();
      },
      aesEncrypt(data, mode, key, iv, opts = {}) {
        const cfg = {
          mode: CJS.mode[MODES[mode] || 'CBC'],
          padding: CJS.pad[PADS[opts.padding] || 'Pkcs7'],
        };
        if (iv) cfg.iv = toWA(iv);
        const out = CJS.AES.encrypt(toWA(data), toWA(key), cfg);
        return opts.output === 'hex'
          ? out.ciphertext.toString(CJS.enc.Hex)
          : out.toString(); // base64 (OpenSSL format minus salt for raw modes)
      },
      aesDecrypt(data, mode, key, iv, opts = {}) {
        const cfg = {
          mode: CJS.mode[MODES[mode] || 'CBC'],
          padding: CJS.pad[PADS[opts.padding] || 'Pkcs7'],
        };
        if (iv) cfg.iv = toWA(iv);
        const cipherParams = CJS.lib.CipherParams.create({ ciphertext: toWA(data) });
        const out = CJS.AES.decrypt(cipherParams, toWA(key), cfg);
        return CJS.enc.Utf8.stringify(out);
      },
      rsaEncrypt() {
        // RSA needs a bigint impl crypto-js lacks; sources requiring it are rare.
        throw new Error('rsaEncrypt not supported in sandbox');
      },
      randomBytes(len) {
        const arr = new Uint8Array(len);
        crypto.getRandomValues(arr);
        return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
      },
    },
    zlib: {
      inflate(data) { return PAKO.inflate(_toU8(data)); },
      deflate(data) { return PAKO.deflate(_toU8(data)); },
      gunzip(data)  { return PAKO.ungzip(_toU8(data)); },
      gzip(data)    { return PAKO.gzip(_toU8(data)); },
    },
  };

  function _toU8(data) {
    if (data instanceof Uint8Array) return data;
    if (typeof data === 'string') return new TextEncoder().encode(data);
    if (data && data.words) {
      // CryptoJS WordArray → Uint8Array
      const { words, sigBytes } = data;
      const u8 = new Uint8Array(sigBytes);
      for (let i = 0; i < sigBytes; i++) u8[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
      return u8;
    }
    return new Uint8Array(data);
  }

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
