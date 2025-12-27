// mcp.resources.js — SINGLE WIDGET (Apps SDK CSP fixed)

import { readFileSync } from "node:fs";

/** ====== Unique App ID ====== */
export const APP_ID = "io.github.gn00396084-crypto.ytfinder";

/** ====== Single UI Widget URI ====== */
export const WIDGET_URI = "ui://widget/youtube-finder.html";

/** ====== Skybridge mime ====== */
export const SKYBRIDGE_MIME = "text/html+skybridge";

/** ====== Widget CSP allowlists ======
 * connect_domains: widget 內 fetch/XHR 可連嘅 API origins（唔加就會被擋）:contentReference[oaicite:2]{index=2}
 * resource_domains: 圖片/字體/腳本等靜態資源 origins
 * frame_domains: 如要 iframe 才需要（唔建議，審核更嚴）:contentReference[oaicite:3]{index=3}
 * redirect_domains: openExternal 目的地白名單（可選）
 */
function buildWidgetCsp() {
  const connect = [];
  const resource = [
    "https://i.ytimg.com", // YouTube thumbnails
    "https://img.youtube.com" // optional fallback
  ];

  // If your widget directly fetches your CF Worker index, whitelist it here.
  const base = process.env.CF_WORKER_BASE_URL;
  if (base) {
    try {
      connect.push(new URL(base).origin);
    } catch {
      // ignore invalid env
    }
  }

  return {
    connect_domains: connect,
    resource_domains: resource,
    frame_domains: [],
    // Optional: allow openExternal to YouTube without extra safe-link friction
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
      // 建議：唔好硬塞 widgetDomain，讓它用預設 sandbox :contentReference[oaicite:4]{index=4}
      // "openai/widgetDomain": "https://chatgpt.com",
      "openai/widgetType": widgetType,
      "openai/widgetId": widgetId,
      "openai/widgetPrefersBorder": true,
      // 可選：減少模型重複講 UI 內容
      "openai/widgetDescription": "Search and browse channel videos with titles, thumbnails, descriptions and tags."
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
