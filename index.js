
import http from "http";

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Server is running");
    return;
  }

  if (req.url === "/mcp") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, message: "MCP endpoint placeholder" }));
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
}).listen(PORT, () => {
  console.log("Server listening on", PORT);
});
