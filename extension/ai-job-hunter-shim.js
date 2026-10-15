/* ===================================================================
 * AI智能投递助手 · 主世界兼容层（GM_* 接口垫片）
 * -------------------------------------------------------------------
 * 扩展环境没有油猴的 GM_* 接口。本段在页面主世界运行，在主体脚本之前
 * 执行，把下列接口准备好，使主体脚本无需改动即可运行：
 *   GM_getValue / GM_setValue / GM_deleteValue / GM_listValues /
 *   GM_addValueChangeListener / GM_removeValueChangeListener /
 *   GM_addStyle / GM_getResourceText / GM_xmlhttpRequest /
 *   GM_notification / GM_info / unsafeWindow
 *
 * 通信方式（与隔离世界的内容脚本用 postMessage 交互）：
 *   网络  -> 内容脚本 -> chrome.runtime -> 后台 Service Worker
 *            （后台不受页面 CORS 与 https 页面访问 http 接口的混合内容限制）
 *   存储  -> chrome.storage.local（真源）+ localStorage 镜像（同步读取）
 *   通知  -> chrome.notifications
 * =================================================================== */
(function () {
  "use strict";
  var MIRROR_KEY = "__ajh_gm_cache_v1";
  var store = {};
  var listeners = {};
  var pending = {};
  var seq = 0;

  try { store = JSON.parse(localStorage.getItem(MIRROR_KEY) || "{}") || {}; } catch (e) { store = {}; }

  function persistMirror() {
    try { localStorage.setItem(MIRROR_KEY, JSON.stringify(store)); } catch (e) {}
  }

  // 与内容脚本通信：使用 DOM 自定义事件（跨"主世界/隔离世界"可靠传递）
  document.addEventListener("__ajh_to_main__", function (ev) {
    var d = null;
    try {
      var raw = ev && ev.detail;
      d = (typeof raw === "string") ? JSON.parse(raw) : raw;
    } catch (e) { d = null; }
    if (!d || typeof d !== "object") return;
    if (d.__ajhRes) {
    }
    if (d.__ajhRes && d.__ajhRes.id && pending[d.__ajhRes.id]) {
      var cb = pending[d.__ajhRes.id];
      delete pending[d.__ajhRes.id];
      try { cb(d.__ajhRes); } catch (e) {}
      return;
    }
    if (d.__ajhStore && typeof d.__ajhStore === "object") {
      var old = store;
      store = d.__ajhStore;
      persistMirror();
      Object.keys(store).forEach(function (k) {
        try {
          if (old[k] !== store[k]) {
            (listeners[k] || []).forEach(function (fn) { try { fn(k, old[k], store[k], true); } catch (e) {} });
          }
        } catch (e) {}
      });
    }
  });

  function __ajhSend(detail) {
    try {
      var raw = JSON.stringify(detail);
      if (raw == null) return;
      document.dispatchEvent(new CustomEvent("__ajh_to_content__", { detail: raw }));
    } catch (e) {}
  }

  function rpc(net, timeoutMs) {
    return new Promise(function (resolve) {
      var id = "ajh-" + (++seq) + "-" + Math.random().toString(36).slice(2, 8);
      var settled = false;
      function done(res) {
        if (settled) return;
        settled = true;
        delete pending[id];
        resolve(res);
      }
      pending[id] = done;
      try {
        __ajhSend({ __ajhReq: { id: id, net: net } });
      } catch (e) {
        done({ ok: false, err: String((e && e.message) || e) });
        return;
      }
      var guard = Number(timeoutMs) > 0 ? Number(timeoutMs) + 8000 : 180000;
      setTimeout(function () { done({ ok: false, aborted: true, err: "请求超时" }); }, guard);
    });
  }

  function GM_getValue(key, defVal) {
    try { if (Object.prototype.hasOwnProperty.call(store, key)) return store[key]; } catch (e) {}
    return defVal;
  }

  function GM_setValue(key, value) {
    try { store[key] = value; } catch (e) {}
    persistMirror();
    try { __ajhSend({ __ajhSet: { k: key, v: value } }); } catch (e) {}
    (listeners[key] || []).forEach(function (fn) { try { fn(key, null, value, false); } catch (e) {} });
  }

  function GM_deleteValue(key) {
    try { delete store[key]; } catch (e) {}
    persistMirror();
    try { __ajhSend({ __ajhDel: { k: key } }); } catch (e) {}
  }

  function GM_listValues() { return Object.keys(store); }

  function GM_addValueChangeListener(key, fn) {
    if (!listeners[key]) listeners[key] = [];
    listeners[key].push(fn);
    return listeners[key].length;
  }

  function GM_removeValueChangeListener(id) {
    Object.keys(listeners).forEach(function (k) {
      if (listeners[k].length >= id) listeners[k] = [];
    });
  }

  function GM_addStyle(css) {
    try {
      var el = document.createElement("style");
      el.textContent = css || "";
      (document.head || document.documentElement).appendChild(el);
      return el;
    } catch (e) { return null; }
  }

  function GM_getResourceText() { return ""; }

  function GM_notification(optsOrText, title, image) {
    try {
      var o = (typeof optsOrText === "object" && optsOrText) ? optsOrText : {};
      var text = (typeof optsOrText === "string") ? optsOrText : (o.text || "");
      __ajhSend({
        __ajhNotify: {
          title: o.title || title || "AI智能投递助手",
          message: String(text || ""),
          icon: o.image || image || ""
        }
      });
      if (typeof o.onclick === "function") { try { o.onclick(); } catch (e) {} }
      if (typeof o.ondone === "function") { try { o.ondone(); } catch (e) {} }
    } catch (e) {}
  }

  function toGMResponse(res) {
    var out = { status: 0, statusText: "", readyState: 4, responseText: "", responseHeaders: "" };
    if (!res) return out;
    out.status = typeof res.status === "number" ? res.status : 0;
    out.statusText = res.statusText || "";
    out.finalUrl = res.finalUrl || "";
    try {
      var lines = [];
      var hs = res.headers || {};
      Object.keys(hs).forEach(function (k) { lines.push(k + ": " + hs[k]); });
      out.responseHeaders = lines.join("\r\n");
    } catch (e) {}
    if (res.ok) {
      if (res.b64 != null) {
        try {
          var bin = atob(res.b64);
          var buf = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
          out.response = buf.buffer;
          out.responseText = "";
        } catch (e) { out.response = new ArrayBuffer(0); }
      } else {
        out.responseText = res.text != null ? res.text : "";
        try { out.response = JSON.parse(out.responseText); } catch (e) { out.response = out.responseText; }
      }
    } else {
      out.error = res.err || "network error";
      if (res.status) out.status = res.status;
    }
    return out;
  }

  function GM_xmlhttpRequest(opts) {
    opts = opts || {};
    var wantBuf = String(opts.responseType || "").toLowerCase() === "arraybuffer";
    rpc({
      url: opts.url,
      method: opts.method,
      headers: opts.headers,
      data: opts.data,
      timeout: opts.timeout,
      responseType: wantBuf ? "arraybuffer" : "text"
    }, opts.timeout).then(function (res) {
      var gm = toGMResponse(res);
      try {
        if (res && res.ok) {
          if (typeof opts.onload === "function") opts.onload(gm);
        } else if (res && res.aborted) {
          if (typeof opts.ontimeout === "function") opts.ontimeout(gm);
          else if (typeof opts.onerror === "function") opts.onerror(gm);
        } else if (typeof opts.onerror === "function") {
          opts.onerror(gm);
        }
      } catch (e) {}
      try { if (typeof opts.onloadend === "function") opts.onloadend(gm); } catch (e) {}
    });
    return {
      abort: function () {
        try { __ajhSend({ __ajhAbort: 1 }); } catch (e) {}
      }
    };
  }

  var GM_info = {
    script: {
      name: "AI智能投递助手",
      namespace: "https://github.com/yangfeng20",
      version: "26.10.4",
      grant: ["GM_addStyle", "GM_getValue", "GM_setValue", "GM_deleteValue", "GM_listValues",
              "GM_addValueChangeListener", "GM_xmlhttpRequest", "GM_notification", "unsafeWindow"]
    }
  };

  var W = window;
  W.GM_getValue = GM_getValue;
  W.GM_setValue = GM_setValue;
  W.GM_deleteValue = GM_deleteValue;
  W.GM_listValues = GM_listValues;
  W.GM_addValueChangeListener = GM_addValueChangeListener;
  W.GM_removeValueChangeListener = GM_removeValueChangeListener;
  W.GM_addStyle = GM_addStyle;
  W.GM_getResourceText = GM_getResourceText;
  W.GM_notification = GM_notification;
  W.GM_xmlhttpRequest = GM_xmlhttpRequest;
  W.GM_info = GM_info;
  W.unsafeWindow = W;
  W.__AJH_EXT__ = true;
  try { console.info("[AI智能投递助手] 扩展兼容层就绪 · v" + GM_info.script.version); } catch (e) {}
})();
