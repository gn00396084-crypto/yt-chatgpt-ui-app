// index.js (FINAL)

import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { registerAll } from "./mcp.register.js";
import { debugListResources, debugInspectHtml } from "./mcp.resources.js";

const PORT = Number(process.env.PORT || 3000);

function json(res, obj, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(obj, null, 2));
}

function okDebugToken(url) {
  // 可選：Railway env 設 DEBUG_TOKEN
  if (!process.env.DEBUG_TOKEN) return true;
  return url.searchParams.get("token") === process.env.DEBUG_TOKEN;
}

async function main() {
  const mcp = new McpServer({ name: "yt-chatgpt-ui-app", version: "1.0.0" });

  registerAll(mcp, process.env);

  const transport = new StreamableHTTPServerTransport();
  await mcp.connect(transport);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // ✅ DEBUG: MUST be before MCP handler
    if (path === "/debug/resources") {
      if (!okDebugToken(url)) return json(res, { error: "unauthorized" }, 401);
      return json(res, { ok: true, resources: debugListResources() });
    }

    if (path.startsWith("/debug/ui/")) {
      if (!okDebugToken(url)) return json(res, { error: "unauthorized" }, 401);
      const key = path.split("/").pop(); // home|search|videos
      return json(res, { ok: true, inspect: debugInspectHtml(key) });
    }

    // MCP handler
    try {
      await transport.handleRequest(req, res);
    } catch (e) {
      return json(res, { error: e?.message || String(e) }, 500);
    }
  });

  server.listen(PORT, () => {
    console.log(`MCP server listening on :${PORT}`);
    console.log(`Debug: /debug/resources , /debug/ui/home|search|videos`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
