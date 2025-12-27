// mcp.tools.js — 方案1：outputTemplate + structuredContent（支援 widget + 縮圖）

import { WIDGET_URI } from "./mcp.resources.js";

function toolMeta() {
  return {
    "openai/outputTemplate": WIDGET_URI,
    "openai/widgetAccessible": true,
    "openai/visibility": "public",
    "openai/toolInvocation/invoking": "處理中…",
    "openai/toolInvocation/invoked": "完成"
  };
}

function fallbackThumb(videoId, thumbnailUrl) {
  return (
    thumbnailUrl ||
    (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "")
  );
}

function norm(s) {
  return (s || "").toString().toLowerCase().trim();
}

function scoreVideo(v, q) {
  const qq = norm(q);
  if (!qq) return 0;

  const title = norm(v.title);
  const desc = norm(v.description);
  const tags = Array.isArray(v.tags) ? v.tags.map(norm) : [];

  let s = 0;
  if (title.includes(qq)) s += 8;
  if (tags.some(t => t.includes(qq))) s += 4;
  if (desc.includes(qq)) s += 1;
  return s;
}

async function fetchIndex(env) {
  const base = env?.CF_WORKER_BASE_URL;
  if (!base) throw new Error("Missing env.CF_WORKER_BASE_URL");

  const url = `${base.replace(/\/+$/, "")}/my-channel/videos`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await res.text();

  if (!res.ok) throw new Error(`Index fetch failed: ${res.status} ${text.slice(0, 200)}`);

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Index returned non-JSON: ${text.slice(0, 200)}`);
  }

  const videos = Array.isArray(data?.videos) ? data.videos : [];
  // 保底：就算 Worker 仲未有 thumbnailUrl，仍然給 widget 顯示 fallback
  const normalized = videos.map(v => ({
    ...v,
    tags: Array.isArray(v.tags) ? v.tags : [],
    description: v.description ?? "",
    thumbnailUrl: fallbackThumb(v.videoId, v.thumbnailUrl)
  }));

  return { ...data, videos: normalized };
}

const intSchema = (min, max, def) => ({
  type: "integer",
  minimum: min,
  ...(typeof max === "number" ? { maximum: max } : {}),
  ...(typeof def === "number" ? { default: def } : {})
});

export function registerTools(mcp, env) {
  // 最新一首
  mcp.registerTool(
    "latest_song",
    {
      title: "最新歌",
      description: "取得頻道最新上架的一首影片（含縮圖/描述/tags）。",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false
      },
      annotations: { readOnlyHint: true },
      _meta: toolMeta()
    },
    async () => {
      const data = await fetchIndex(env);
      const list = data.videos.slice().sort((a, b) => {
        const ta = Date.parse(a.publishedAt || 0) || 0;
        const tb = Date.parse(b.publishedAt || 0) || 0;
        return tb - ta;
      });

      const item = list[0] || null;

      return {
        structuredContent: {
          mode: "latest_song",
          channelTitle: data.channelTitle,
          item
        },
        content: [
          {
            type: "text",
            text: item
              ? `最新一首：${item.title}\n上架：${item.publishedAt?.slice(0, 10) || ""}\nYouTube: ${item.url}`
              : "找不到影片（index 為空）"
          }
        ]
      };
    }
  );

  // 列表（分頁）
  mcp.registerTool(
    "list_videos",
    {
      title: "列出影片",
      description: "列出頻道影片（預設 3 筆），支援 cursor 分頁。",
      inputSchema: {
        type: "object",
        properties: {
          cursor: intSchema(0, undefined, 0),
          pageSize: intSchema(1, 20, 3),
          sort: { type: "string", enum: ["newest", "oldest"], default: "newest" }
        },
        additionalProperties: false
      },
      annotations: { readOnlyHint: true },
      _meta: toolMeta()
    },
    async ({ cursor = 0, pageSize = 3, sort = "newest" } = {}) => {
      const data = await fetchIndex(env);

      const list = data.videos.slice().sort((a, b) => {
        const ta = Date.parse(a.publishedAt || 0) || 0;
        const tb = Date.parse(b.publishedAt || 0) || 0;
        return sort === "oldest" ? ta - tb : tb - ta;
      });

      const items = list.slice(cursor, cursor + pageSize);
      const nextCursor = cursor + pageSize < list.length ? cursor + pageSize : null;

      return {
        structuredContent: {
          mode: "list_videos",
          channelTitle: data.channelTitle,
          total: list.length,
          cursor,
          nextCursor,
          pageSize,
          items
        },
        content: [{ type: "text", text: `列出影片：${items.length} / ${list.length}` }]
      };
    }
  );

  // 搜尋
  mcp.registerTool(
    "search_videos",
    {
      title: "搜尋影片",
      description: "用關鍵字搜尋（title/description/tags），預設回 3 筆，支援 cursor 分頁。",
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string", minLength: 1 },
          cursor: intSchema(0, undefined, 0),
          pageSize: intSchema(1, 20, 3)
        },
        required: ["q"],
        additionalProperties: false
      },
      annotations: { readOnlyHint: true },
      _meta: toolMeta()
    },
    async ({ q, cursor = 0, pageSize = 3 } = {}) => {
      const data = await fetchIndex(env);

      const matches = data.videos
        .map(v => ({ v, s: scoreVideo(v, q) }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .map(x => x.v);

      const items = matches.slice(cursor, cursor + pageSize);
      const nextCursor = cursor + pageSize < matches.length ? cursor + pageSize : null;

      return {
        structuredContent: {
          mode: "search_videos",
          channelTitle: data.channelTitle,
          q,
          totalMatches: matches.length,
          cursor,
          nextCursor,
          pageSize,
          items
        },
        content: [{ type: "text", text: `搜尋「${q}」：${items.length} / ${matches.length}` }]
      };
    }
  );
}
