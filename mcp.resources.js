import { readFileSync } from "node:fs";

// Multi-page URIs
export const HOME_URI = "ui://page/index.html";
export const VIDEOS_URI = "ui://page/videos.html";
export const SEARCH_URI = "ui://page/search.html";

function loadUI(relPath) {
  const url = new URL(relPath, import.meta.url);
  return readFileSync(url, "utf8");
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
        {
          uri: HOME_URI,
          type: "text",
          mimeType: "text/html+skybridge",
          text: UI_HOME_HTML
        }
      ]
    })
  );

  mcp.registerResource(
    "youtube-finder-videos",
    VIDEOS_URI,
    { title: "YouTube Finder Videos" },
    async () => ({
      contents: [
        {
          uri: VIDEOS_URI,
          type: "text",
          mimeType: "text/html+skybridge",
          text: UI_VIDEOS_HTML
        }
      ]
    })
  );

  mcp.registerResource(
    "youtube-finder-search",
    SEARCH_URI,
    { title: "YouTube Finder Search" },
    async () => ({
      contents: [
        {
          uri: SEARCH_URI,
          type: "text",
          mimeType: "text/html+skybridge",
          text: UI_SEARCH_HTML
        }
      ]
    })
  );
}
