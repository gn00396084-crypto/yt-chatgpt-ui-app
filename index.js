// index.js — MCP server (single-widget architecture)
// Env required: CF_WORKER_BASE_URL = https://xxx.workers.dev

import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAll } from "./mcp.register.js";

const PORT = Number(process.env.PORT || 3000);
const CF_WORKER_BASE_URL = process.env.CF_WORKER_BASE_URL;

if (!CF_WORKER_BASE_URL) {
  console.error("Missing CF_WORKER_BASE_URL env, e.g. https://xxx.workers.dev");
  process.exit(1);
}

function createMcp() {
  const mcp = new McpServer({ name: "yt-finder", version: "1.0.0" });
  registerAll(mcp, { CF_WORKER_BASE_URL });
  return mcp;
}

const MCP_PATH = "/mcp";
const MCP_METHODS = new Set(["POST", "GET", "DELETE"]);

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  // health
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("OK");
    return;
  }

  // CORS preflight for MCP
  if (req.method === "OPTIONS" && url.pathname.startsWith(MCP_PATH)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type,authorization");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    res.writeHead(204).end();
    return;
  }

  // MCP endpoint
  if (url.pathname.startsWith(MCP_PATH) && req.method && MCP_METHODS.has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    const mcp = createMcp();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
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

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not Found");
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`MCP endpoint: /mcp`);
});
