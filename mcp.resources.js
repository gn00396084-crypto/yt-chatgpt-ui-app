import { readFileSync } from "node:fs";

// Multi-page URIs
export const HOME_URI = "ui://page/index.html";
export const VIDEOS_URI = "ui://page/videos.html";
export const SEARCH_URI = "ui://page/search.html";

const SKYBRIDGE_MIME = "text/html+skybridge";

// ✅ 唯一小工具類型（三頁要一致）
const WIDGET_TYPE = "yt-chatgpt-ui-app";

// ✅ 小工具 CSP（白名單）
// 你 UI 主要係 callTool，通常唔需要 UI 自己 fetch 外網。
// 但保險起見：若你頁面會載入 YouTube 縮圖 / 或任何 https 資源，可保留 https: / i.ytimg.com
const WIDGET_CSP = {
  // UI 若完全唔 fetch 外網，可以用 []
  // connect_domains: [],
  // resource_domains: [],
  // frame_domains: [],

  // 保險版：允許 https 連線（包含你 Worker / Google APIs）
  connect_domains: ["https://www.googleapis.com"],

  // 若你顯示縮圖（i.ytimg.com）就保留；冇用到可刪
  resource_domains: ["https://i.ytimg.com"],

  // 冇 iframe 就留空
  frame_domains: []
};

function loadUI(relPath) {
  const url = new URL(relPath, import.meta.url);
  return readFileSync(url, "utf8");
}

function makeUiContent(uri, html) {
  return {
    uri,
    mimeType: SKYBRIDGE_MIME,
    text: html,

    // ✅ 這裡才是 validator 真正在找的「小工具 CSP / 類型」
    _meta: {
      "openai/widgetCSP": WIDGET_CSP,

      // 有些審核會要求「唯一類型」，用這個補足（三頁一致）
      "openai/widgetType": WIDGET_TYPE,

      // 可選：有些環境會用到（無害）
      "openai/widgetId": WIDGET_TYPE
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
      contents: [makeUiContent(HOME_URI, UI_HOME_HTML)]
    })
  );

  mcp.registerResource(
    "youtube-finder-videos",
    VIDEOS_URI,
    { title: "YouTube Finder Videos" },
    async () => ({
      contents: [makeUiContent(VIDEOS_URI, UI_VIDEOS_HTML)]
    })
  );

  mcp.registerResource(
    "youtube-finder-search",
    SEARCH_URI,
    { title: "YouTube Finder Search" },
    async () => ({
      contents: [makeUiContent(SEARCH_URI, UI_SEARCH_HTML)]
    })
  );
}
