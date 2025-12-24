// index.js — FINAL (stale-while-revalidate, no more refresh timeout UI)
// Env required:
//   CF_WORKER_BASE_URL = https://xxx.workers.dev
// Optional:
//   SITE_BASE_URL = https://yourdomain.com

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT || 3000);
const CF_WORKER_BASE_URL = process.env.CF_WORKER_BASE_URL;
if (!CF_WORKER_BASE_URL) {
  console.error("Missing CF_WORKER_BASE_URL env, e.g. https://xxx.workers.dev");
  process.exit(1);
}

const SITE_BASE_URL = process.env.SITE_BASE_URL || "";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ---------------- Security headers ---------------- */
function withSecurityHeaders(res, contentType = "text/html; charset=utf-8") {
  res.setHeader("Content-Type", contentType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");

  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "img-src 'self' data: https:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline'",
    "connect-src 'self' https:",
  ].join("; ");
  res.setHeader("Content-Security-Policy", csp);
}

function sendJson(res, status, data) {
  res.statusCode = status;
  withSecurityHeaders(res, "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function sendText(res, status, text) {
  res.statusCode = status;
  withSecurityHeaders(res, "text/plain; charset=utf-8");
  res.end(text);
}

async function sendFile(res, status, filename, contentType = "text/html; charset=utf-8") {
  const p = path.join(__dirname, filename);
  const buf = await readFile(p);
  res.statusCode = status;
  withSecurityHeaders(res, contentType);
  res.end(buf);
}

/* ---------------- Helpers ---------------- */
function normalizeText(s) {
  return String(s || "").toLowerCase().trim();
}

function extractVideoId(input) {
  if (!input) return "";
  const s = String(input).trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;

  try {
    const u = new URL(s);
    const v = u.searchParams.get("v");
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;

    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.replace("/", "");
      if (/^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
    }

    const m = u.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
  } catch {}

  const m2 = s.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (m2) return m2[1];

  return "";
}

function pickVideoFields(v) {
  const rawId = v.videoId || v.id?.videoId || v.id || v.url || v.link;
  const videoId = extractVideoId(rawId);

  const title = v.title || v.snippet?.title || "";
  const channelTitle = v.channelTitle || v.snippet?.channelTitle || "";
  const publishedAt = v.publishedAt || v.snippet?.publishedAt || "";

  const thumbnailUrl =
    v.thumbnailUrl ||
    v.thumbnails?.medium?.url ||
    v.snippet?.thumbnails?.medium?.url ||
    v.snippet?.thumbnails?.high?.url ||
    (videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : "");

  return { videoId, title, channelTitle, publishedAt, thumbnailUrl };
}

/* ---------------- Worker fetch with shorter timeout ---------------- */
async function fetchWorkerJson(workerPath, timeoutMs = 3000) {
  const url = new URL(workerPath, CF_WORKER_BASE_URL).toString();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const text = await r.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    return { ok: r.ok, status: r.status, json };
  } catch (e) {
    return { ok: false, status: 504, json: { error: "timeout", detail: String(e) } };
  } finally {
    clearTimeout(t);
  }
}

/* ---------------- Stale-while-revalidate cache ---------------- */
let videosCache = { items: [], ts: 0 };
let refreshing = false;
const SOFT_TTL_MS = 60_000;   // after this, we will start background refresh
const HARD_TTL_MS = 24 * 60 * 60 * 1000; // keep stale up to 24h (so UI never blanks)

/**
 * Background refresh (never blocks UI)
 */
async function refreshVideosInBackground() {
  if (refreshing) return;
  refreshing = true;
  try {
    const { ok, status, json } = await fetchWorkerJson("/my-channel/videos", 5000);
    if (!ok) return;

    const items = (json.items || json.videos || [])
      .map(pickVideoFields)
      .filter((x) => x.videoId);

    if (items.length) {
      videosCache = { items, ts: Date.now() };
    }
  } finally {
    refreshing = false;
  }
}

/**
 * Always returns quickly.
 * - If we have any cache (even stale) -> return it immediately (200)
 * - If cache empty -> try worker once (max 3s); if fail -> return 200 with empty list but includes error meta
 */
