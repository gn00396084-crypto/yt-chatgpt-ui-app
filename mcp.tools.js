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

// 把 query 拆成多個 token，並做「心情詞」同義擴展
function tokenizeQuery(q) {
  const s = (q || "").toString().trim();
  if (!s) return [];

  // 以空白/常見符號切詞（支援「失戀 歌單」這種）
  const baseTokens = s
    .split(/[\s/|,，。.!?！？、:：;；（）()【】\[\]-]+/g)
    .map(t => t.trim())
    .filter(Boolean);

  // 心情詞擴展（可自行增刪）
  const MOOD = {
    "失戀": ["分手", "心碎", "眼淚", "遺憾", "告別", "孤單", "想念", "離開", "失去"],
    "療癒": ["治癒", "溫柔", "放鬆", "安慰", "擁抱", "晚安", "陪伴"],
    "開車": ["開車", "行車", "兜風", "夜景", "公路"],
    "睡前": ["睡前", "晚安", "夜深", "靜", "放鬆"]
  };

  const tokens = new Set();

  // 原始 tokens
  for (const t of baseTokens) tokens.add(norm(t));

  // query 本身包含心情詞時也觸發擴展（例如「失戀歌單」沒空白也能吃到）
  for (const k of Object.keys(MOOD)) {
    if (s.includes(k)) {
      tokens.add(norm(k));
      for (const t of MOOD[k]) tokens.add(norm(t));
    }
  }

  return [...tokens].filter(Boolean);
}

// 依 tokens 計分（title > tags > description），分數越高越相關
function scoreVideo(v, q) {
  const tokens = tokenizeQuery(q);
  if (!tokens.length) return 0;

  const title = norm(v.title);
  const desc = norm(v.description);
  const tags = Array.isArray(v.tags) ? v.tags.map(norm) : [];

  let s = 0;
  for (const tok of tokens) {
    if (!tok) continue;
    if (title.includes(tok)) s += 8;
    if (tags.some(t => t.includes(tok))) s += 4;
    if (desc.includes(tok)) s += 1;
  }

  return s;
}

async function fetchIndex(env) {
  const base = env?.CF_WORKER_BASE_URL;
  if (!base) throw new Error("Missing env.CF_WORKER_BASE_URL");

  const url = `${base.replace(/\/+$/, "")}/my-channel/videos`;
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

  const videos = Array.isArray(data?.videos) ? data.videos : [];
  const normalized = videos.map(v => ({
    ...v,
    description: v.description ?? "",
    tags: Array.isArray(v.tags) ? v.tags : [],
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
  // ✅ 最新一首（文字也顯示縮圖）
  mcp.registerTool(
    "latest_song",
    {
      title: "最新歌",
      description: "取得頻道最新上架的一首影片（含縮圖/描述/tags）。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
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

      if (!item) {
        return {
          structuredContent: { mode: "latest_song", channelTitle: data.channelTitle, item: null },
          content: [{ type: "text", text: "找不到影片（index 為空）" }]
        };
      }

      const thumb = fallbackThumb(item.videoId, item.thumbnailUrl);

      return {
        structuredContent: {
          mode: "latest_song",
          channelTitle: data.channelTitle,
          item: { ...item, thumbnailUrl: thumb }
        },
        // ✅ 這行讓「文字結果」也會顯示縮圖（Markdown image）
        content: [
          {
            type: "text",
            text:
              `![thumb](${thumb})\n\n` +
              `🎵 **新歌（目前最新一首）**是：\n\n` +
              `${item.title}\n` +
              `📅 上架時間：${(item.publishedAt || "").slice(0, 10)}\n` +
              `▶️ YouTube：${item.url}`
          }
        ]
      };
    }
  );

  // ✅ 列出影片（structuredContent 給 widget 用；文字簡短即可）
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

  // ✅ 搜尋影片（structuredContent 給 widget 用）
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
        // 分數優先；同分新片優先
        .sort((a, b) => {
          if (b.s !== a.s) return b.s - a.s;
          const ta = Date.parse(a.v.publishedAt || 0) || 0;
          const tb = Date.parse(b.v.publishedAt || 0) || 0;
          return tb - ta;
        })
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
