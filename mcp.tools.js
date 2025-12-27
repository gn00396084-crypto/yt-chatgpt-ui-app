// mcp.tools.js — tools for list/search videos (includes thumbnailUrl)

import { z } from "zod";

function textResult(obj) {
  return {
    content: [
      {
        type: "text",
        text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2)
      }
    ]
  };
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
  const base = env.CF_WORKER_BASE_URL;
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
  return { ...data, videos };
}

export function registerTools(mcp, env) {
  mcp.tool(
    "list_videos",
    "List channel videos (default 3) with cursor pagination.",
    {
      cursor: z.number().int().min(0).optional().default(0),
      pageSize: z.number().int().min(1).max(20).optional().default(3),
      sort: z.enum(["newest", "oldest"]).optional().default("newest")
    },
    async ({ cursor = 0, pageSize = 3, sort = "newest" }) => {
      const data = await fetchIndex(env);

      const list = data.videos.slice();
      list.sort((a, b) => {
        const ta = Date.parse(a.publishedAt || 0) || 0;
        const tb = Date.parse(b.publishedAt || 0) || 0;
        return sort === "oldest" ? ta - tb : tb - ta;
      });

      const items = list.slice(cursor, cursor + pageSize);
      const nextCursor = cursor + pageSize < list.length ? cursor + pageSize : null;

      return textResult({
        ok: true,
        mode: "list_videos",
        total: list.length,
        cursor,
        nextCursor,
        items: items.map(v => ({
          videoId: v.videoId,
          title: v.title,
          url: v.url,
          publishedAt: v.publishedAt,
          description: v.description ?? "",
          tags: v.tags ?? [],
          thumbnailUrl: v.thumbnailUrl ?? ""
        }))
      });
    }
  );

  mcp.tool(
    "search_videos",
    "Search videos by keyword across title/description/tags. Default returns 3, cursor pagination.",
    {
      q: z.string().min(1),
      cursor: z.number().int().min(0).optional().default(0),
      pageSize: z.number().int().min(1).max(20).optional().default(3)
    },
    async ({ q, cursor = 0, pageSize = 3 }) => {
      const data = await fetchIndex(env);

      const matches = data.videos
        .map(v => ({ v, s: scoreVideo(v, q) }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .map(x => x.v);

      const items = matches.slice(cursor, cursor + pageSize);
      const nextCursor = cursor + pageSize < matches.length ? cursor + pageSize : null;

      return textResult({
        ok: true,
        mode: "search_videos",
        q,
        totalMatches: matches.length,
        cursor,
        nextCursor,
        items: items.map(v => ({
          videoId: v.videoId,
          title: v.title,
          url: v.url,
          publishedAt: v.publishedAt,
          description: v.description ?? "",
          tags: v.tags ?? [],
          thumbnailUrl: v.thumbnailUrl ?? ""
        }))
      });
    }
  );
}