async function getVideosSWR() {
  const now = Date.now();
  const hasCache = videosCache.items.length > 0;
  const cacheAge = hasCache ? (now - videosCache.ts) : null;

  // If cache exists, return immediately (even if stale)
  if (hasCache) {
    // trigger background refresh when cache is old
    if (cacheAge > SOFT_TTL_MS && cacheAge < HARD_TTL_MS) {
      refreshVideosInBackground();
    }
    return {
      status: 200,
      items: videosCache.items,
      meta: { cached: true, stale: cacheAge > SOFT_TTL_MS, cacheAgeSec: Math.floor(cacheAge / 1000) },
    };
  }

  // No cache yet -> do one short worker attempt
  const { ok, status, json } = await fetchWorkerJson("/my-channel/videos", 3000);
  if (ok) {
    const items = (json.items || json.videos || [])
      .map(pickVideoFields)
      .filter((x) => x.videoId);
    videosCache = { items, ts: now };
    return { status: 200, items, meta: { cached: false, stale: false, cacheAgeSec: 0 } };
  }

  // Still return 200 so UI won't show "Request timeout" as an error page
  return {
    status: 200,
    items: [],
    meta: { cached: false, stale: true, cacheAgeSec: null, workerStatus: status, workerError: json },
  };
}

/* ---------------- MCP (text-only, uses SWR) ---------------- */
const mcp = new McpServer({ name: "yt-ui-mcp", version: "1.0.0" });

mcp.tool("latest_video", {}, async () => {
  const r = await getVideosSWR();
  const items = r.items || [];
  if (!items.length) {
    return {
      content: [
        {
          type: "text",
          text:
            `暫時無法取得清單（上游可能 timeout）。\n` +
            `請開啟網站查看：${SITE_BASE_URL ? SITE_BASE_URL + "/ui/videos" : "/ui/videos"}`,
        },
      ],
    };
  }

  const v = items[0];
  const base = SITE_BASE_URL || "";
  const playLink = `${base}/ui/videos?play=${encodeURIComponent(v.videoId)}`;
  const yt = `https://youtu.be/${v.videoId}`;
  const staleNote = r.meta?.stale ? `\n\n⚠️ 目前顯示的是快取資料（cacheAge ${r.meta.cacheAgeSec}s），上游正在更新/可能 timeout。` : "";

  return {
    content: [
      {
        type: "text",
        text:
          `🎵 最新一首（最近成功抓取）\n\n` +
          `${v.title}\n` +
          `上架：${(v.publishedAt || "").slice(0, 10) || "unknown"}\n\n` +
          `▶️ 本站播放（含縮圖）：\n${playLink}\n\n` +
          `YouTube：\n${yt}` +
          staleNote,
      },
    ],
  };
});

mcp.tool("search_videos", { q: z.string() }, async ({ q }) => {
  const r = await getVideosSWR();
  const query = normalizeText(q);
  const hits = (r.items || [])
    .filter((v) => normalizeText(`${v.title} ${v.channelTitle}`).includes(query))
    .slice(0, 20);

  const base = SITE_BASE_URL || "";
  if (!hits.length) {
    return { content: [{ type: "text", text: "沒有找到相關影片。" }] };
  }

  const lines = hits.map((v, i) => {
    const play = `${base}/ui/videos?play=${encodeURIComponent(v.videoId)}`;
    return `${i + 1}. ${v.title}\n   ▶️ ${play}`;
  });

  return { content: [{ type: "text", text: lines.join("\n\n") }] };
});

const transport = new StreamableHTTPServerTransport({ server: mcp });

/* ---------------- HTTP server ---------------- */
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    if (pathname === "/mcp") {
      return transport.handleRequest(req, res);
    }

    if (pathname === "/") {
      res.statusCode = 302;
      res.setHeader("Location", "/ui/videos");
      withSecurityHeaders(res, "text/plain; charset=utf-8");
      return res.end("Redirecting…");
    }

    if (pathname === "/ui/videos") return await sendFile(res, 200, "ui-videos.html");
    if (pathname === "/ui/search") return await sendFile(res, 200, "ui-search.html");

    if (pathname === "/api/videos") {
      const r = await getVideosSWR();
      // always 200
      return sendJson(res, 200, { items: r.items, meta: r.meta });
    }

    if (pathname === "/api/search") {
      const q = url.searchParams.get("q") || "";
      const r = await getVideosSWR();
      const query = normalizeText(q);
      const filtered = !query
        ? []
        : (r.items || []).filter((v) => normalizeText(`${v.title} ${v.channelTitle}`).includes(query));
      return sendJson(res, 200, { items: filtered.slice(0, 100), q, meta: r.meta });
    }

    if (pathname === "/health") {
      return sendJson(res, 200, {
        ok: true,
        service: "yt-ui-mcp",
        cacheItems: videosCache.items.length,
        cacheAgeSec: videosCache.ts ? Math.floor((Date.now() - videosCache.ts) / 1000) : null,
        refreshing,
      });
    }

    return sendText(res, 404, "Not Found");
  } catch (err) {
    console.error(err);
    return sendText(res, 500, `Internal Error: ${String(err?.message || err)}`);
  }
});

// warm cache once at boot (non-blocking)
refreshVideosInBackground();

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`UI: /ui/videos`);
  console.log(`API: /api/videos , /api/search?q=...`);
});
