import { z } from "zod";
import { WIDGET_URI } from "./mcp.resources.js";
import { makeWorkerClient } from "./worker.client.js";

export function registerTools(mcp, env) {
  const { fetchIndex, normalize } = makeWorkerClient(env);

  const NOAUTH = [{ type: "noauth" }];
  const emptySchema = z.object({}).strict();
  const listSchema = z.object({
    limit: z.number().int().min(1).max(200).optional()
  }).strict();
  const searchSchema = z.object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(200).optional()
  }).strict();

  // ✅ 官方：_meta["openai/outputTemplate"] 指向 ui://widget/... :contentReference[oaicite:10]{index=10}
  const baseMeta = (extra = {}) => ({
    "openai/outputTemplate": WIDGET_URI,
    "openai/widgetAccessible": true,
    ...extra
  });

  // 簡單快取，避免每次 search 都打 worker
  let cache = { ts: 0, idx: null };
  async function getIndexCached(limit = 500) {
    const now = Date.now();
    if (cache.idx && (now - cache.ts) < 60_000) return cache.idx;
    const idx = await fetchIndex(limit);
    cache = { ts: now, idx };
    return idx;
  }

  // ✅ 1) 公開：只負責「開 app」
  mcp.registerTool(
    "youtube_finder",
    {
      title: "Open YouTube Finder",
      description: "Open the YouTube Finder widget.",
      inputSchema: emptySchema,
      securitySchemes: NOAUTH,
      _meta: baseMeta({
        "openai/toolInvocation/invoking": "正在打開 YouTube Finder…",
        "openai/toolInvocation/invoked": "YouTube Finder 已開啟。"
      })
    },
    async () => ({
      content: [{ type: "text", text: "YouTube Finder opened." }],
      structuredContent: { ready: true, videos: [] },
      _meta: {}
    })
  );

  // ✅ 2) 私有：最新列表（widget 內 callTool 用）
  mcp.registerTool(
    "list_videos",
    {
      title: "List videos",
      inputSchema: listSchema,
      securitySchemes: NOAUTH,
      _meta: baseMeta({
        "openai/visibility": "private"
      })
    },
    async ({ limit }) => {
      const L = limit ?? 30;
      const idx = await getIndexCached(500);

      const videos = (idx.videos || [])
        .slice(0, L)
        .map(normalize)
        .map(v => ({
          ...v,
          thumbnailUrl: v.videoId ? `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg` : ""
        }));

      return {
        content: [],
        structuredContent: {
          channelTitle: String(idx.channelTitle || ""),
          fetchedAt: String(idx.fetchedAt || ""),
          query: "",
          videos
        },
        _meta: { mode: "LIST" }
      };
    }
  );

  // ✅ 3) 私有：搜尋（widget 內 callTool 用）
  mcp.registerTool(
    "search_videos",
    {
      title: "Search videos",
      inputSchema: searchSchema,
      securitySchemes: NOAUTH,
      _meta: baseMeta({
        "openai/visibility": "private"
      })
    },
    async ({ query, limit }) => {
      const L = limit ?? 30;
      const idx = await getIndexCached(500);
      const q = query.toLowerCase();

      const videos = (idx.videos || [])
        .filter(v => String(v.title || "").toLowerCase().includes(q))
        .slice(0, L)
        .map(normalize)
        .map(v => ({
          ...v,
          thumbnailUrl: v.videoId ? `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg` : ""
        }));

      return {
        content: [],
        structuredContent: {
          channelTitle: String(idx.channelTitle || ""),
          fetchedAt: String(idx.fetchedAt || ""),
          query,
          videos
        },
        _meta: { mode: "SEARCH" }
      };
    }
  );
}
