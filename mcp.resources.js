// mcp.resources.js — SINGLE WIDGET (CSP fixed)

import { readFileSync } from "node:fs";

/** ====== Unique App ID ====== */
export const APP_ID = "io.github.gn00396084-crypto.ytfinder";

/** ====== Single UI Widget URI ====== */
export const WIDGET_URI = "ui://widget/youtube-finder.html";

/** ====== Skybridge mime ====== */
export const SKYBRIDGE_MIME = "text/html+skybridge";

function buildWidgetCsp() {
  const connect = [];
  const base = process.env.CF_WORKER_BASE_URL;

  if (base) {
    try {
      connect.push(new URL(base).origin);
    } catch {
      // ignore invalid env
    }
  }

  return {
    // widget 內 fetch/XHR 可連的 API origins
    connect_domains: connect,

    // 縮圖域名（你已經有 i.ytimg.com，建議再加 img.youtube.com）
    resource_domains: ["https://i.ytimg.com", "https://img.youtube.com"],

    // 不用 iframe 就留空（避免審核變嚴）
    frame_domains: [],

    // 可選：openExternal 去 YouTube
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
    description: "Browse & search YouTube videos in a single widget.",
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
