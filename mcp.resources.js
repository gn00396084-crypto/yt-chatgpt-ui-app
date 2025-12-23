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
 * Widget meta (CSP + Type)
 * =========================
 */
const SKYBRIDGE_MIME = "text/html+skybridge";
const TYPE_PREFIX = "io.github.gn00396084-crypto.ytfinder";

const WIDGET_CSP = {
  connect_domains: ["https://www.googleapis.com"],
  resource_domains: ["https://i.ytimg.com"],
  frame_domains: []
};

function loadUI(relPath) {
  const url = new URL(relPath, import.meta.url);
  return readFileSync(url, "utf8");
}

function makeUiContent(uri, html, pageKey, description) {
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

export function registerResources(mcp) {
  // HTML files (same folder as this file)
  const UI_HOME_HTML   = loadUI("./ui-index.html");
  const UI_SEARCH_HTML = loadUI("./ui-search.html");
  const UI_VIDEOS_HTML = loadUI("./ui-videos.html");

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
