// mcp.tools.js
import { z } from "zod";
import { WIDGET_URI } from "./mcp.resources.js";

function toolMeta() {
  return {
    "openai/outputTemplate": WIDGET_URI,
    "openai/widgetAccessible": true,
    "openai/visibility": "public",
    "openai/toolInvocation/invoking": "處理中…",
    "openai/toolInvocation/invoked": "完成",
  };
}

function fallbackThumb(videoId, thumbnailUrl) {
  return thumbnailUrl || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "");
}

function fallbackUrl(videoId, url) {
  return url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "");
}

function asVideoItem(v) {
  return {
    videoId: String(v.videoId || ""),
    title: String(v.title || ""),
    description: String(v.description || ""),
    url: fallbackUrl(v.videoId, v.url),
    thumbnailUrl: fallbackThumb(v.videoId, v.thumbnailUrl),
    publishedAt: v.publishedAt ? String(v.publishedAt) : "",
    tags: Array.isArray(v.tags) ? v.tags.map(String) : [],
  };
}

function mdThumbsAndLinks(items, title = "Chill / 夜深聽") {
  const top = items.slice(0, 2);
  const links = items.slice(0, 8);

  const imgs = top
    .map(i => `![thumb](${i.thumbnailUrl})`)
    .join("\n\n");

  const bullets = links
    .map(i => `- [${i.title}](${i.url})`)
    .join("\n");

  return `## 🎧 ${title}\n\n${imgs}\n\n${bullets}`;
}

const ListVideosInput = z
  .object({
    cursor: z.number().int().min(0).default(0),
    pageSize: z.number().int().min(1).max(50).default(3),
    sort: z.enum(["newest", "oldest"]).default("newest"),
  })
  .strict();

const SearchVideosInput = z
  .object({
    q: z.string().min(1),
    cursor: z.number().int().min(0).default(0),
    pageSize: z.number().int().min(1).max(50).default(3),
  })
  .strict();

const LatestSongInput = z.object({}).strict();

async function fetchIndex(CF_WORKER_BASE_URL) {
  const url = new URL(`${CF_WORKER_BASE_URL}/my-channel/videos`);
  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0",
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Worker error ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function searchIn(v, q) {
  const s = q.toLowerCase();
  const hay = [
    v.title || "",
    v.description || "",
    ...(Array.isArray(v.tags) ? v.tags : []),
  ].join(" ").toLowerCase();
  return hay.includes(s);
}

export function registerTools(mcp, { CF_WORKER_BASE_URL }) {
  mcp.registerTool(
    "list_videos",
    {
      title: "列出影片",
      description: "列出頻道影片（帶縮圖與連結），支援分頁。",
      inputSchema: ListVideosInput,
      annotations: { readOnlyHint: true },
      _meta: toolMeta(),
    },
    async ({ cursor, pageSize, sort }) => {
      const all = await fetchIndex(CF_WORKER_BASE_URL);
      const items = (all?.items || []).map(asVideoItem);

      const ordered = sort === "oldest" ? items : [...items].reverse();
      const slice = ordered.slice(cursor, cursor + pageSize);

      const nextCursor = cursor + pageSize < ordered.length ? cursor + pageSize : null;

      return {
        structuredContent: {
          mode: "list_videos",
          cursor,
          pageSize,
          sort,
          total: ordered.length,
          nextCursor,
          items: slice,
          markdown: mdThumbsAndLinks(slice),
        },
        content: [{ type: "text", text: mdThumbsAndLinks(slice) }],
      };
    }
  );

  mcp.registerTool(
    "search_videos",
    {
      title: "搜尋影片",
      description: "用關鍵字搜尋影片（title/desc/tags），回傳縮圖與連結。",
      inputSchema: SearchVideosInput,
      annotations: { readOnlyHint: true },
      _meta: toolMeta(),
    },
    async ({ q, cursor, pageSize }) => {
      const all = await fetchIndex(CF_WORKER_BASE_URL);
      const items = (all?.items || []).map(asVideoItem);

      const matches = items.filter(v => searchIn(v, q)).reverse();
      const slice = matches.slice(cursor, cursor + pageSize);
      const nextCursor = cursor + pageSize < matches.length ? cursor + pageSize : null;

      return {
        structuredContent: {
          mode: "search_videos",
          q,
          cursor,
          pageSize,
          totalMatches: matches.length,
          nextCursor,
          items: slice,
          markdown: mdThumbsAndLinks(slice),
        },
        content: [{ type: "text", text: mdThumbsAndLinks(slice) }],
      };
    }
  );

  mcp.registerTool(
    "latest_song",
    {
      title: "最新一首",
      description: "回傳最新一首影片（含縮圖/連結/說明）。",
      inputSchema: LatestSongInput,
      annotations: { readOnlyHint: true },
      _meta: toolMeta(),
    },
    async () => {
      const all = await fetchIndex(CF_WORKER_BASE_URL);
      const items = (all?.items || []).map(asVideoItem);
      const latest = items[items.length - 1] || null;

      return {
        structuredContent: {
          mode: "latest_song",
          item: latest,
          markdown: latest ? mdThumbsAndLinks([latest], "Latest") : "（沒有資料）",
        },
        content: [{ type: "text", text: latest ? mdThumbsAndLinks([latest], "Latest") : "（沒有資料）" }],
      };
    }
  );
}
