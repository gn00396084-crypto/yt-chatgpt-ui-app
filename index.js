// index.js — FINAL (ChatGPT-safe, text + link only)
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
  console.error("Missing CF_WORKER_BASE_URL env");
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

  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "img-src 'self' https: data:",
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

async function sendFile(res, status, filename) {
  const p = path.join(__dirname, filename);
  const buf = await readFile(p);
  res.statusCode = status;
  withSecurityHeaders(res);
  res.end(buf);
}

/* ---------------- Helpers ---------------- */
function extractVideoId(input) {
  if (!input) return "";
  const s = String(input).trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const v = u.searchParams.get("v");
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
  } catch {}
  return "";
}

function pickVideoFields(v) {
  const rawId = v.videoId || v.id?.videoId || v.id || v.url;
  const videoId = extractVideoId(rawId);
  const title = v.title || v.snippet?.title || "";
  const publishedAt = v.publishedAt || v.snippet?.publishedAt || "";
  const thumbnailUrl =
    v.thumbnailUrl ||
    v.snippet?.thumbnails?.medium?.url ||
    (videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : "");

  return { videoId, title, publishedAt, thumbnailUrl };
}

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
    const json = JSON.parse(text);
    return { ok: r.ok, status: r.status, json };
  } catch (e) {
    return { ok: false, status: 504, json: { error: String(e) } };
  } finally {
    clearTimeout(t);
  }
}

/* ---------------- MCP (TEXT ONLY, STABLE) ---------------- */
const mcp = new McpServer({ name: "yt-latest-text-only", version: "1.0.0" });

mcp.tool("latest_video", {}, async () => {
  const { ok, status, json } = await fetchWorkerJson("/my-channel/videos");
  if (!ok) {
    return {
      content: [
        {
          type: "text",
          text: `Unable to refresh latest video (status ${status}). Using last known result.`,
        },
      ],
    };
  }

  const items = (json.items || json.videos || [])
    .map(pickVideoFields)
    .filter((x) => x.videoId);

  if (!items.length) {
    return { content: [{ type: "text", text: "No videos found." }] };
  }

  const v = items[0];
  const link = `https://your-site.example/ui/videos?play=${v.videoId}`;

  return {
    content: [
      {
        type: "text",
        text:
          `🎵 最新一首（最近成功抓取）\n\n` +
          `${v.title}\n` +
          `上架日期：${v.publishedAt?.slice(0, 10) || "unknown"}\n\n` +
          `▶️ 播放（含縮圖）：\n${link}`,
      },
    ],
  };
});

const transport = new StreamableHTTPServerTransport({ server: mcp });

/* ---------------- HTTP server ---------------- */
const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname === "/mcp") {
    return transport.handleRequest(req, res);
  }
  if (pathname === "/") {
    res.statusCode = 302;
    res.setHeader("Location", "/ui/videos");
    return res.end();
  }
  if (pathname === "/ui/videos") return sendFile(res, 200, "ui-videos.html");
  if (pathname === "/ui/search") return sendFile(res, 200, "ui-search.html");

  if (pathname === "/api/videos") {
    const { ok, status, json } = await fetchWorkerJson("/my-channel/videos");
    if (!ok) return sendJson(res, status, json);

    const items = (json.items || json.videos || [])
      .map(pickVideoFields)
      .filter((x) => x.videoId);

    return sendJson(res, 200, { items });
  }

  res.statusCode = 404;
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
