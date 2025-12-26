// mcp.resources.js — SINGLE WIDGET (no hidden-tool template binding issue)

import { readFileSync } from "node:fs";

/** ====== Unique App ID ====== */
export const APP_ID = "io.github.gn00396084-crypto.ytfinder";

/** ====== Single UI Widget URI ====== */
export const WIDGET_URI = "ui://widget/youtube-finder.html";

/** ====== Skybridge mime ====== */
export const SKYBRIDGE_MIME = "text/html+skybridge";

/** ====== Widget CSP / Domain ====== */
export const WIDGET_CSP = {
  connect_domains: [],
  resource_domains: ["https://i.ytimg.com"],
  frame_domains: []
};

export const WIDGET_DOMAIN = "https://chatgpt.com";

const UI_FILE = "./ui-youtube-finder.html";

function loadUI(relPath) {
  const url = new URL(relPath, import.meta.url);
  return readFileSync(url, "utf8");
}

export function registerResources(mcp) {
  const html = loadUI(UI_FILE);

  const widgetType = `${APP_ID}.main`;
  const widgetId = widgetType;

  const resourceMeta = {
    title: "YouTube Finder",
    description: "Browse & search YouTube videos in a single widget.",
    mimeType: SKYBRIDGE_MIME,
    _meta: {
      "openai/widgetCSP": WIDGET_CSP,
      "openai/widgetDomain": WIDGET_DOMAIN,
      "openai/widgetType": widgetType,
      "openai/widgetId": widgetId,
      "openai/widgetPrefersBorder": true
    }
  };

  mcp.registerResource(
    "youtube-finder",
    WIDGET_URI,
    resourceMeta,
    async () => ({
      contents: [
        {
          uri: WIDGET_URI,
          mimeType: SKYBRIDGE_MIME,
          text: html,
          _meta: resourceMeta._meta
        }
      ]
    })
  );
}
