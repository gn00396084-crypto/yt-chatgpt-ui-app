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

  /* ---------------- NAV tools ---------------- */
  mcp.registerTool(
    "open_home_page",
    {
      title: "Open Home Page",
      inputSchema: emptySchema,
      _meta: { "openai/outputTemplate": HOME_URI }
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
      _meta: { "openai/outputTemplate": SEARCH_URI }
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
      _meta: { "openai/outputTemplate": VIDEOS_URI }
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
      _meta: { "openai/outputTemplate": SEARCH_URI }
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
