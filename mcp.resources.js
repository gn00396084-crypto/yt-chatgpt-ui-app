import { readFileSync } from "node:fs";

/**
 * =========================
 * UI Widget URIs（一定要 ui://widget）
 * =========================
 */
export const HOME_URI   = "ui://widget/youtube-finder-home.html";
export const SEARCH_URI = "ui://widget/youtube-finder-search.html";
export const VIDEOS_URI = "ui://widget/youtube-finder-videos.html";

/**
 * =========================
 * Skybridge Widget MIME
 * =========================
 */
const SKYBRIDGE_MIME = "text/html+skybridge";

/**
 * =========================
 * ⚠️ 非常重要：唯一 widget type 前綴
 * 👉 請改成你自己唯一的字串（例如你的 GitHub / domain）
 * =========================
 */
const TYPE_PREFIX = "com.yourname.ytfinder"; // ← 務必改成你自己

/**
 * =========================
 * Widget CSP（UI 層用）
 * =========================
 */
const WIDGET_CSP = {
  connect_domains: ["https://www.googleapis.com"],
  resource_domains: ["https://i.ytimg.com"],
  frame_domains: []
};

/**
 * =========================
 * Utils
 * =========================
 */
function loadUI(relPath) {
  const url = new URL(relPath, import.meta.url);
  return readFileSync(url, "utf8");
}

function widgetTypeFor(suffix) {
  // ✅ 只用 a-z 0-9 . -（避免 :，審核器會當無效）
  return `${TYPE_PREFIX}.${suffix}`;
}

/**
 * =========================
 * Resource Descriptor（resources/list 用）
 * 👉 審核器「小工具類型」主要睇呢度
 * =========================
 */
function makeDescriptor(suffix, title, description) {
  const widgetType = widgetTypeFor(suffix);

  return {
    title,
    description,
    mimeType: SKYBRIDGE_MIME,
    _meta: {
      "openai/widgetType": widgetType,
      "openai/widgetId": widgetType,
      "openai/widgetCSP": WIDGET_CSP,
      "openai/widgetDescription": description,
      "openai/widgetPrefersBorder": true
    }
  };
}

/**
 * =========================
 * Resource Content（resources/read 用）
 * =========================
 */
function makeContent(uri, html, suffix, description) {
  const widgetType = widgetTypeFor(suffix);

  return {
    uri,
    type: "text",
    mimeType: SKYBRIDGE_MIME,
    text: html,
    _meta: {
      "openai/widgetType": widgetType,
      "openai/widgetId": widgetType,
      "openai/widgetCSP": WIDGET_CSP,
      "openai/widgetDescription": description,
      "openai/widgetPrefersBorder": true
    }
  };
}

/**
 * =========================
 * Register all UI resources
 * =========================
 */
export function registerResources(mcp) {
  // UI HTML files（repo root）
  const UI_HOME_HTML   = loadUI("./ui-index.html");
  const UI_SEARCH_HTML = loadUI("./ui-search.html");
  const UI_VIDEOS_HTML = loadUI("./ui-videos.html");

  // ---- Home ----
  mcp.registerResource(
    "youtube-finder-home",
    HOME_URI,
    makeDescriptor("home", "YouTube Finder Home", "Home screen for YouTube Finder."),
    async () => ({
      contents: [
        makeContent(
          HOME_URI,
          UI_HOME_HTML,
          "home",
          "Home screen for YouTube Finder."
        )
      ]
    })
  );

  // ---- Search ----
  mcp.registerResource(
    "youtube-finder-search",
    SEARCH_URI,
    makeDescriptor("search", "YouTube Finder Search", "Search videos by title keyword."),
    async () => ({
      contents: [
        makeContent(
          SEARCH_URI,
          UI_SEARCH_HTML,
          "search",
          "Search videos by title keyword."
        )
      ]
    })
  );

  // ---- Videos ----
  mcp.registerResource(
    "youtube-finder-videos",
    VIDEOS_URI,
    makeDescriptor("videos", "YouTube Finder Videos", "List latest channel videos."),
    async () => ({
      contents: [
        makeContent(
          VIDEOS_URI,
          UI_VIDEOS_HTML,
          "videos",
          "List latest channel videos."
        )
      ]
    })
  );
}
