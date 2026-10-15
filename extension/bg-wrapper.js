/* ===================================================================
 * AI智能投递助手 · 后台入口包装器（Service Worker）
 * -------------------------------------------------------------------
 * 浏览器只加载本文件作为扩展后台；本文件按顺序 importScripts 载入：
 *   1) background.js —— Boss-Helper 原有后台逻辑（文件本身一字未改）
 *   2) net-bridge.js —— 新增的跨域网络桥（供 AI 脚本使用）
 * 说明：importScripts 必须在 Service Worker 顶层同步调用，因此这里用
 *   立即执行的同步 IIFE 包裹，保证加载顺序稳定。
 * =================================================================== */
(function () {
  "use strict";
  function load(file) {
    try {
      importScripts(file);
    } catch (e) {
      try { console.error("[AI智能投递助手] 后台脚本加载失败：" + file, e); } catch (e2) {}
    }
  }
  load("background.js");
  load("net-bridge.js");
})();
