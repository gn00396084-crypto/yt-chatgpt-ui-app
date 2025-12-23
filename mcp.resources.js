// mcp.resources.js
// 你原本已有：HOME_URI / SEARCH_URI / VIDEOS_URI
// 你原本已有：UI_HOME_HTML / UI_SEARCH_HTML / UI_VIDEOS_HTML（無論你係 inline 定 import）

export const TYPE_PREFIX = "io.github.gn00396084-crypto.ytfinder";

// ✅ 供 debug endpoint 用：列出所有 UI pages（runtime 應該只係呢 3 個）
export function debugListResources() {
  return [
    { key: "home",   uri: HOME_URI,   expectedType: `${TYPE_PREFIX}.home` },
    { key: "search", uri: SEARCH_URI, expectedType: `${TYPE_PREFIX}.search` },
    { key: "videos", uri: VIDEOS_URI, expectedType: `${TYPE_PREFIX}.videos` }
  ];
}

function pickHtml(key) {
  if (key === "home") return UI_HOME_HTML;
  if (key === "search") return UI_SEARCH_HTML;
  if (key === "videos") return UI_VIDEOS_HTML;
  return null;
}

// ✅ 解析 HTML：抽出 app:type / data-widget-type / script type
export function debugInspectHtml(key) {
  const html = pickHtml(key);
  if (!html) return { error: `unknown page key: ${key}` };

  const appType =
    /<meta\s+name=["']app:type["']\s+content=["']([^"']+)["']\s*\/?>/i.exec(html)?.[1] ?? null;

  const bodyType =
    /<body[^>]*\sdata-widget-type=["']([^"']+)["'][^>]*>/i.exec(html)?.[1] ?? null;

  const scriptTypes = [...html.matchAll(/<script\b[^>]*\stype=["']([^"']+)["'][^>]*>/gi)]
    .map(m => m[1]);

  const hasModuleScript = scriptTypes.includes("module");

  return {
    key,
    appType,
    bodyType,
    scriptTypes,
    hasModuleScript,
    // 方便你肉眼比對
    expectedType: `${TYPE_PREFIX}.${key}`
  };
}
