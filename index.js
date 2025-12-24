// index.js — FINAL (ChatGPT Apps MCP connect-ready + SWR cache)
// Env required:
//   CF_WORKER_BASE_URL = https://xxx.workers.dev
// Optional (HIGHLY recommended for correct links in ChatGPT):
//   SITE_BASE_URL = https://your-domain.com

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT || 3000);
const CF_WORKER_BASE_URL = process.env.CF_WORKER_BASE_URL;
const SITE_BASE_URL = (process.env.SITE_BASE_URL || "").replace(/\/$/, "");

if (!CF_WORKER_BASE_URL) {
  console.error("Missing CF_WORKER_BASE_URL env, e.g. https://xxx.workers.dev");
  process.exit(1);
}

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

  // NOTE: CSP is for browsers. ChatGPT's server-to-server MCP calls are not affected by CSP.
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

/* ---------------- Worker fetch (short timeout) ---------------- */
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

/* ---------------- SWR cache for /api/videos (never blocks UI) ---------------- */
let videosCache = { items: [], ts: 0 };
let refreshing = false;
const SOFT_TTL_MS = 60_000; // after 60s, trigger background refresh
const HARD_TTL_MS = 24 * 60 * 60 * 1000;

async function refreshVideosInBackground() {
  if (refreshing) return;
  refreshing = true;
  try {
    const { ok, json } = await fetchWorkerJson("/my-channel/videos", 5000);
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

async function getVideosSWR() {
  const now = Date.now();
  const hasCache = videosCache.items.length > 0;
  const cacheAge = hasCache ? now - videosCache.ts : null;

  if (hasCache) {
    if (cacheAge > SOFT_TTL_MS && cacheAge < HARD_TTL_MS) {
      refreshVideosInBackground(); // do not await
    }
    return {
      items: videosCache.items,
      meta: { cached: true, stale: cacheAge > SOFT_TTL_MS, cacheAgeSec: Math.floor(cacheAge / 1000) },
    };
  }

  // first time: try worker once, short timeout
  const { ok, status, json } = await fetchWorkerJson("/my-channel/videos", 3000);
  if (ok) {
    const items = (json.items || json.videos || [])
      .map(pickVideoFields)
      .filter((x) => x.videoId);
    videosCache = { items, ts: now };
    return { items, meta: { cached: false, stale: false, cacheAgeSec: 0 } };
  }

  // ALWAYS return 200-equivalent payload; UI should not show "Request timeout" as hard error
  return { items: [], meta: { cached: false, stale: true, workerStatus: status, workerError: json } };
}

/* ---------------- MCP server factory (PER REQUEST) ----------------
   官方 quickstart 建議：每次 /mcp request 建新的 server + transport，並 connect 後 handleRequest。 :contentReference[oaicite:4]{index=4}
*/
function createMcp() {
  const mcp = new McpServer({ name: "yt-ui-mcp", version: "1.0.0" });

  // Text-only: stable in ChatGPT App
  mcp.tool("latest_video", {}, async () => {
    const { items, meta } = await getVideosSWR();
    if (!items.length) {
      const link = SITE_BASE_URL ? `${SITE_BASE_URL}/ui/videos` : "/ui/videos";
      return {
        content: [
          {
            type: "text",
            text:
              `暫時無法取得清單（上游可能 timeout）。\n` +
              `請開啟網站查看：\n${link}\n\n` +
              `（meta: ${JSON.stringify(meta).slice(0, 400)}）`,
          },
        ],
      };
    }

    const v = items[0];
    const playLink = SITE_BASE_URL
      ? `${SITE_BASE_URL}/ui/videos?play=${encodeURIComponent(v.videoId)}`
      : `/ui/videos?play=${encodeURIComponent(v.videoId)}`;
    const yt = `https://youtu.be/${v.videoId}`;

    const staleNote = meta?.stale
      ? `\n\n⚠️ 目前顯示快取（cacheAge ${meta.cacheAgeSec}s），上游正在更新/可能 timeout。`
      : "";

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
    const { items, meta } = await getVideosSWR();
    const query = normalizeText(q);

    const hits = (items || [])
      .filter((v) => normalizeText(`${v.title} ${v.channelTitle}`).includes(query))
      .slice(0, 20);

    if (!hits.length) {
      return { content: [{ type: "text", text: `沒有找到相關影片。${meta?.stale ? "（上游可能 timeout，結果來自快取）" : ""}` }] };
    }

    const lines = hits.map((v, i) => {
      const link = SITE_BASE_URL
        ? `${SITE_BASE_URL}/ui/videos?play=${encodeURIComponent(v.videoId)}`
        : `/ui/videos?play=${encodeURIComponent(v.videoId)}`;
      return `${i + 1}. ${v.title}\n   ▶️ ${link}`;
    });

    return { content: [{ type: "text", text: lines.join("\n\n") }] };
  });

  return mcp;
}

/* ---------------- HTTP server ---------------- */
const MCP_PATH = "/mcp";
const MCP_METHODS = new Set(["POST", "GET", "DELETE"]);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    // Basic health
    if (req.method === "GET" && pathname === "/") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("OK");
      return;
    }

    // CORS preflight for MCP (recommended by official quickstart) :contentReference[oaicite:5]{index=5}
    if (req.method === "OPTIONS" && pathname.startsWith(MCP_PATH)) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "content-type,authorization");
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
      res.writeHead(204).end();
      return;
    }

    // MCP endpoint (Streamable HTTP)
    if (pathname.startsWith(MCP_PATH) && req.method && MCP_METHODS.has(req.method)) {
      // Per official example: set these headers for connector wizard robustness :contentReference[oaicite:6]{index=6}
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

      const mcp = createMcp();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless mode
        enableJsonResponse: true,
      });

      res.on("close", () => {
        transport.close();
        mcp.close();
      });

      try {
        await mcp.connect(transport);
        await transport.handleRequest(req, res);
      } catch (err) {
        console.error("Error handling MCP request:", err);
        if (!res.headersSent) res.writeHead(500).end("Internal server error");
      }
      return;
    }

    // UI routes
    if (pathname === "/ui/videos") return await sendFile(res, 200, "ui-videos.html");
    if (pathname === "/ui/search") return await sendFile(res, 200, "ui-search.html");

    // API routes (never throw timeout to UI; always 200 payload)
    if (pathname === "/api/videos") {
      const r = await getVideosSWR();
      return sendJson(res, 200, { items: r.items, meta: r.meta });
    }

    if (pathname === "/api/search") {
      const q = url.searchParams.get("q") || "";
      const { items, meta } = await getVideosSWR();
      const query = normalizeText(q);

      const filtered = !query
        ? []
        : (items || []).filter((v) => normalizeText(`${v.title} ${v.channelTitle}`).includes(query));

      return sendJson(res, 200, { items: filtered.slice(0, 100), q, meta });
    }

    if (pathname === "/health") {
      return sendJson(res, 200, {
        ok: true,
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

// Warm cache once at boot (non-blocking)
refreshVideosInBackground();

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`MCP endpoint: /mcp`);
});
