// index.js — FINAL, Railway deploy-ready
// Env required:
//   CF_WORKER_BASE_URL = https://xxx.workers.dev

import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

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
.badge{display:inline-block;font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid rgba(0,0,0,.15);margin-left:8px}
</style>
</head>
<body>
<div id="app" class="card"></div>
<script>
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]))}
async function callTool(name,args){return window.openai.callTool(name,args);}
function render(payload){
  const info=payload?.structuredContent||{};
  const meta=payload?._meta||{};
  const app=document.getElementById("app");
  app.innerHTML=\`
    <div class="row">
      <input id="q" placeholder="搜尋標題關鍵字"/>
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
      <a href="\${v.url}" target="_blank">\${escapeHtml(v.title)}</a>
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
const listSchema = z.object({ limit: z.number().int().min(1).max(500).optional() });
const searchSchema = z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(200).optional() });

/* ---------------- Helpers ---------------- */
async function fetchIndex(limit){
  const url=new URL(`${CF_WORKER_BASE_URL}/my-channel/videos`);
  if(limit) url.searchParams.set("limit",String(limit));
  const r=await fetch(url.toString(),{headers:{Accept:"application/json"}});
  const j=await r.json();
  if(!r.ok) throw new Error("Worker error");
  return j;
}
const norm=v=>({
  videoId:String(v.videoId||""),
  title:String(v.title||""),
  url:String(v.url||`https://www.youtube.com/watch?v=${v.videoId||""}`),
  publishedAt:v.publishedAt?String(v.publishedAt):""
});

/* ---------------- Tools ---------------- */
mcp.registerTool(
  "list_videos",
  { title:"List Videos", inputSchema:listSchema, _meta:{ "openai/outputTemplate":TEMPLATE_URI }},
  async({limit})=>{
    const L=limit??30;
    const idx=await fetchIndex(L);
    const videos=(idx.videos||[]).slice(0,L).map(norm);
    return {
      content:[{type:"text",text:`Fetched ${videos.length} videos`}],
      structuredContent:{ ...idx, videos },
      _meta:{ mode:"LIST" }
    };
  }
);

mcp.registerTool(
  "search_videos",
  { title:"Search Videos", inputSchema:searchSchema, _meta:{ "openai/outputTemplate":TEMPLATE_URI }},
  async({query,limit})=>{
    const L=limit??30;
    const idx=await fetchIndex(500);
    const q=query.toLowerCase();
    const videos=(idx.videos||[]).filter(v=>String(v.title||"").toLowerCase().includes(q)).slice(0,L).map(norm);
    return {
      content:[{type:"text",text:`Search "${query}" → ${videos.length} results`}],
      structuredContent:{ ...idx, videos },
      _meta:{ mode:"SEARCH", query }
    };
  }
);

/* ---------------- HTTP ---------------- */
const transport=new StreamableHTTPServerTransport({path:"/mcp"});
await mcp.connect(transport);

createServer((req,res)=>{
  if(req.method==="GET"&&req.url==="/"){res.end("MCP server running");return;}
  if(req.url?.startsWith("/mcp")) return transport.handleRequest(req,res);
  res.statusCode=404;res.end("Not Found");
}).listen(PORT,()=>console.log("Listening",PORT));
