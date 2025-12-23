// index.js — FINAL STABLE VERSION (Railway-ready, Multi-page UI from repo files)
// Env required:
//   CF_WORKER_BASE_URL = https://xxx.workers.dev

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

/* ---------------- Env ---------------- */
const PORT = Number(process.env.PORT || 3000);
const CF_WORKER_BASE_URL = process.env.CF_WORKER_BASE_URL;

if (!CF_WORKER_BASE_URL) {
  console.error("Missing CF_WORKER_BASE_URL");
  process.exit(1);
}

/* ---------------- UI (skybridge) ---------------- */
// Multi-page URIs (these are the template identifiers)
const HOME_URI = "ui://page/index.html";
const VIDEOS_URI = "ui://page/videos.html";
const SEARCH_URI = "ui://page/search.html";

// Load UI pages from repo root files
function loadUI(relPath) {
  // ESM-safe: resolve relative to this index.js
  const url = new URL(relPath, import.meta.url);
  return readFileSync(url, "utf8");
}

// You said these files already exist in repo root:
const UI_HOME_HTML = loadUI("./ui-index.html");
const UI_VIDEOS_HTML = loadUI("./ui-videos.html");
const UI_SEARCH_HTML = loadUI("./ui-search.html");

/* ---------------- MCP ---------------- */
const mcp = new McpServer({ name: "YouTube Channel Finder", version: "1.0.0" });

// Register 3 UI resources
mcp.registerResource(
  "youtube-finder-home",
  HOME_URI,
  { title: "YouTube Finder Home" },
  async () => ({
    contents: [
      {
        uri: HOME_URI,
        type: "text",
        mimeType: "text/html+skybridge",
        text: UI_HOME_HTML
      }
    ]
  })
);

mcp.registerResource(
  "youtube-finder-videos",
  VIDEOS_URI,
  { title: "YouTube Finder Videos" },
  async () => ({
    contents: [
      {
        uri: VIDEOS_URI,
        type: "text",
        mimeType: "text/html+skybridge",
        text: UI_VIDEOS_HTML
      }
    ]
  })
);

mcp.registerResource(
  "youtube-finder-search",
  SEARCH_URI,
  { title: "YouTube Finder Search" },
  async () => ({
    contents: [
      {
        uri: SEARCH_URI,
        type: "text",
        mimeType: "text/html+skybridge",
        text: UI_SEARCH_HTML
      }
    ]
  })
);

/* ---------------- Schemas ---------------- */
const listSchema = z.object({
  limit: z.number().int().min(1).max(500).optional()
});

const searchSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(200).optional()
});

const emptySchema = z.object({}).strict();

/* ---------------- Helpers ---------------- */
async function fetchIndex(limit) {
  const url = new URL(`${CF_WORKER_BASE_URL}/my-channel/videos`);
  if (limit) url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0"
    }
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Worker error ${res.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

function normalize(v) {
  return {
    videoId: String(v.videoId || ""),
    title: String(v.title || ""),
    url: String(v.url || `https://www.youtube.com/watch?v=${v.videoId || ""}`),
    publishedAt: v.publishedAt ? String(v.publishedAt) : ""
  };
}

/* ---------------- Tools ---------------- */
// NAV tools (page switches)
mcp.registerTool(
  "open_home_page",
  {
    title: "Open Home Page",
    inputSchema: emptySchema,
    _meta: { "openai/outputTemplate": HOME_URI }
  },
  async () => ({
    content: [{ type: "text", text: "Open home page" }],
    structuredContent: {},
    _meta: { mode: "NAV", page: "HOME" }
  })
);

mcp.registerTool(
  "open_search_page",
  {
    title: "Open Search Page",
    inputSchema: emptySchema,
    _meta: { "openai/outputTemplate": SEARCH_URI }
  },
  async () => ({
    content: [{ type: "text", text: "Open search page" }],
    structuredContent: {},
    _meta: { mode: "NAV", page: "SEARCH" }
  })
);

// Data tools
mcp.registerTool(
  "list_videos",
  {
    title: "List Videos",
    inputSchema: listSchema,
    _meta: { "openai/outputTemplate": VIDEOS_URI }
  },
  async ({ limit }) => {
    const L = limit ?? 30;
    const idx = await fetchIndex(L);
    const videos = (idx.videos || []).slice(0, L).map(normalize);

    return {
      content: [{ type: "text", text: `Fetched ${videos.length} videos` }],
      structuredContent: {
        channelId: String(idx.channelId || ""),
        channelTitle: String(idx.channelTitle || ""),
        totalVideos: Number(idx.totalVideos || 0),
        fetchedAt: String(idx.fetchedAt || ""),
        cachedAt: String(idx.cachedAt || ""),
        videos
      },
      _meta: { mode: "LIST" }
    };
  }
);

mcp.registerTool(
  "search_videos",
  {
    title: "Search Videos",
    inputSchema: searchSchema,
    _meta: { "openai/outputTemplate": SEARCH_URI }
  },
  async ({ query, limit }) => {
    const L = limit ?? 30;
    const idx = await fetchIndex(500);
    const q = query.toLowerCase();

    const videos = (idx.videos || [])
      .filter(v => String(v.title || "").toLowerCase().includes(q))
      .slice(0, L)
      .map(normalize);

    return {
      content: [{ type: "text", text: `Search "${query}" → ${videos.length} results` }],
      structuredContent: {
        channelId: String(idx.channelId || ""),
        channelTitle: String(idx.channelTitle || ""),
        totalVideos: Number(idx.totalVideos || 0),
        fetchedAt: String(idx.fetchedAt || ""),
        cachedAt: String(idx.cachedAt || ""),
        videos
      },
      _meta: { mode: "SEARCH", query }
    };
  }
);

/* ---------------- HTTP ---------------- */
const transport = new StreamableHTTPServerTransport({ path: "/mcp" });
await mcp.connect(transport);

createServer(async (req, res) => {
  // health
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("MCP server running");
    return;
  }

  // debug: Railway -> Worker
  if (req.method === "GET" && req.url === "/debug/worker") {
    try {
      const r = await fetch(`${CF_WORKER_BASE_URL}/my-channel/videos?limit=3`);
      const t = await r.text();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify(
          {
            ok: true,
            status: r.status,
            bodyPreview: t.slice(0, 500)
          },
          null,
          2
        )
      );
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: String(e) }, null, 2));
    }
    return;
  }

  // MCP
  if (req.url?.startsWith("/mcp")) {
    return transport.handleRequest(req, res);
  }

  res.writeHead(404);
  res.end("Not Found");
}).listen(PORT, () => {
  console.log("Listening on", PORT);
  console.log("MCP endpoint: /mcp");
});
