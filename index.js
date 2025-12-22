// index.js — FINAL STABLE VERSION (Railway-ready)
// Env required:
//   CF_WORKER_BASE_URL = https://xxx.workers.dev

import { createServer } from "node:http";
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
const UI_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>YouTube Finder</title>
<style>
:root{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
body{margin:0;padding:12px}
.card{border:1px solid rgba(0,0,0,.12);border-radius:12px;padding:12px}
.row{display:flex;gap:8px;align-items:center}
input{flex:1;padding:10px 12px;border-radius:10px;border:1px solid rgba(0,0,0,.18)}
button{padding:10px 12px;border-radius:10px;border:1px solid rgba(0,0,0,.18);background:#fff;cursor:pointer}
small{opacity:.7}
ul{list-style:none;padding:0;margin:12px 0 0}
li{padding:10px 0;border-top:1px solid rgba(0,0,0,.08)}
a{text-decoration:none}a:hover{text-decoration:underline}
</style>
</head>
<body>
<div id="app" class="card"></div>
<script>
function esc(s){return String(s).replace(/[&<>"']/g,c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]))}
async function callTool(n,a){return window.openai.callTool(n,a);}
function render(p){
  const info=p?.structuredContent||{};
  const meta=p?._meta||{};
  const app=document.getElementById("app");
  app.innerHTML=\`
    <div class="row">
      <input id="q" placeholder="搜尋標題"/>
      <button id="s">搜尋</button>
      <button id="l">最新</button>
    </div>
    <div style="margin-top:8px"><small>模式：\${meta.mode||""} ｜ 共 \${info.totalVideos||0} 條</small></div>
    <ul id="list"></ul>\`;
  document.getElementById("s").onclick=async()=>{
    const q=document.getElementById("q").value.trim();
    if(!q)return;
    render(await callTool("search_videos",{query:q,limit:30}));
  };
  document.getElementById("l").onclick=async()=>{
    render(await callTool("list_videos",{limit:30}));
  };
  const list=document.getElementById("list");
  list.innerHTML=(info.videos||[]).map(v=>\`
    <li>
      <a href="\${v.url}" target="_blank">\${esc(v.title)}</a>
      <div><small>\${v.publishedAt||""}</small></div>
    </li>\`).join("") || "<li><small>無結果</small></li>";
}
(function(){ if(window.openai?.toolOutput) render(window.openai.toolOutput); })();
</script>
</body>
</html>`;

/* ---------------- MCP ---------------- */
const mcp = new McpServer({ name: "YouTube Channel Finder", version: "1.0.0" });
const TEMPLATE_URI = "ui://widget/youtube-finder.html";

mcp.registerResource(
  "youtube-finder-widget",
  TEMPLATE_URI,
  { title: "YouTube Finder Widget" },
  async () => ({
    contents: [{
      uri: TEMPLATE_URI,
      type: "text",
      mimeType: "text/html+skybridge",
      text: UI_HTML
    }]
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
mcp.registerTool(
  "list_videos",
  {
    title: "List Videos",
    inputSchema: listSchema,
    _meta: { "openai/outputTemplate": TEMPLATE_URI }
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
    _meta: { "openai/outputTemplate": TEMPLATE_URI }
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
      res.end(JSON.stringify({
        ok: true,
        status: r.status,
        bodyPreview: t.slice(0, 500)
      }, null, 2));
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
