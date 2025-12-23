// mcp.resources.js (FINAL)

// ✅ One place to set your globally-unique app id / namespace
// Use reverse-domain style. Example based on your GitHub account:
const APP_ID = "io.github.gn00396084-crypto.ytfinder";

// ✅ UI Widget URIs (MUST be ui://widget/*)
export const HOME_URI = "ui://widget/youtube-finder-home.html";
export const SEARCH_URI = "ui://widget/youtube-finder-search.html";
export const VIDEOS_URI = "ui://widget/youtube-finder-videos.html";

import { readFileSync } from "node:fs";

const SKYBRIDGE_MIME = "text/html+skybridge";

// ✅ Required by Apps SDK UI resource metadata
// Put ONLY what you really need.
// - connect_domains: allow fetch/XHR to these domains (widget-side)
// - resource_domains: allow loading images/scripts/css from these domains
// - frame_domains: allow embedding iframes from these domains (usually empty)
const WIDGET_CSP = {
  connect_domains: [
    // add your own API domain here ONLY if the widget fetches directly from it
    "https://www.googleapis.com",
    "https://chatgpt.com"
  ],
  resource_domains: [
    "https://i.ytimg.com"
  ],
  frame_domains: []
};

// ✅ Official examples include widgetDomain; missing it often triggers the “CSP not set” warning.
// Use chatgpt.com unless you were told otherwise by docs/tooling.
const WIDGET_DOMAIN = "https://chatgpt.com";

function loadUI(relPath) {
  const url = new URL(relPath, import.meta.url);
  return readFileSync(url, "utf8");
}

/**
 * Build ONE skybridge HTML resource content entry
 * NOTE: the important part is contents[0]._meta
 */
function makeUiContent({ uri, html, pageKey, description }) {
  // You can keep per-page “type/id” for debugging; MUST stay stable.
  const widgetType = `${APP_ID}.${pageKey}`;
  const widgetId = `${APP_ID}.${pageKey}`;

  return {
    uri,
    type: "text",
    mimeType: SKYBRIDGE_MIME,
    text: html,
    _meta: {
      "openai/widgetPrefersBorder": true,
      "openai/widgetDescription": description,

      // ✅ These two are the key ones for the red warning
      "openai/widgetDomain": WIDGET_DOMAIN,
      "openai/widgetCSP": WIDGET_CSP,

      // (Optional / safe) keep if your inspector uses them
      "openai/widgetType": widgetType,
      "openai/widgetId": widgetId
    }
  };
}

/**
 * Resource metadata (3rd arg) — keep mimeType here too.
 * Some tooling reads meta here, some reads from contents[0]._meta; we set both.
 */
function makeResourceMeta({ title, description, pageKey }) {
  return {
    title,
    mimeType: SKYBRIDGE_MIME,
    description,
    _meta: {
      "openai/widgetPrefersBorder": true,
      "openai/widgetDescription": description,
      "openai/widgetDomain": WIDGET_DOMAIN,
      "openai/widgetCSP": WIDGET_CSP,

      // optional
      "openai/widgetType": `${APP_ID}.${pageKey}`,
      "openai/widgetId": `${APP_ID}.${pageKey}`
    }
  };
}

export function registerResources(mcp) {
  // files are in repo root (adjust paths if yours differ)
  const UI_HOME_HTML = loadUI("./ui-index.html");
  const UI_SEARCH_HTML = loadUI("./ui-search.html");
  const UI_VIDEOS_HTML = loadUI("./ui-videos.html");

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
