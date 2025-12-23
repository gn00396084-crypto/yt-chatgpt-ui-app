import { readFileSync } from "node:fs";

// Multi-page URIs
export const HOME_URI = "ui://widget/youtube-finder-home.html";
export const VIDEOS_URI = "ui://widget/youtube-finder-videos.html";
export const SEARCH_URI = "ui://widget/youtube-finder-search.html";

const SKYBRIDGE_MIME = "text/html+skybridge";
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

function makeUiContent(uri, html, suffix, description) {
  const widgetType = `${WIDGET_BASE}:${suffix}`;
  const widgetId = `${WIDGET_BASE}:${suffix}`;

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
  // files are in repo root
  const UI_HOME_HTML = loadUI("./ui-index.html");
  const UI_VIDEOS_HTML = loadUI("./ui-videos.html");
  const UI_SEARCH_HTML = loadUI("./ui-search.html");

  // ✅ IMPORTANT: mimeType must be set in *resource metadata* (3rd arg)
  mcp.registerResource(
    "youtube-finder-home",
    HOME_URI,
    {
      title: "YouTube Finder Home",
      mimeType: SKYBRIDGE_MIME,
      description: "Home screen widget."
    },
    async () => ({
      contents: [makeUiContent(HOME_URI, UI_HOME_HTML, "home", "Home screen for YouTube Finder.")]
    })
  );

  mcp.registerResource(
    "youtube-finder-videos",
    VIDEOS_URI,
    {
      title: "YouTube Finder Videos",
      mimeType: SKYBRIDGE_MIME,
      description: "Latest videos list widget."
    },
    async () => ({
      contents: [makeUiContent(VIDEOS_URI, UI_VIDEOS_HTML, "videos", "List latest channel videos.")]
    })
  );

  mcp.registerResource(
    "youtube-finder-search",
    SEARCH_URI,
    {
      title: "YouTube Finder Search",
      mimeType: SKYBRIDGE_MIME,
      description: "Search widget."
    },
    async () => ({
      contents: [makeUiContent(SEARCH_URI, UI_SEARCH_HTML, "search", "Search videos by title keyword.")]
    })
  );
}
