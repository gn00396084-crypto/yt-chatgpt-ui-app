// mcp.resources.js — SINGLE WIDGET

import { readFileSync } from "node:fs";

/** ====== Unique App ID ====== */
export const APP_ID = "io.github.gn00396084-crypto.ytfinder";

/** ====== Single UI Widget URI ====== */
export const WIDGET_URI = "ui://widget/youtube-finder.html";

/** ====== Skybridge mime ====== */
export const SKYBRIDGE_MIME = "text/html+skybridge";

/** ====== Widget CSP ====== */
function buildWidgetCsp() {
  const connect = [];
  const base = process.env.CF_WORKER_BASE_URL;

  if (base) {
    try {
      connect.push(new URL(base).origin);
    } catch {
      // ignore
    }
  }

  return {
    // widget 內 fetch 允許（如果你 UI 只用 callTool，其實可以留空）
    connect_domains: connect,

    // 縮圖域名白名單
    resource_domains: ["https://i.ytimg.com", "https://img.youtube.com"],

    // 不用 iframe 就留空（避免審核變嚴）
    frame_domains: [],

    // openExternal to YouTube（可選）
    redirect_domains: ["https://www.youtube.com", "https://youtu.be"]
  };
}

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
    description: "Browse & search YouTube videos with thumbnails, descriptions and tags.",
    mimeType: SKYBRIDGE_MIME,
    _meta: {
      "openai/widgetCSP": buildWidgetCsp(),
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
