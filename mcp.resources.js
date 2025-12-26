// mcp.resources.js — SINGLE WIDGET (official-style)

import { readFileSync } from "node:fs";

export const APP_ID = "io.github.gn00396084-crypto.ytfinder";
export const WIDGET_URI = "ui://widget/youtube-finder.html";
export const SKYBRIDGE_MIME = "text/html+skybridge";

// ✅ 最小放行：縮圖來源
export const WIDGET_CSP = {
  connect_domains: [],
  resource_domains: ["https://i.ytimg.com"],
  frame_domains: []
};

export const WIDGET_DOMAIN = "https://chatgpt.com";

function loadUI(relPath) {
  const url = new URL(relPath, import.meta.url);
  return readFileSync(url, "utf8");
}

export function registerResources(mcp) {
  const html = loadUI("./ui-youtube-finder.html");

  const widgetType = `${APP_ID}.main`;

  mcp.registerResource(
    "youtube-finder",
    WIDGET_URI,
    {
      title: "YouTube Finder",
      description: "Search & browse channel videos inside ChatGPT.",
      mimeType: SKYBRIDGE_MIME,
      _meta: {
        "openai/widgetCSP": WIDGET_CSP,
        "openai/widgetDomain": WIDGET_DOMAIN,
        "openai/widgetType": widgetType,
        "openai/widgetId": widgetType,
        "openai/widgetPrefersBorder": true
      }
    },
    async () => ({
      contents: [
        {
          uri: WIDGET_URI,
          mimeType: SKYBRIDGE_MIME,
          text: html,
          _meta: {
            "openai/widgetCSP": WIDGET_CSP,
            "openai/widgetDomain": WIDGET_DOMAIN,
            "openai/widgetType": widgetType,
            "openai/widgetId": widgetType,
            "openai/widgetPrefersBorder": true
          }
        }
      ]
    })
  );
}
