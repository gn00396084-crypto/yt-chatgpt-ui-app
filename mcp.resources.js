// mcp.resources.js
import { readFileSync } from "node:fs";

export const APP_ID = "io.github.gn00396084-crypto.ytfinder";
export const WIDGET_URI = "ui://widget/youtube-finder.html";
export const SKYBRIDGE_MIME = "text/html+skybridge";

function originFrom(value) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    // e.g. Railway provides RAILWAY_PUBLIC_DOMAIN like "xxxx.up.railway.app" (no scheme)
    try {
      return new URL(`https://${value}`).origin;
    } catch {
      return null;
    }
  }
}

function computeWidgetDomain() {
  // 部署到 Railway/GitHub 時，優先用：
  // 1) WIDGET_DOMAIN 或 PUBLIC_BASE_URL（你自己設定的正式 https 網址）
  // 2) Railway 系統變數 RAILWAY_PUBLIC_DOMAIN（自帶的 *.up.railway.app 網域）
  // 最後才 fallback localhost（只給本機測試用）
  return (
    originFrom(process.env.WIDGET_DOMAIN) ||
    originFrom(process.env.PUBLIC_BASE_URL) ||
    originFrom(process.env.RAILWAY_PUBLIC_DOMAIN) ||
    originFrom(process.env.RAILWAY_STATIC_URL) ||
    "http://localhost:3000"
  );
}

export const WIDGET_DOMAIN = computeWidgetDomain();

function buildWidgetCsp() {
  const connect = [];
  const base = process.env.CF_WORKER_BASE_URL;
  if (base) {
    const o = originFrom(base);
    if (o) connect.push(o);
  }

  return {
    connect_domains: connect,
    // 縮圖/頭像常見域名（YouTube）
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
