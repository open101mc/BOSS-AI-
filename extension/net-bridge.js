/* ===================================================================
 * AI智能投递助手 · 后台网络桥（Service Worker 侧）
 * -------------------------------------------------------------------
 * 由 bg-wrapper.js 通过 importScripts 加载。
 * 作用：把主世界脚本发起的外部请求转发到扩展后台执行。
 *   后台不受页面 CORS 限制，也不受「https 页面 -> http 接口」的混合内容
 *   限制，因此可以直连自建网关 / API 中转站，以及 BOSS 的二进制下载接口。
 * 说明：本文件为新增文件；Boss-Helper 的 background.js 一字未改。
 * =================================================================== */
(function () {
  "use strict";
  var MAX_BYTES = 32 * 1024 * 1024;

  function toBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var out = "";
    var CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(out);
  }

  function pickHeaders(res) {
    var h = {};
    try {
      res.headers.forEach(function (v, k) { h[k] = v; });
    } catch (e) {}
    return h;
  }

  function netFetch(msg, respond) {
    var timer = null;
    var ctrl = new AbortController();
    var finished = false;
    function done(payload) {
      if (finished) return;
      finished = true;
      if (timer) { clearTimeout(timer); timer = null; }
      try { respond(payload); } catch (e) {}
    }
    try {
      if (Number(msg.timeoutMs) > 0) {
        timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, Number(msg.timeoutMs));
      }
    } catch (e) {}

    var method = String(msg.method || "GET").toUpperCase();
    var init = {
      method: method,
      headers: msg.headers || {},
      signal: ctrl.signal,
      credentials: "include",
      cache: "no-store",
      redirect: "follow"
    };
    if (msg.data != null && method !== "GET" && method !== "HEAD") init.body = msg.data;

    var out = { id: msg.id };
    fetch(msg.url, init).then(function (res) {
      out.status = res.status;
      out.statusText = res.statusText || "";
      out.headers = pickHeaders(res);
      out.finalUrl = res.url || msg.url;
      if (msg.responseType === "arraybuffer") {
        return res.arrayBuffer().then(function (ab) {
          if (ab.byteLength > MAX_BYTES) throw new Error("响应过大（" + ab.byteLength + " 字节），超过上限");
          out.b64 = toBase64(ab);
          out.bytes = ab.byteLength;
          return out;
        });
      }
      return res.text().then(function (t) {
        out.text = t;
        out.len = t.length;
        return out;
      });
    }).then(function (payload) {
      payload.ok = true;
      done(payload);
    }).catch(function (e) {
      var name = (e && e.name) || "";
      done({
        id: msg.id,
        ok: false,
        aborted: name === "AbortError",
        err: String((e && e.message) || e || "network error"),
        name: name
      });
    });
  }

  function notify(payload) {
    try {
      var n = payload || {};
      var icon = n.icon || "";
      if (!icon) {
        try { icon = chrome.runtime.getURL("icons/128.png"); } catch (e) { icon = ""; }
      }
      chrome.notifications.create("ajh-" + Date.now().toString(36), {
        type: "basic",
        iconUrl: icon,
        title: n.title || "AI智能投递助手",
        message: String(n.message || "")
      });
    } catch (e) {}
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, respond) {
    if (!msg || typeof msg !== "object") return;
    if (msg.__ajhNet === 1) {
      netFetch(msg, respond);
      return true;
    }
    if (msg.__ajhNotify === 1) {
      notify(msg.n);
      try { respond({ ok: true }); } catch (e) {}
      return true;
    }
    return;
  });
})();
