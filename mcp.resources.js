// mcp.resources.js (FINAL)
// - Node/Railway friendly (readFileSync)
// - 3 UI widgets via ui://widget/*
// - Each resource includes: mimeType + openai/widgetCSP + openai/widgetType + openai/widgetId
// - Debug helpers: debugListResources(), debugInspectHtml()

import { readFileSync } from "node:fs";

/* =========================
 * UI Widget URIs (MUST be ui://widget)
 * ========================= */
export const HOME_URI = "ui://widget/youtube-finder-home.html";
export const SEARCH_URI = "ui://widget/youtube-finder-search.html";
export const VIDEOS_URI = "ui://widget/youtube-finder-videos.html";

/* =========================
 * Widget meta
 * ========================= */
export const SKYBRIDGE_MIME = "text/html+skybridge";

// ✅ Your unique prefix (matches your GitHub username)
export const TYPE_PREFIX = "io.github.gn00396084-crypto.ytfinder";

// ✅ Widget CSP (OpenAI widget sandbox policy)
export const WIDGET_CSP = {
  connect_domains: ["https://www.googleapis.com"],
  resource_domains: ["https://i.ytimg.com"],
  frame_domains: []
};

/* =========================
 * Local HTML files (repo root)
 * ========================= */
const UI_FILES = {
  home: "./ui-index.html",
  search: "./ui-search.html",
  videos: "./ui-videos.html"
};

function loadUI(relPath) {
  const url = new URL(relPath, import.meta.url);
  return readFileSync(url, "utf8");
}

function makeUiContent(uri, html, pageKey, description) {
  // ✅ Widget type MUST be unique per page (no ":"; use dot)
  // Expected HTML inside page should match, e.g.
  // <meta name="app:type" content="io.github.gn00396084-crypto.ytfinder.home">
  const widgetType = `${TYPE_PREFIX}.${pageKey}`;
  const widgetId = widgetType;

  return {
    uri,
    type: "text",
    mimeType: SKYBRIDGE_MIME,
    text: html,
    _meta: {
      "openai/widgetCSP": WIDGET_CSP,
      "openai/widgetType": widgetType,
      "openai/widgetId": widgetId,
      "openai/widgetDescription": description,
      "openai/widgetPrefersBorder": true
    }
  };
}

/* =========================
 * Register resources (3 pages)
 * ========================= */
export function registerResources(mcp) {
  const UI_HOME_HTML = loadUI(UI_FILES.home);
  const UI_SEARCH_HTML = loadUI(UI_FILES.search);
  const UI_VIDEOS_HTML = loadUI(UI_FILES.videos);

  mcp.registerResource(
    "youtube-finder-home",
    HOME_URI,
    { title: "YouTube Finder Home", mimeType: SKYBRIDGE_MIME, description: "Home screen widget." },
    async () => ({
      contents: [makeUiContent(HOME_URI, UI_HOME_HTML, "home", "Home screen for YouTube Finder.")]
    })
  );

  mcp.registerResource(
    "youtube-finder-search",
    SEARCH_URI,
    { title: "YouTube Finder Search", mimeType: SKYBRIDGE_MIME, description: "Search widget." },
    async () => ({
      contents: [makeUiContent(SEARCH_URI, UI_SEARCH_HTML, "search", "Search videos by title keyword.")]
    })
  );

  mcp.registerResource(
    "youtube-finder-videos",
    VIDEOS_URI,
    { title: "YouTube Finder Videos", mimeType: SKYBRIDGE_MIME, description: "Latest videos list widget." },
    async () => ({
      contents: [makeUiContent(VIDEOS_URI, UI_VIDEOS_HTML, "videos", "List latest channel videos.")]
    })
  );
}

/* =========================
 * Debug helpers (for /debug/* endpoints)
 * ========================= */
export function debugListResources() {
  return [
    { key: "home", uri: HOME_URI, expectedType: `${TYPE_PREFIX}.home` },
    { key: "search", uri: SEARCH_URI, expectedType: `${TYPE_PREFIX}.search` },
    { key: "videos", uri: VIDEOS_URI, expectedType: `${TYPE_PREFIX}.videos` }
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

  const scriptTypes = [...html.matchAll(/<script\b[^>]*\stype=["']([^"']+)["'][^>]*>/gi)].map(
    (m) => m[1]
  );

  return {
    key,
    file: rel,
    expectedType: `${TYPE_PREFIX}.${key}`,
    appType,
    bodyType,
    scriptTypes,
    hasModuleScript: scriptTypes.includes("module")
  };
}
