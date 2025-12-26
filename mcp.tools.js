import { z } from "zod";
import { WIDGET_URI } from "./mcp.resources.js";
import { makeWorkerClient } from "./worker.client.js";

export function registerTools(mcp, env) {
  const { fetchIndex, normalize } = makeWorkerClient(env);

  const NOAUTH = [{ type: "noauth" }];

  const emptySchema = z.object({}).strict();
  const listSchema = z.object({
    limit: z.number().int().min(1).max(500).optional()
  }).strict();
  const searchSchema = z.object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(200).optional()
  }).strict();

  // ✅ 入口工具：綁 template（outputTemplate）
  const entryMeta = (extra = {}) => ({
    securitySchemes: NOAUTH,               // mirror
    "openai/outputTemplate": WIDGET_URI,   // ✅ only here
    "openai/widgetAccessible": true,
    ...extra
  });

  // ✅ widget-only 工具：不綁 template（避免「hidden tool 綁 template」導致 template 不可用）
  const widgetOnlyMeta = (extra = {}) => ({
    securitySchemes: NOAUTH,               // mirror
    "openai/widgetAccessible": true,
    "openai/visibility": "private",
    ...extra
  });

  // simple cache to avoid frequent worker fetch
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

  // ---------------- Hidden widget tools (NO outputTemplate) ----------------
  mcp.registerTool(
    "list_videos",
    {
      title: "List Videos",
      inputSchema: listSchema,
      securitySchemes: NOAUTH,
      _meta: widgetOnlyMeta()
    },
    async ({ limit }) => {
      const L = limit ?? 30;
      const idx = await getIndexCached(500);
      const channelTitle = String(idx.channelTitle || "");

      const videos = (idx.videos || [])
        .slice(0, L)
        .map(v => enrichVideo(v, channelTitle))
        .filter(v => v.videoId);

      return {
        content: [],
        structuredContent: {
          channelTitle,
          fetchedAt: String(idx.fetchedAt || ""),
          query: "",
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
      _meta: widgetOnlyMeta()
    },
    async ({ query, limit }) => {
      const L = limit ?? 30;
      const idx = await getIndexCached(500);
      const channelTitle = String(idx.channelTitle || "");
      const q = query.toLowerCase();

      const videos = (idx.videos || [])
        .filter(v => String(v.title || "").toLowerCase().includes(q))
        .slice(0, L)
        .map(v => enrichVideo(v, channelTitle))
        .filter(v => v.videoId);

      return {
        content: [],
        structuredContent: {
          channelTitle,
          fetchedAt: String(idx.fetchedAt || ""),
          query,
          videos
        },
        _meta: { mode: "SEARCH", query }
      };
    }
  );
}
