// index.js (Railway deploy-ready) - MCP Server + ChatGPT Widget UI
// Requires env:
//   CF_WORKER_BASE_URL = https://xxx.workers.dev
// Railway provides PORT automatically.

import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT || 3000);
const CF_WORKER_BASE_URL = process.env.CF_WORKER_BASE_URL; // e.g. https://xxx.workers.dev

if (!CF_WORKER_BASE_URL) {
  console.error("Missing CF_WORKER_BASE_URL env, e.g. https://xxx.workers.dev");
  process.exit(1);
}

// ---------------- UI template (text/html+skybridge) ----------------
const UI_HTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
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
    .badge{display:inline-block;font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid rgba(0,0,0,.15);margin-left:8px}
  </style>
</head>
<body>
  <div id="app" class="card"></div>
  <script>
    function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]))}

    async function callTool(name, args){
      if(!window.openai?.callTool) throw new Error("window.openai.callTool unavailable (not running inside ChatGPT Apps iframe?)");
      return await window.openai.callTool(name, args);
    }

    function render(payload){
      const app=document.getElementById("app");
      const info=payload?.structuredContent || payload || {};
      const meta=payload?._meta || {};
      const mode=meta.mode || "UNKNOWN";
      const count=info.totalVideos ?? 0;

      app.innerHTML=\`
        <div class="row">
          <input id="q" placeholder="搜尋標題關鍵字，例如：雨 / 備用 / 江湖" />
          <button id="btnSearch">搜尋</button>
          <button id="btnLatest">最新</button>
        </div>
        <div style="margin-top:8px">
          <small>模式：\${mode} ｜總片數：\${count} ｜更新：\${info.cachedAt || info.fetchedAt || ""}</small>
        </div>
        <ul id="list"></ul>
      \`;

      document.getElementById("btnSearch").onclick=async()=>{
        const q=document.getElementById("q").value.trim();
        if(!q) return;
        document.getElementById("list").innerHTML="<li>搜尋中...</li>";
        const out=await callTool("search_videos",{query:q,limit:30});
        render(out);
      };

      document.getElementById("btnLatest").onclick=async()=>{
        document.getElementById("list").innerHTML="<li>載入中...</li>";
        const out=await callTool("list_videos",{limit:30});
        render(out);
      };

      const list=document.getElementById("list");
      const videos=info.videos || [];
      list.innerHTML = videos.length ? videos.map(v=>\`
        <li>
          <div><a href="\${v.url}" target="_blank" rel="noreferrer">\${escapeHtml(v.title)}</a></div>
          <small>\${v.publishedAt || ""}</small>
          \${v.matched ? '<span class="badge">matched</span>' : ''}
        </li>\`).join("") : "<li><small>無結果</small></li>";
    }

    (function boot(){
      const payload=window.openai?.toolOutput;
      if(!payload){
        document.getElementById("app").innerHTML =
          "<strong>尚未有工具輸出</strong><p><small>請在 ChatGPT 內觸發工具，例如「列出我最近30條影片」。</small></p>";
        return;
      }
      render(payload);
    })();
  </script>
</body>
</html>`;

// ---------------- MCP server ----------------
const mcp = new McpServer({ name: "YouTube Channel Finder", version: "1.0.0" });

// Resource URI that tools will reference via openai/outputTemplate
//const TEMPLATE_URI = "ui://widget/youtube-finder.html";

// Register the widget template resource (compatible return shape)
const TEMPLATE_URI = "ui://widget/youtube-finder.html";

mcp.registerResource(
  "youtube-finder-widget",
  TEMPLATE_URI,
  { title: "YouTube Finder Widget" },
  async () => ({
    contents: [
      {
        uri: TEMPLATE_URI,              // ✅ 必填
        type: "text",                   // ✅ 必填
        mimeType: "text/html+skybridge",// ✅ 必填
        text: UI_HTML                   // ✅ 必填
      }
    ],
    _meta: {
      "openai/widgetPrefersBorder": true,
      "openai/widgetAccessible": true
    }
  })
);

// ---------------- Tool schemas ----------------
const listSchema = z.object({
  limit: z.number().int().min(1).max(500).optional()
});

const searchSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(200).optional()
});

// ---------------- Helpers ----------------
async function fetchIndex() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(`${CF_WORKER_BASE_URL}/my-channel/videos`, {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Worker error ${res.status}: ${JSON.stringify(data)}`);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function searchByTitle(videos, query, limit) {
  const q = query.trim().toLowerCase();
  const out = [];
  for (const v of videos) {
    const t = String(v.title || "").toLowerCase();
    if (t.includes(q)) out.push({ ...v, matched: true });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------- Tools (use registerTool for best compatibility) ----------------
mcp.registerTool(
  "list_videos",
  {
    title: "List Videos",
    description: "List latest videos from my YouTube channel cached index.",
    inputSchema: listSchema,
    _meta: {
      "openai/outputTemplate": TEMPLATE_URI,
      "openai/widgetAccessible": true
    }
  },
  async ({ limit }) => {
    const idx = await fetchIndex();
    const videos = (idx.videos || []).slice(0, limit ?? 30);

    return {
      structuredContent: {
        channelId: idx.channelId,
        channelTitle: idx.channelTitle,
        totalVideos: idx.totalVideos,
        fetchedAt: idx.fetchedAt,
        cachedAt: idx.cachedAt,
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
    description: "Search videos by title keyword in my cached channel index.",
    inputSchema: searchSchema,
    _meta: {
      "openai/outputTemplate": TEMPLATE_URI,
      "openai/widgetAccessible": true
    }
  },
  async ({ query, limit }) => {
    const idx = await fetchIndex();
    const videos = searchByTitle(idx.videos || [], query, limit ?? 30);

    return {
      structuredContent: {
        channelId: idx.channelId,
        channelTitle: idx.channelTitle,
        totalVideos: idx.totalVideos,
        fetchedAt: idx.fetchedAt,
        cachedAt: idx.cachedAt,
        videos
      },
      _meta: { mode: "SEARCH", query }
    };
  }
);

// ---------------- HTTP server wiring (FIXED) ----------------

// Create ONE transport for the lifetime of the process
const transport = new StreamableHTTPServerTransport({ path: "/mcp" });

// Connect ONCE at startup (important)
await mcp.connect(transport);

const httpServer = createServer(async (req, res) => {
  try {
    if (!req.url) return;

    // Health
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("MCP server running");
      return;
    }

    // MCP endpoint
    if (req.url.startsWith("/mcp")) {
      return transport.handleRequest(req, res);
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: err?.message || "Unknown error" }));
  }
});

httpServer.listen(PORT, () => {
  console.log("Listening on", PORT);
  console.log("MCP endpoint: /mcp");
  console.log("Worker base:", CF_WORKER_BASE_URL);
});
