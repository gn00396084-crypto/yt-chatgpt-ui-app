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

// ---------- UI template (minimal) ----------
const UI_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>YouTube Finder</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;padding:12px}
.card{border:1px solid rgba(0,0,0,.12);border-radius:12px;padding:12px}
.row{display:flex;gap:8px;align-items:center}
input{flex:1;padding:10px 12px;border-radius:10px;border:1px solid rgba(0,0,0,.18)}
button{padding:10px 12px;border-radius:10px;border:1px solid rgba(0,0,0,.18);background:#fff;cursor:pointer}
small{opacity:.7}
ul{list-style:none;padding:0;margin:12px 0 0}
li{padding:10px 0;border-top:1px solid rgba(0,0,0,.08)}
a{text-decoration:none}a:hover{text-decoration:underline}
.badge{display:inline-block;font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid rgba(0,0,0,.15);margin-left:8px}
</style></head>
<body>
<div id="app" class="card"></div>
<script>
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]))}
function render(payload){
  const app=document.getElementById("app");
  const info=payload?.structuredContent||payload||{};
  const meta=payload?._meta||{};
  const mode=meta.mode||"UNKNOWN";
  const count=info.totalVideos??0;
  app.innerHTML=\`
    <div class="row">
      <input id="q" placeholder="搜尋標題關鍵字，例如：雨 / 備用 / 江湖" />
      <button id="btnSearch">搜尋</button>
      <button id="btnLatest">最新</button>
    </div>
    <div style="margin-top:8px">
      <small>模式：\${mode} ｜總片數：\${count} ｜更新：\${info.cachedAt||info.fetchedAt||""}</small>
    </div>
    <ul id="list"></ul>
  \`;
  document.getElementById("btnSearch").onclick=async()=>{
    const q=document.getElementById("q").value.trim();
    if(!q) return;
    document.getElementById("list").innerHTML="<li>搜尋中...</li>";
    const out=await window.openai.callTool("search_videos",{query:q,limit:30});
    render(out);
  };
  document.getElementById("btnLatest").onclick=async()=>{
    document.getElementById("list").innerHTML="<li>載入中...</li>";
    const out=await window.openai.callTool("list_videos",{limit:30});
    render(out);
  };
  const list=document.getElementById("list");
  const videos=info.videos||[];
  list.innerHTML = videos.length ? videos.map(v=>\`
    <li>
      <div><a href="\${v.url}" target="_blank" rel="noreferrer">\${escapeHtml(v.title)}</a></div>
      <small>\${v.publishedAt||""}</small>
      \${v.matched ? '<span class="badge">matched</span>' : ''}
    </li>\`).join("") : "<li><small>無結果</small></li>";
}
(function boot(){
  const payload=window.openai?.toolOutput;
  if(!payload){
    document.getElementById("app").innerHTML="<strong>尚未有工具輸出</strong><p><small>請在 ChatGPT 內觸發工具，例如「列出我最近30條影片」。</small></p>";
    return;
  }
  render(payload);
})();
</script>
</body></html>`;

// ---------- MCP server ----------
const mcp = new McpServer({ name: "YouTube Channel Finder", version: "1.0.0" });

// UI resource (ChatGPT iframe widget)
// MUST be text/html+skybridge for Apps SDK widget rendering
//mcp.resource("video-widget", { mimeType: "text/html+skybridge", text: UI_HTML });
const TEMPLATE_URI = "ui://widget/youtube-finder.html";

mcp.registerResource(
  "youtube-finder-widget",
  TEMPLATE_URI,
  {},
  async () => ({
    contents: [
      {
        uri: TEMPLATE_URI,
        mimeType: "text/html+skybridge",
        text: UI_HTML,
        _meta: {
          "openai/widgetPrefersBorder": true,
          "openai/widgetDomain": "https://chatgpt.com"
        }
      }
    ]
  })
);

const listSchema = z.object({ limit: z.number().int().min(1).max(500).optional() });
const searchSchema = z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(200).optional() });

async function fetchIndex() {
  const res = await fetch(`${CF_WORKER_BASE_URL}/my-channel/videos`, { headers: { Accept: "application/json" } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Worker error ${res.status}: ${JSON.stringify(data)}`);
  return data;
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

mcp.tool("list_videos", { description: "List latest videos (cached index).", inputSchema: listSchema }, async ({ limit }) => {
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
    //_meta: { mode: "LIST", "openai/outputTemplate": "video-widget" }
  _meta: { mode: "LIST", "openai/outputTemplate": TEMPLATE_URI, "openai/widgetAccessible": true }

  };
});

mcp.tool("search_videos", { description: "Search videos by title keyword.", inputSchema: searchSchema }, async ({ query, limit }) => {
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
   // _meta: { mode: "SEARCH", query, "openai/outputTemplate": "video-widget" }
  _meta: { mode: "SEARCH", query, "openai/outputTemplate": TEMPLATE_URI, "openai/widgetAccessible": true }

  };
});

// ---------- HTTP server wiring ----------
const httpServer = createServer(async (req, res) => {
  if (!req.url) return;

  // Simple health
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("MCP server running");
    return;
  }

  if (req.url.startsWith("/mcp")) {
    const transport = new StreamableHTTPServerTransport({ path: "/mcp" });
    await mcp.connect(transport);
    return transport.handleRequest(req, res);
  }

  res.writeHead(404);
  res.end("Not Found");
});

httpServer.listen(PORT, () => console.log("Listening on", PORT));
