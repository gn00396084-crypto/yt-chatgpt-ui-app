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
  if (tags.some((t) => t.includes(qq))) s += 4;
  if (desc.includes(qq)) s += 1;
  return s;
}

function escapeMd(s = "") {
  return String(s).replace(/[\[\]\(\)]/g, "\\$&");
}

function formatTitleMd(title = "") {
  const t = String(title);
  const seps = [" – ", " - ", " — "];
  for (const sep of seps) {
    const i = t.indexOf(sep);
    if (i > -1) {
      const left = t.slice(0, i + sep.length);
      const right = t.slice(i + sep.length);
      if (right.trim()) return `${escapeMd(left)}_${escapeMd(right)}_`;
    }
  }
  return escapeMd(t);
}

function mdThumbsAndLinks(items, heading) {
  if (!items || !items.length) return `${heading}\n\n（沒有資料）`.trim();
  const top = items.slice(0, 2);
  const imgs = top.map((v) => `![${escapeMd(v.title || "thumb")}](${v.thumbnailUrl || ""})`).join(" ");
  const links = items
    .map((v) => `- [${formatTitleMd(v.title || "Untitled")}](${v.url || ""})`)
    .join("\n");
  return `${heading}\n\n${imgs}\n\n${links}`.trim();
}

// ✅ 兼容你 Worker 可能回傳的不同 key：videos / items / data.items / data.videos
function pickRawList(data) {
  if (Array.isArray(data?.videos)) return data.videos;
  if (Array.isArray(data?.items)) return data.items;

  if (data?.data && typeof data.data === "object") {
    if (Array.isArray(data.data.videos)) return data.data.videos;
    if (Array.isArray(data.data.items)) return data.data.items;
  }

  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.result)) return data.result;

  return [];
}

function normalizeVideo(v) {
  const videoId =
    v?.videoId ||
    v?.id?.videoId ||
    v?.id ||
    v?.video_id ||
    v?.snippet?.resourceId?.videoId ||
    "";

  const title = v?.title || v?.snippet?.title || "";
  const description = v?.description ?? v?.snippet?.description ?? "";
  const publishedAt = v?.publishedAt || v?.snippet?.publishedAt || "";

  const tags =
    (Array.isArray(v?.tags) ? v.tags : null) ||
    (Array.isArray(v?.snippet?.tags) ? v.snippet.tags : null) ||
    [];

  const thumbnailUrl =
    v?.thumbnailUrl ||
    v?.thumbnail ||
    v?.snippet?.thumbnails?.high?.url ||
    v?.snippet?.thumbnails?.medium?.url ||
    v?.snippet?.thumbnails?.default?.url ||
    "";

  const url = v?.url || "";

  return {
    videoId: String(videoId || ""),
    title: String(title || ""),
    description: String(description || ""),
    publishedAt: String(publishedAt || ""),
    tags: Array.isArray(tags) ? tags.map(String) : [],
    thumbnailUrl: fallbackThumb(videoId, thumbnailUrl),
    url: fallbackUrl(videoId, url),
  };
}

