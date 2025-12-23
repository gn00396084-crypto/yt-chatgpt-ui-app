import { readFileSync } from "node:fs";

// ✅ Use widget URIs (required by submission validator)
export const HOME_URI = "ui://widget/youtube-finder-home.html";
export const SEARCH_URI = "ui://widget/youtube-finder-search.html";
export const VIDEOS_URI = "ui://widget/youtube-finder-videos.html";

const SKYBRIDGE_MIME = "text/html+skybridge";

const WIDGET_CSP = {
  connect_domains: ["https://www.googleapis.com"],
  resource_domains: ["https://i.ytimg.com"],
  frame_domains: []
};

function loadUI(relPath) {
  const url = new URL(relPath, import.meta.url);
  return readFileSync(url, "utf8");
}

function makeUiContent(uri, html, description) {
  return {
    uri,
    mimeType: SKYBRIDGE_MIME,
    text: html,
    _meta: {
      // ✅ Required by Apps SDK
      "openai/widgetCSP": WIDGET_CSP,

      // ✅ Optional but recommended (helps review + model narration)
      "openai/widgetDescription": description,
      "openai/widgetPrefersBorder": true
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
      contents: [makeUiContent(HOME_URI, UI_HOME_HTML, "Home screen for YouTube Finder.")]
    })
  );

  mcp.registerResource(
    "youtube-finder-search",
    SEARCH_URI,
    { title: "YouTube Finder Search" },
    async () => ({
      contents: [makeUiContent(SEARCH_URI, UI_SEARCH_HTML, "Search videos by title keyword.")]
    })
  );

  mcp.registerResource(
    "youtube-finder-videos",
    VIDEOS_URI,
    { title: "YouTube Finder Videos" },
    async () => ({
      contents: [makeUiContent(VIDEOS_URI, UI_VIDEOS_HTML, "List latest channel videos.")]
    })
  );
}
