import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { registerAll } from "./mcp.register.js";

const PORT = Number(process.env.PORT || 3000);
const CF_WORKER_BASE_URL = process.env.CF_WORKER_BASE_URL;

if (!CF_WORKER_BASE_URL) {
  console.error("Missing CF_WORKER_BASE_URL env, e.g. https://xxx.workers.dev");
  process.exit(1);
}

const MCP_PATH = "/mcp";
const sessions = new Map(); // sessionId -> { transport, mcp }

function createMcp() {
  const mcp = new McpServer({ name: "yt-finder", version: "1.0.0" });
  registerAll(mcp, { CF_WORKER_BASE_URL });
  return mcp;
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "content-type,authorization,mcp-session-id"
  );
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => (data += c));
    req.on("end", () => {
      if (!data) return resolve(null);
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function looksLikeInitialize(body) {
  if (!body) return false;
  if (Array.isArray(body)) return body.some(m => m?.method === "initialize");
  return body?.method === "initialize";
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("OK");
    return;
  }

  if (url.pathname !== MCP_PATH) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not Found");
    return;
  }

  if (req.method === "OPTIONS") {
    setCors(res);
    res.writeHead(204).end();
    return;
  }

  setCors(res);

  try {
    const method = req.method || "GET";
    const sessionId = req.headers["mcp-session-id"];

    if (method === "POST") {
      const body = await readJson(req).catch(() => null);

      // existing session
      if (sessionId && sessions.has(sessionId)) {
        const { transport } = sessions.get(sessionId);
        await transport.handleRequest(req, res, body);
        return;
      }

      // new session must initialize
      const initOk = (() => {
        try { return body && isInitializeRequest(body); }
        catch { return looksLikeInitialize(body); }
      })();

      if (!initOk) {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: expected initialize or valid session." },
          id: null
        }, null, 2));
        return;
      }

      const mcp = createMcp();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (sid) => sessions.set(sid, { transport, mcp })
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && sessions.has(sid)) {
          const s = sessions.get(sid);
          sessions.delete(sid);
          try { s?.mcp?.close(); } catch {}
        }
      };

      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    // GET/DELETE need session
    if (method === "GET" || method === "DELETE") {
      if (!sessionId || !sessions.has(sessionId)) {
        res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        res.end("Invalid or missing session ID");
        return;
      }
      const { transport } = sessions.get(sessionId);
      await transport.handleRequest(req, res);
      return;
    }

    res.writeHead(405, { "content-type": "text/plain; charset=utf-8" }).end("Method Not Allowed");
  } catch (err) {
    console.error("Error handling MCP request:", err);
    if (!res.headersSent) res.writeHead(500).end("Internal server error");
  }
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`MCP endpoint: ${MCP_PATH}`);
});