async function fetchIndex(env) {
  const base = env?.CF_WORKER_BASE_URL;
  if (!base) throw new Error("Missing env.CF_WORKER_BASE_URL");

  const url = `${String(base).replace(/\/+$/, "")}/my-channel/videos`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Index fetch failed: ${res.status} ${text.slice(0, 200)}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Index returned non-JSON: ${text.slice(0, 200)}`);
  }

  const rawList = pickRawList(data);
  const videos = rawList.map(normalizeVideo);

  const channelTitle =
    data?.channelTitle ||
    data?.channel?.title ||
    data?.meta?.channelTitle ||
    "";

  return {
    ...data,
    channelTitle,
    videos,
    _debug: { keys: Object.keys(data || {}), rawCount: rawList.length },
  };
}

async function safeFetchIndex(env) {
  try {
    const data = await fetchIndex(env);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

function errorToolReturn(mode, msg) {
  return {
    structuredContent: { mode, error: msg },
    content: [
      {
        type: "text",
        text:
          "目前抓取頻道資料失敗。\n\n" +
          `錯誤：${msg}\n\n` +
          "請檢查：\n" +
          "- CF_WORKER_BASE_URL 是否正確\n" +
          "- /my-channel/videos 是否真的回 JSON（不是 HTML/403/500）",
      },
    ],
  };
}

function emptyToolReturn(mode, data) {
  const dbg = data?._debug;
  return {
    structuredContent: { mode, channelTitle: data?.channelTitle || "", total: 0, items: [], debug: dbg },
    content: [
      {
        type: "text",
        text:
          "抓到資料但影片清單為空。\n\n" +
          "請把 /my-channel/videos 的回傳 JSON（前 30 行）貼給我，我可以再精準對應你的結構。\n\n" +
          `debug keys=${JSON.stringify(dbg?.keys || [])}, rawCount=${dbg?.rawCount ?? "?"}`,
      },
    ],
  };
}

// Zod schemas
const LatestSongInput = z.object({}).strict();

const ListVideosInput = z
  .object({
    cursor: z.number().int().min(0).default(0),
    pageSize: z.number().int().min(1).max(20).default(3),
    sort: z.enum(["newest", "oldest"]).default("newest"),
  })
  .strict();

const SearchVideosInput = z
  .object({
    q: z.string().min(1),
    cursor: z.number().int().min(0).default(0),
    pageSize: z.number().int().min(1).max(20).default(3),
  })
  .strict();

export function registerTools(mcp, env) {
  mcp.registerTool(
    "latest_song",
    {
      title: "最新歌",
      description: "取得頻道最新上架的一首影片（含縮圖/描述/tags）。",
      inputSchema: LatestSongInput,
      annotations: { readOnlyHint: true },
      _meta: toolMeta(),
    },
    async () => {
      const r = await safeFetchIndex(env);
      if (!r.ok) return errorToolReturn("latest_song", r.error);

      const data = r.data;
      if (!data.videos.length) return emptyToolReturn("latest_song", data);

      const list = data.videos.slice().sort((a, b) => {
        const ta = Date.parse(a.publishedAt || 0) || 0;
        const tb = Date.parse(b.publishedAt || 0) || 0;
        return tb - ta;
      });

      const item = list[0] || null;
      if (!item) return emptyToolReturn("latest_song", data);

      const thumb = fallbackThumb(item.videoId, item.thumbnailUrl);
      const url = fallbackUrl(item.videoId, item.url);

      return {
        structuredContent: {
          mode: "latest_song",
          channelTitle: data.channelTitle,
          item: { ...item, thumbnailUrl: thumb, url },
        },
        content: [
          {
            type: "text",
            text:
              `![thumb](${thumb})\n\n` +
              `🎵 **新歌（目前最新一首）**\n\n` +
              `- [${formatTitleMd(item.title || "")}](${url})\n` +
              `- 上架時間：${(item.publishedAt || "").slice(0, 10)}`,
          },
        ],
      };
    }
  );

  mcp.registerTool(
    "list_videos",
    {
      title: "列出影片",
      description: "列出頻道影片（預設 3 筆），支援 cursor 分頁。",
      inputSchema: ListVideosInput,
      annotations: { readOnlyHint: true },
      _meta: toolMeta(),
    },
    async ({ cursor, pageSize, sort }) => {
      const r = await safeFetchIndex(env);
      if (!r.ok) return errorToolReturn("list_videos", r.error);

      const data = r.data;
      if (!data.videos.length) return emptyToolReturn("list_videos", data);

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
          items,
        },
        content: [
          {
            type: "text",
            text: mdThumbsAndLinks(items, `🎧 **${escapeMd(data.channelTitle || "影片清單")}**`),
          },
        ],
      };
    }
  );

  mcp.registerTool(
    "search_videos",
    {
      title: "搜尋影片",
      description: "用關鍵字搜尋（title/description/tags），預設回 3 筆，支援 cursor 分頁。",
      inputSchema: SearchVideosInput,
      annotations: { readOnlyHint: true },
      _meta: toolMeta(),
    },
    async ({ q, cursor, pageSize }) => {
      const r = await safeFetchIndex(env);
      if (!r.ok) return errorToolReturn("search_videos", r.error);

      const data = r.data;
      if (!data.videos.length) return emptyToolReturn("search_videos", data);

      const matches = data.videos
        .map((v) => ({ v, s: scoreVideo(v, q) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.v);

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
          items,
        },
        content: [{ type: "text", text: mdThumbsAndLinks(items, `🎧 **搜尋：${escapeMd(q)}**`) }],
      };
    }
  );
}
