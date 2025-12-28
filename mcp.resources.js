// mcp.resources.js
import { readFileSync } from "node:fs";

export const APP_ID = "io.github.gn00396084-crypto.ytfinder";
export const WIDGET_URI = "ui://widget/youtube-finder.html";
export const SKYBRIDGE_MIME = "text/html+skybridge";

function computeWidgetDomain() {
  // ✅ 用 env 控制，部署時設：WIDGET_DOMAIN=https://你的正式網域
  // 只取 origin，符合「唯一網域（origin only）」要求
  const raw = process.env.WIDGET_DOMAIN || process.env.PUBLIC_BASE_URL || "http://localhost:3000";
  try {
    return new URL(raw).origin;
  } catch {
    return "http://localhost:3000";
  }
}

export const WIDGET_DOMAIN = computeWidgetDomain();

function buildWidgetCsp() {
  const connect = [];
  const base = process.env.CF_WORKER_BASE_URL;
  if (base) {
    try {
      connect.push(new URL(base).origin);
    } catch {}
  }

  return {
    connect_domains: connect,
    // ✅ 放行常見縮圖/頭像域名
    resource_domains: [
      "https://i.ytimg.com",
      "https://img.youtube.com",
      "https://*.ytimg.com",
      "https://yt3.ggpht.com"
    ],
    frame_domains: [],
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
