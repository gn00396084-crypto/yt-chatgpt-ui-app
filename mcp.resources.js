import { readFileSync } from "node:fs";

// ✅ Widget URIs
export const HOME_URI = "ui://widget/youtube-finder-home.html";
export const VIDEOS_URI = "ui://widget/youtube-finder-videos.html";
export const SEARCH_URI = "ui://widget/youtube-finder-search.html";

const SKYBRIDGE_MIME = "text/html+skybridge";

// ✅ 每個 widget 要「唯一」type/id（關鍵）
const WIDGET_BASE = "yt-chatgpt-ui-app";

// ✅ Widget CSP
const WIDGET_CSP = {
  connect_domains: ["https://www.googleapis.com"],
  resource_domains: ["https://i.ytimg.com"],
  frame_domains: []
};

function loadUI(relPath) {
  const url = new URL(relPath, import.meta.url);
  return readFileSync(url, "utf8");
}

function makeUiContent(uri, html, suffix, description) {
  const widgetType = `${WIDGET_BASE}:${suffix}`; // ✅ 每頁唯一
  const widgetId = `${WIDGET_BASE}:${suffix}`;   // ✅ 每頁唯一

  return {
    uri,

    // ✅ 建議加返：某些審核器/版本需要
    type: "text",

    // ✅ 仍然保留 skybridge mimeType
    mimeType: SKYBRIDGE_MIME,
    text: html,

    _meta: {
      "openai/widgetCSP": WIDGET_CSP,

      // ✅ 這兩個通常就係審核器講嘅「小工具類型」同「唯一類型」
      "openai/widgetType": widgetType,
      "openai/widgetId": widgetId,

      // ✅ 可選
      "openai/widgetDescription": description,
      "openai/widgetPrefersBorder": true
    }
  };
}

export function registerResources(mcp) {
  // files are in repo root
  const UI_HOME_HTML = loadUI("./ui-index.html");
  const UI_VIDEOS_HTML = loadUI("./ui-videos.html");
  const UI_SEARCH_HTML = loadUI("./ui-search.html");

  mcp.registerResource(
    "youtube-finder-home",
    HOME_URI,
    { title: "YouTube Finder Home" },
    async () => ({
      contents: [
        makeUiContent(HOME_URI, UI_HOME_HTML, "home", "Home screen for YouTube Finder.")
      ]
    })
  );

  mcp.registerResource(
    "youtube-finder-videos",
    VIDEOS_URI,
    { title: "YouTube Finder Videos" },
    async () => ({
      contents: [
        makeUiContent(VIDEOS_URI, UI_VIDEOS_HTML, "videos", "List latest channel videos.")
      ]
    })
  );

  mcp.registerResource(
    "youtube-finder-search",
    SEARCH_URI,
    { title: "YouTube Finder Search" },
    async () => ({
      contents: [
        makeUiContent(SEARCH_URI, UI_SEARCH_HTML, "search", "Search videos by title keyword.")
      ]
    })
  );
}
