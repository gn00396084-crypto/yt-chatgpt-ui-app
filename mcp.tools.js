import { z } from "zod";
import { WIDGET_URI } from "./mcp.resources.js";
import { makeWorkerClient } from "./worker.client.js";

export function registerTools(mcp, env) {
  const { fetchIndex, normalize } = makeWorkerClient(env);

  const NOAUTH = [{ type: "noauth" }];

  const emptySchema = z.object({}).strict();

  // ✅ 分頁參數：limit + offset
  const listSchema = z.object({
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).max(5000).optional()
  }).strict();

  const searchSchema = z.object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).max(5000).optional()
  }).strict();

  // ✅ 入口工具：綁 template（outputTemplate）
  const entryMeta = (extra = {}) => ({
    "openai/outputTemplate": WIDGET_URI,
    "openai/widgetAccessible": true,
    ...extra
  });

  // ✅ widget-only 工具：不綁 template（避免 hidden-tool template 問題）
  const widgetOnlyMeta = (extra = {}) => ({
    "openai/widgetAccessible": true,
    "openai/visibility": "private",
    ...extra
  });

  // cache to avoid frequent worker fetch
  let cache = { ts: 0, idx: null };
  async function getIndexCached(limit = 500) {
    const now = Date.now();
    if (cache.idx && (now - cache.ts) < 60_000) return cache.idx;
    const idx = await fetchIndex(limit);
    cache = { ts: now, idx };
    return idx;
  }

  function enrichVideo(v, channelTitle) {
    const base = normalize(v);
    const videoId = base.videoId;
    return {
      videoId,
      title: base.title,
      url: base.url,
      publishedAt: base.publishedAt,
      channelTitle: String(channelTitle || ""),
      thumbnailUrl: videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : ""
    };
  }

  // ---------------- Public entry tool ----------------
  mcp.registerTool(
    "youtube_finder",
    {
      title: "Open YouTube Finder",
      description: "Open the YouTube Finder widget.",
      inputSchema: emptySchema,
      securitySchemes: NOAUTH,
      _meta: entryMeta({
        "openai/toolInvocation/invoking": "正在打開 YouTube Finder…",
        "openai/toolInvocation/invoked": "YouTube Finder 已開啟。"
      })
    },
    async () => ({
      content: [{ type: "text", text: "YouTube Finder opened." }],
      structuredContent: { ready: true },
      _meta: { mode: "OPEN" }
    })
  );

  // ---------------- Hidden widget tools (paged) ----------------
  mcp.registerTool(
    "list_videos",
    {
      title: "List Videos",
      inputSchema: listSchema,
      securitySchemes: NOAUTH,
      _meta: widgetOnlyMeta()
    },
    async ({ limit, offset }) => {
      const L = limit ?? 3;
      const O = offset ?? 0;

      const idx = await getIndexCached(500);
      const channelTitle = String(idx.channelTitle || "");

      const all = (idx.videos || []).map(v => enrichVideo(v, channelTitle)).filter(v => v.videoId);
      const total = all.length;

      const start = Math.min(Math.max(0, O), total);
      const end = Math.min(start + L, total);
      const page = all.slice(start, end);

      return {
        content: [],
        structuredContent: {
          channelTitle,
          fetchedAt: String(idx.fetchedAt || ""),
          query: "",
          offset: start,
          limit: L,
          total,
          videos: page
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
      _meta: widgetOnlyMeta()
    },
    async ({ query, limit, offset }) => {
      const L = limit ?? 3;
      const O = offset ?? 0;

      const idx = await getIndexCached(500);
      const channelTitle = String(idx.channelTitle || "");
      const q = query.toLowerCase();

      const filtered = (idx.videos || [])
        .filter(v => String(v.title || "").toLowerCase().includes(q))
        .map(v => enrichVideo(v, channelTitle))
        .filter(v => v.videoId);

      const total = filtered.length;
      const start = Math.min(Math.max(0, O), total);
      const end = Math.min(start + L, total);
      const page = filtered.slice(start, end);

      return {
        content: [],
        structuredContent: {
          channelTitle,
          fetchedAt: String(idx.fetchedAt || ""),
          query,
          offset: start,
          limit: L,
          total,
          videos: page
        },
        _meta: { mode: "SEARCH", query }
      };
    }
  );
}
