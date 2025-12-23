import { z } from "zod";
import { HOME_URI, VIDEOS_URI, SEARCH_URI } from "./mcp.resources.js";
import { makeWorkerClient } from "./worker.client.js";

export function registerTools(mcp, env) {
  const { fetchIndex, normalize } = makeWorkerClient(env);

  /* ---------------- Schemas ---------------- */
  const listSchema = z.object({
    limit: z.number().int().min(1).max(500).optional()
  });

  const searchSchema = z.object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(200).optional()
  });

  const emptySchema = z.object({}).strict();

  // ✅ Required by Apps SDK tool descriptor rules
  const NOAUTH = [{ type: "noauth" }];

  // Helper to ensure every tool satisfies required meta fields
  function toolMeta(outputTemplate) {
    return {
      securitySchemes: NOAUTH,                 // ✅ required mirror in _meta :contentReference[oaicite:1]{index=1}
      "openai/outputTemplate": outputTemplate, // ✅ required :contentReference[oaicite:2]{index=2}
      "openai/widgetAccessible": true,         // ✅ allow widget → tool calls :contentReference[oaicite:3]{index=3}
    };
  }

  /* ---------------- NAV tools ---------------- */
  mcp.registerTool(
    "open_home_page",
    {
      title: "Open Home Page",
      inputSchema: emptySchema,

      // ✅ Put securitySchemes at top-level too
      securitySchemes: NOAUTH,

      _meta: toolMeta(HOME_URI)
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
      securitySchemes: NOAUTH,
      _meta: toolMeta(SEARCH_URI)
    },
    async () => ({
      content: [{ type: "text", text: "Open search page" }],
      structuredContent: {},
      _meta: { mode: "NAV", page: "SEARCH" }
    })
  );

  /* ---------------- Data tools ---------------- */
  mcp.registerTool(
    "list_videos",
    {
      title: "List Videos",
      inputSchema: listSchema,
      securitySchemes: NOAUTH,
      _meta: toolMeta(VIDEOS_URI)
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
      securitySchemes: NOAUTH,
      _meta: toolMeta(SEARCH_URI)
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
}
