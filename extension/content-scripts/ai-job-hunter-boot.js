/* ===================================================================
 * AI智能投递助手 · 隔离世界桥接脚本（content script）
 * -------------------------------------------------------------------
 * 与 Boss-Helper 架构一致：content script 只做"搬运"，真正的业务逻辑
 * 注入页面主世界（MAIN world）执行——这样才能劫持页面自身的 WebSocket、
 * 访问页面全局对象（与油猴版行为一致）。
 *
 * 职责：
 *   1) 读取 chrome.storage 中的持久配置合并进 localStorage 镜像
 *      （主世界的 GM_getValue 需要同步读取）；
 *   2) 依次注入 GM 兼容层（shim）与主体脚本（ai-job-hunter.js）；
 *   3) 承接主世界发来的 网络请求 / 存储写入 / 通知，转交后台处理。
 *
 * 本文件为新增文件，不修改 Boss-Helper 原有的任何文件。
 * =================================================================== */
(function () {
  "use strict";

  var SHIM_URL = "ai-job-hunter-shim.js";
  var BODY_URL = "ai-job-hunter.js";
  var MIRROR_KEY = "__ajh_gm_cache_v1";

  function uuid() {
    return "ajh-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  var mirror = {};
  try { mirror = JSON.parse(localStorage.getItem(MIRROR_KEY) || "{}") || {}; } catch (e) { mirror = {}; }

  function saveMirror() {
    try { localStorage.setItem(MIRROR_KEY, JSON.stringify(mirror)); } catch (e) {}
  }

  function pushStore(key, value) {
    var o = {};
    o["ajh:" + key] = value;
    try { chrome.storage.local.set(o); } catch (e) {}
  }

  function delStore(key) {
    try { chrome.storage.local.remove("ajh:" + key); } catch (e) {}
  }

  function __toMain(detail) {
    try {
      var raw = JSON.stringify(detail);
      if (raw == null) return;
      document.dispatchEvent(new CustomEvent("__ajh_to_main__", { detail: raw }));
    } catch (e) {}
  }

  function netRequest(p) {
    return new Promise(function (resolve) {
      var id = uuid();
      var payload = {
        __ajhNet: 1,
        id: id,
        url: p.url,
        method: p.method || "GET",
        headers: p.headers || {},
        data: p.data,
        responseType: p.responseType || "text",
        timeoutMs: Number(p.timeout) > 0 ? Number(p.timeout) : 0
      };
      var settled = false;
      function done(res) {
        if (settled) return;
        settled = true;
        resolve(res);
      }
      try {
        chrome.runtime.sendMessage(payload, function (res) {
          if (chrome.runtime.lastError) {
            done({ ok: false, err: String(chrome.runtime.lastError.message || "runtime error") });
            return;
          }
          done(res || { ok: false, err: "后台无响应" });
        });
      } catch (e) {
        done({ ok: false, err: String((e && e.message) || e) });
        return;
      }
      var guard = Number(p.timeout) > 0 ? Number(p.timeout) + 6000 : 180000;
      setTimeout(function () { done({ ok: false, aborted: true, err: "请求超时" }); }, guard);
    });
  }

  // 与主世界通信：DOM 自定义事件（跨"隔离世界/主世界"可靠传递）
  document.addEventListener("__ajh_to_content__", function (ev) {
    var d = null;
    try {
      var raw = ev && ev.detail;
      d = (typeof raw === "string") ? JSON.parse(raw) : raw;
    } catch (e) { d = null; }
    if (!d || typeof d !== "object") return;
    if (d.__ajhReq && d.__ajhReq.net && d.__ajhReq.id) {
      var id = d.__ajhReq.id;
      netRequest(d.__ajhReq.net).then(function (res) {
        // 注意：后台返回体里也带 id（那是给后台用的），必须用本次请求 id 收尾覆盖，
        // 否则主世界按 id 找不到对应的等待回调。
        __toMain({ __ajhRes: Object.assign({}, res, { id: id }) });
      });
      return;
    }
    if (d.__ajhSet && d.__ajhSet.k != null) {
      mirror[d.__ajhSet.k] = d.__ajhSet.v;
      saveMirror();
      pushStore(d.__ajhSet.k, d.__ajhSet.v);
      return;
    }
    if (d.__ajhDel && d.__ajhDel.k != null) {
      try { delete mirror[d.__ajhDel.k]; } catch (e) {}
      saveMirror();
      delStore(d.__ajhDel.k);
      return;
    }
    if (d.__ajhNotify) {
      try { chrome.runtime.sendMessage({ __ajhNotify: 1, n: d.__ajhNotify }); } catch (e) {}
    }
  });

  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== "local") return;
      var touched = false;
      Object.keys(changes || {}).forEach(function (k) {
        if (k.indexOf("ajh:") !== 0) return;
        var nv = changes[k].newValue;
        if (nv === undefined) return;
        mirror[k.slice(4)] = nv;
        touched = true;
      });
      if (touched) {
        saveMirror();
        __toMain({ __ajhStore: mirror });
      }
    });
  } catch (e) {}

  function hydrate() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(null, function (all) {
          try {
            Object.keys(all || {}).forEach(function (k) {
              if (k.indexOf("ajh:") === 0) mirror[k.slice(4)] = all[k];
            });
            saveMirror();
          } catch (e) {}
          resolve();
        });
      } catch (e) { resolve(); }
    });
  }

  function injectScript(src, label) {
    return new Promise(function (resolve) {
      var s = null;
      try {
        s = document.createElement("script");
        s.src = chrome.runtime.getURL(src);
        s.async = false;
        s.dataset.ajh = label || src;
        s.onload = function () {
          try { if (s.parentNode) s.parentNode.removeChild(s); } catch (e) {}
          resolve(true);
        };
        s.onerror = function () {
          try { console.error("[AI智能投递助手] 注入失败：" + src); } catch (e) {}
          try { if (s.parentNode) s.parentNode.removeChild(s); } catch (e) {}
          resolve(false);
        };
        (document.head || document.documentElement).appendChild(s);
      } catch (e) { resolve(false); }
    });
  }

  function start() {
    hydrate().then(function () {
      return injectScript(SHIM_URL, "shim");
    }).then(function () {
      return injectScript(BODY_URL, "body");
    }).then(function () {
      try { console.info("[AI智能投递助手] 扩展版已注入 · v26.10.4"); } catch (e) {}
    });
  }

  start();
})();
