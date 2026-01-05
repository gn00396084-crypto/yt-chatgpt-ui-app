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
    try {
      return new URL(`https://${value}`).origin;
    } catch {
      return null;
    }
  }
}

function computeWidgetDomain() {
  return (
    originFrom(process.env.WIDGET_DOMAIN) ||
    originFrom(process.env.PUBLIC_BASE_URL) ||
    originFrom(process.env.RAILWAY_PUBLIC_DOMAIN) ||
    originFrom(process.env.RAILWAY_STATIC_URL) ||
    "http://localhost:3000"
  );
}

export const WIDGET_DOMAIN = computeWidgetDomain();

// ✅ 外部資源（css/js）真正所在的網域
function computeAssetOrigin() {
  return (
    originFrom(process.env.ASSET_BASE_URL) ||          // ✅ 你要設呢個
    originFrom(process.env.PUBLIC_BASE_URL) ||
    originFrom(process.env.RAILWAY_PUBLIC_DOMAIN) ||
    originFrom(process.env.RAILWAY_STATIC_URL) ||
    null
  );
}

export const ASSET_ORIGIN = computeAssetOrigin();

// ✅ 把 HTML 相對路徑改為絕對 URL，避免指向 sandbox origin
function rewriteHtmlAssets(html, assetOrigin) {
  if (!assetOrigin) return html;

  const cssAbs = `${assetOrigin}/styles.css`;
  const jsAbs = `${assetOrigin}/app.js`;

  return html
    // <link href="./styles.css"> / <link href="styles.css"> / <link href="/styles.css">
    .replace(/href=(["'])(\.\/)?styles\.css\1/gi, `href="${cssAbs}"`)
    .replace(/href=(["'])\/styles\.css\1/gi, `href="${cssAbs}"`)
    // <script src="./app.js"> / <script src="app.js"> / <script src="/app.js">
    .replace(/src=(["'])(\.\/)?app\.js\1/gi, `src="${jsAbs}"`)
    .replace(/src=(["'])\/app\.js\1/gi, `src="${jsAbs}"`);
}

function buildWidgetCsp(assetOrigin) {
  const connect = [];
  const base = process.env.CF_WORKER_BASE_URL;
  if (base) {
    const o = originFrom(base);
    if (o) connect.push(o);
  }

  const ao = originFrom(assetOrigin);
  // 如果你 widget 之後會 fetch 你自己 domain（可選），先加埋唔會錯
  if (ao) connect.push(ao);

  return {
    connect_domains: [...new Set(connect)],
    resource_domains: [
      // ✅ 必須加你 Railway origin，先可以載入 css/js
      ...(ao ? [ao] : []),

      // thumbnails
      "https://i.ytimg.com",
      "https://img.youtube.com",
      "https://yt3.ggpht.com",
    ],
    frame_domains: [],
    redirect_domains: ["https://www.youtube.com", "https://youtu.be"],
  };
}

const UI_FILE = "./ui-youtube-finder.html";

function loadUI(relPath) {
  const url = new URL(relPath, import.meta.url);
  return readFileSync(url, "utf8");
}

export function registerResources(mcp) {
  const rawHtml = loadUI(UI_FILE);

  // ✅ rewrite 之後再回傳
  const html = rewriteHtmlAssets(rawHtml, ASSET_ORIGIN);

  const widgetType = `${APP_ID}.main`;
  const widgetId = widgetType;

  const resourceMeta = {
    title: "YouTube Finder",
    description: "Browse & search YouTube videos with thumbnails and descriptions.",
    mimeType: SKYBRIDGE_MIME,
    _meta: {
      "openai/widgetCSP": buildWidgetCsp(ASSET_ORIGIN),
      // widgetDomain 可以留著，但唔好依賴佢去解決相對路徑
      "openai/widgetDomain": WIDGET_DOMAIN,
      "openai/widgetType": widgetType,
      "openai/widgetId": widgetId,
      "openai/widgetPrefersBorder": true,
    },
  };

  mcp.registerResource("youtube-finder", WIDGET_URI, resourceMeta, async () => ({
    contents: [
      {
        uri: WIDGET_URI,
        mimeType: SKYBRIDGE_MIME,
        text: html,
        _meta: resourceMeta._meta,
      },
    ],
  }));
}
