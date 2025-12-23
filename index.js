// index.js — FINAL (UI + API + MCP-ready, Railway-ready)
// Env required:
//   CF_WORKER_BASE_URL = https://xxx.workers.dev

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

  /**
   * CSP notes:
   * - UI uses inline <style>/<script> => allow 'unsafe-inline' for style/script on self
   * - YouTube embed uses youtube-nocookie + youtube + i.ytimg thumbnails
   * - Some videos may hit googlevideo streams, and (sometimes) gstatic
   * - We keep it reasonably tight while avoiding common embed breakage
   */
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",

    // Thumbnails + potential YT related images
    "img-src 'self' data: https: https://i.ytimg.com https://ytimg.com",

    // Inline UI
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline'",

    // API calls (your site -> CF worker)
    "connect-src 'self' https:",

    // Allow embedding YouTube
    "frame-src https://www.youtube.com https://www.youtube-nocookie.com",

    // Allow media loads if browser treats some video/audio as media-src
    "media-src 'self' https: blob:",

    // Some browsers use child-src for frames (legacy)
    "child-src https://www.youtube.com https://www.youtube-nocookie.com",
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
  } catch {
    // not a URL
  }

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

/* ---------------- Worker fetch with timeout ---------------- */
async function fetchWorkerJson(workerPath) {
  const url = new URL(workerPath, CF_WORKER_BASE_URL).toString();

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10000);

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
    return {
      ok: false,
      status: 504,
      json: { error: "Worker fetch failed/timeout", detail: String(e) },
    };
  } finally {
    clearTimeout(t);
  }
}

/* ---------------- MCP ---------------- */
const mcp = new McpServer({ name: "yt-ui-mcp", version: "1.0.0" });

mcp.tool(
  "list_videos",
  { limit: z.number().int().min(1).max(200).optional() },
  async ({ limit }) => {
    const { ok, status, json } = await fetchWorkerJson("/my-channel/videos");
    if (!ok) {
      return { content: [{ type: "text", text: `Worker error ${status}: ${JSON.stringify(json).slice(0, 300)}` }] };
    }
    const items = (json.items || json.videos || [])
      .map(pickVideoFields)
      .filter((x) => x.videoId)
      .slice(0, limit ?? 50);

    return { content: [{ type: "text", text: JSON.stringify({ items }, null, 2) }] };
  }
);

mcp.tool(
  "search_videos",
  { q: z.string().optional() },
  async ({ q }) => {
    const { ok, status, json } = await fetchWorkerJson("/my-channel/videos");
    if (!ok) {
      return { content: [{ type: "text", text: `Worker error ${status}: ${JSON.stringify(json).slice(0, 300)}` }] };
    }

    const items = (json.items || json.videos || []).map(pickVideoFields).filter((x) => x.videoId);
    const query = normalizeText(q);
    const filtered = !query
      ? []
      : items.filter((v) => normalizeText(`${v.title} ${v.channelTitle}`).includes(query));

    return { content: [{ type: "text", text: JSON.stringify({ items: filtered.slice(0, 50) }, null, 2) }] };
  }
);

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

    if (pathname === "/ui/videos") {
      return await sendFile(res, 200, "ui-videos.html");
    }

    if (pathname === "/ui/search") {
      return await sendFile(res, 200, "ui-search.html");
    }

    if (pathname === "/api/videos") {
      const { ok, status, json } = await fetchWorkerJson("/my-channel/videos");
      if (!ok) return sendJson(res, status, json);

      const items = (json.items || json.videos || [])
        .map(pickVideoFields)
        .filter((x) => x.videoId);

      return sendJson(res, 200, { items });
    }

    if (pathname === "/api/search") {
      const q = url.searchParams.get("q") || "";
      const { ok, status, json } = await fetchWorkerJson("/my-channel/videos");
      if (!ok) return sendJson(res, status, json);

      const items = (json.items || json.videos || [])
        .map(pickVideoFields)
        .filter((x) => x.videoId);

      const query = normalizeText(q);
      const filtered = !query
        ? []
        : items.filter((v) => normalizeText(`${v.title} ${v.channelTitle}`).includes(query));

      return sendJson(res, 200, { items: filtered.slice(0, 100), q });
    }

    if (pathname === "/health") {
      return sendJson(res, 200, { ok: true, service: "yt-ui-mcp", time: new Date().toISOString() });
    }

    return sendText(res, 404, "Not Found");
  } catch (err) {
    console.error(err);
    return sendText(res, 500, `Internal Error: ${String(err?.message || err)}`);
  }
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
