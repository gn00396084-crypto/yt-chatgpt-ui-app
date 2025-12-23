// index.js — Railway-ready (thin entry)
// Env required: CF_WORKER_BASE_URL=https://xxx.workers.dev

import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAll } from "./mcp.register.js";

/* ---------------- Env ---------------- */
const PORT = Number(process.env.PORT || 3000);
const CF_WORKER_BASE_URL = process.env.CF_WORKER_BASE_URL;

if (!CF_WORKER_BASE_URL) {
  console.error("Missing CF_WORKER_BASE_URL");
  process.exit(1);
}

/* ---------------- MCP ---------------- */
const mcp = new McpServer({ name: "YouTube Channel Finder", version: "1.0.0" });

// register resources + tools (split files)
registerAll(mcp, { CF_WORKER_BASE_URL });

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
          { ok: true, status: r.status, bodyPreview: t.slice(0, 500) },
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
