import { readFileSync } from "node:fs";

// Multi-page URIs
export const HOME_URI = "ui://page/index.html";
export const VIDEOS_URI = "ui://page/videos.html";
export const SEARCH_URI = "ui://page/search.html";

const SKYBRIDGE_MIME = "text/html+skybridge";

// ✅ 基底 ID（同一個 app）+ 每頁 suffix（做到“唯一”）
const WIDGET_BASE = "yt-chatgpt-ui-app";

const WIDGET_CSP = {
  connect_domains: ["https://www.googleapis.com"],
  resource_domains: ["https://i.ytimg.com"],
  frame_domains: []
};

function loadUI(relPath) {
  const url = new URL(relPath, import.meta.url);
  return readFileSync(url, "utf8");
}

function makeUiContent(uri, html, pageSuffix) {
  const widgetType = `${WIDGET_BASE}:${pageSuffix}`; // ✅ 每頁唯一
  const widgetId = `${WIDGET_BASE}:${pageSuffix}`;   // ✅ 每頁唯一

  return {
    uri,
    mimeType: SKYBRIDGE_MIME,
    text: html,
    _meta: {
      "openai/widgetCSP": WIDGET_CSP,
      "openai/widgetType": widgetType,
      "openai/widgetId": widgetId
    }
  };
}

export function registerResources(mcp) {
  const UI_HOME_HTML = loadUI("./ui-index.html");
  const UI_VIDEOS_HTML = loadUI("./ui-videos.html");
  const UI_SEARCH_HTML = loadUI("./ui-search.html");

  mcp.registerResource(
    "youtube-finder-home",
    HOME_URI,
    { title: "YouTube Finder Home" },
    async () => ({
      contents: [makeUiContent(HOME_URI, UI_HOME_HTML, "home")]
    })
  );

  mcp.registerResource(
    "youtube-finder-videos",
    VIDEOS_URI,
    { title: "YouTube Finder Videos" },
    async () => ({
      contents: [makeUiContent(VIDEOS_URI, UI_VIDEOS_HTML, "videos")]
    })
  );

  mcp.registerResource(
    "youtube-finder-search",
    SEARCH_URI,
    { title: "YouTube Finder Search" },
    async () => ({
      contents: [makeUiContent(SEARCH_URI, UI_SEARCH_HTML, "search")]
    })
  );
}
