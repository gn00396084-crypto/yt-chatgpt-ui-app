// mcp.resources.js (FINAL)

import { readFileSync } from "node:fs";

/** ====== Unique App ID (用你 GitHub account) ====== */
export const APP_ID = "io.github.gn00396084-crypto.ytfinder";

/** ====== UI Widget URIs (必須 ui://widget) ====== */
export const HOME_URI = "ui://widget/youtube-finder-home.html";
export const SEARCH_URI = "ui://widget/youtube-finder-search.html";
export const VIDEOS_URI = "ui://widget/youtube-finder-videos.html";

/** ====== Skybridge mime ====== */
export const SKYBRIDGE_MIME = "text/html+skybridge";

/** ====== Widget CSP / Domain (俾審核器/檢視器用) ====== */
export const WIDGET_CSP = {
  connect_domains: ["https://www.googleapis.com"],
  resource_domains: ["https://i.ytimg.com"],
  frame_domains: []
};

// 有啲檢視器會期待呢個欄位存在（加咗無壞）
export const WIDGET_DOMAIN = "https://chatgpt.com";

/** ====== Local HTML files (同 repo root) ====== */
const UI_FILES = {
  home: "./ui-index.html",
  search: "./ui-search.html",
  videos: "./ui-videos.html"
};

function loadUI(relPath) {
  const url = new URL(relPath, import.meta.url);
  return readFileSync(url, "utf8");
}

function makeUiContent({ uri, html, pageKey, description }) {
  // ✅ 唔用 ":"，用 "."，而且每頁唯一
  const widgetType = `${APP_ID}.${pageKey}`;
  const widgetId = widgetType;

  return {
    uri,
    type: "text",
    mimeType: SKYBRIDGE_MIME,
    text: html,
    _meta: {
      "openai/widgetCSP": WIDGET_CSP,
      "openai/widgetDomain": WIDGET_DOMAIN,
      "openai/widgetType": widgetType,
      "openai/widgetId": widgetId,
      "openai/widgetDescription": description,
      "openai/widgetPrefersBorder": true
    }
  };
}

function makeResourceMeta({ title, description, pageKey }) {
  // 有啲工具會讀「resource metadata」→ 我哋兩邊都 set（最穩）
  return {
    title,
    mimeType: SKYBRIDGE_MIME,
    description,
    _meta: {
      "openai/widgetCSP": WIDGET_CSP,
      "openai/widgetDomain": WIDGET_DOMAIN,
      "openai/widgetType": `${APP_ID}.${pageKey}`,
      "openai/widgetId": `${APP_ID}.${pageKey}`,
      "openai/widgetDescription": description,
      "openai/widgetPrefersBorder": true
    }
  };
}

/** ====== Register resources ====== */
export function registerResources(mcp) {
  const UI_HOME_HTML = loadUI(UI_FILES.home);
  const UI_SEARCH_HTML = loadUI(UI_FILES.search);
  const UI_VIDEOS_HTML = loadUI(UI_FILES.videos);

  mcp.registerResource(
    "youtube-finder-home",
    HOME_URI,
    makeResourceMeta({
      title: "YouTube Finder Home",
      description: "Home screen for YouTube Finder.",
      pageKey: "home"
    }),
    async () => ({
      contents: [
        makeUiContent({
          uri: HOME_URI,
          html: UI_HOME_HTML,
          pageKey: "home",
          description: "Home screen for YouTube Finder."
        })
      ]
    })
  );

  mcp.registerResource(
    "youtube-finder-search",
    SEARCH_URI,
    makeResourceMeta({
      title: "YouTube Finder Search",
      description: "Search videos by title keyword.",
      pageKey: "search"
    }),
    async () => ({
      contents: [
        makeUiContent({
          uri: SEARCH_URI,
          html: UI_SEARCH_HTML,
          pageKey: "search",
          description: "Search videos by title keyword."
        })
      ]
    })
  );

  mcp.registerResource(
    "youtube-finder-videos",
    VIDEOS_URI,
    makeResourceMeta({
      title: "YouTube Finder Videos",
      description: "List latest channel videos.",
      pageKey: "videos"
    }),
    async () => ({
      contents: [
        makeUiContent({
          uri: VIDEOS_URI,
          html: UI_VIDEOS_HTML,
          pageKey: "videos",
          description: "List latest channel videos."
        })
      ]
    })
  );
}

/** ====== Debug exports (俾 /debug/* 用) ====== */
export function debugListResources() {
  return [
    { key: "home", uri: HOME_URI, expectedType: `${APP_ID}.home` },
    { key: "search", uri: SEARCH_URI, expectedType: `${APP_ID}.search` },
    { key: "videos", uri: VIDEOS_URI, expectedType: `${APP_ID}.videos` }
  ];
}

export function debugInspectHtml(key) {
  const rel = UI_FILES[key];
  if (!rel) return { error: `unknown key: ${key}`, allowed: Object.keys(UI_FILES) };

  const html = loadUI(rel);

  const appType =
    /<meta\s+name=["']app:type["']\s+content=["']([^"']+)["']\s*\/?>/i.exec(html)?.[1] ?? null;

  const bodyType =
    /<body[^>]*\sdata-widget-type=["']([^"']+)["'][^>]*>/i.exec(html)?.[1] ?? null;

  const scriptTypes = [...html.matchAll(/<script\b[^>]*\stype=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]);

  return {
    key,
    file: rel,
    expectedType: `${APP_ID}.${key}`,
    appType,
    bodyType,
    scriptTypes,
    hasModuleScript: scriptTypes.includes("module")
  };
}
