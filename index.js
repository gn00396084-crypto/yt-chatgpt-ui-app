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
    "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
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

async function fetchWorkerJson(workerPath) {
  const url = new URL(workerPath, CF_WORKER_BASE_URL).toString();
  const r = await fetch(url, { headers: { accept: "application/json" } });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { ok: r.ok, status: r.status, json };
}

function normalizeText(s) {
  return String(s || "").toLowerCase().trim();
}

function pickVideoFields(v) {
  return {
    videoId: v.videoId || v.id?.videoId || v.id,
    title: v.title || v.snippet?.title || "",
    channelTitle: v.channelTitle || v.snippet?.channelTitle || "",
    publishedAt: v.publishedAt || v.snippet?.publishedAt || "",
    thumbnailUrl:
      v.thumbnailUrl ||
      v.thumbnails?.medium?.url ||
      v.snippet?.thumbnails?.medium?.url ||
      v.snippet?.thumbnails?.high?.url ||
      "",
  };
}

/* ---------------- MCP ---------------- */
const mcp = new McpServer({ name: "yt-ui-mcp", version: "1.0.0" });

mcp.tool(
  "list_videos",
  { limit: z.number().int().min(1).max(200).optional() },
  async ({ limit }) => {
    const { ok, status, json } = await fetchWorkerJson("/my-channel/videos");
    if (!ok) {
      return {
        content: [{ type: "text", text: `Worker error ${status}` }],
      };
    }
    const items = (json.items || json.videos || [])
      .slice(0, limit ?? 50)
      .map(pickVideoFields);

    return {
      content: [{ type: "text", text: JSON.stringify({ items }, null, 2) }],
    };
  }
);

mcp.tool(
  "search_videos",
  { q: z.string().optional() },
  async ({ q }) => {
    const { ok, status, json } = await fetchWorkerJson("/my-channel/videos");
    if (!ok) {
      return {
        content: [{ type: "text", text: `Worker error ${status}` }],
      };
    }

    const items = (json.items || json.videos || []).map(pickVideoFields);
    const query = normalizeText(q);

    const filtered = !query
      ? []
      : items.filter((v) =>
          normalizeText(`${v.title} ${v.channelTitle}`).includes(query)
        );

    return {
      content: [{ type: "text", text: JSON.stringify({ items: filtered }, null, 2) }],
    };
  }
);

const transport = new StreamableHTTPServerTransport({ server: mcp });

/* ---------------- HTTP Server ---------------- */
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (pathname === "/mcp") {
      return transport.handleRequest(req, res);
    }

    if (pathname === "/") {
      res.statusCode = 302;
      res.setHeader("Location", "/ui/search");
      withSecurityHeaders(res);
      return res.end();
    }

    if (pathname === "/ui/search") {
      return sendFile(res, 200, "ui-search.html");
    }

    if (pathname === "/ui/videos") {
      return sendFile(res, 200, "ui-videos.html");
    }

    if (pathname === "/api/videos") {
      const { ok, status, json } = await fetchWorkerJson("/my-channel/videos");
      if (!ok) return sendJson(res, status, json);
      return sendJson(res, 200, { items: (json.items || []).map(pickVideoFields) });
    }

    if (pathname === "/api/search") {
      const q = url.searchParams.get("q") || "";
      const { json } = await fetchWorkerJson("/my-channel/videos");
      const items = (json.items || []).map(pickVideoFields);
      const query = normalizeText(q);
      const filtered = items.filter((v) =>
        normalizeText(`${v.title} ${v.channelTitle}`).includes(query)
      );
      return sendJson(res, 200, { items: filtered });
    }

    return sendText(res, 404, "Not Found");
  } catch (err) {
    console.error(err);
    return sendText(res, 500, "Internal Server Error");
  }
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
