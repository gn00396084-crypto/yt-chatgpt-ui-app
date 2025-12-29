import { WIDGET_URI } from "./mcp.resources.js";

function toolDescriptorMeta() {
  return {
    "openai/outputTemplate": WIDGET_URI,
    "openai/widgetAccessible": true,
    "openai/visibility": "public",
    "openai/toolInvocation/invoking": "處理中…",
    "openai/toolInvocation/invoked": "完成",
  };
}

// ✅ tool response 也回 outputTemplate：避免只顯示工具卡
function toolResponseMeta() {
  return { "openai/outputTemplate": WIDGET_URI };
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

// 把 query 拆 token + 心情同義擴展（支援「失戀歌單」「失戀 歌單」）
function tokenizeQuery(q) {
  const raw = (q || "").toString().trim();
  if (!raw) return [];

  // 基礎切詞：空白/符號
  const baseTokens = raw
    .split(/[\s/|,，。.!?！？、:：;；（）()【】\[\]-]+/g)
    .map((t) => t.trim())
    .filter(Boolean);

  const MOOD = {
    失戀: ["分手", "心碎", "眼淚", "遺憾", "告別", "孤單", "想念", "離開", "失去"],
    療癒: ["治癒", "溫柔", "放鬆", "安慰", "擁抱", "晚安", "陪伴"],
    開車: ["行車", "兜風", "夜景", "公路", "駕駛"],
    睡前: ["晚安", "夜深", "靜", "放鬆", "陪伴"],
  };

  const tokens = new Set();

  // 原始 tokens
  for (const t of baseTokens) tokens.add(norm(t));

  // raw 直接包含 mood key（例如「失戀歌單」）也觸發擴展
  for (const k of Object.keys(MOOD)) {
    if (raw.includes(k)) {
      tokens.add(norm(k));
      for (const t of MOOD[k]) tokens.add(norm(t));
    }
  }

  return [...tokens].filter(Boolean);
}

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
    if (tags.some((t) => t.includes(tok))) s += 4;
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
    throw new Error(`Index fetch failed: ${res.status} ${text.slice(0, 300)}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Index returned non-JSON: ${text.slice(0, 300)}`);
  }

  const videos = Array.isArray(data?.videos) ? data.videos : [];
  const normalized = videos.map((v) => ({
    ...v,
    description: v.description ?? "",
    tags: Array.isArray(v.tags) ? v.tags : [],
    thumbnailUrl: fallbackThumb(v.videoId, v.thumbnailUrl),
  }));

  return { ...data, videos: normalized };
}

const intSchema = (min, max, def) => ({
  type: "integer",
  minimum: min,
  ...(typeof max === "number" ? { maximum: max } : {}),
  ...(typeof def === "number" ? { default: def } : {}),
});

function errorResult(mode, message, extra = {}) {
  return {
    _meta: toolResponseMeta(),
    structuredContent: { mode, error: message, ...extra },
    content: [{ type: "text", text: `⚠ ${message}` }],
  };
}

export function registerTools(mcp, env) {
  // 最新一首
  mcp.registerTool(
    "latest_song",
    {
      title: "最新歌",
      description: "取得頻道最新上架的一首影片（含縮圖/描述/tags）。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      _meta: toolDescriptorMeta(),
    },
    async () => {
      try {
        const data = await fetchIndex(env);

        const list = data.videos.slice().sort((a, b) => {
          const ta = Date.parse(a.publishedAt || 0) || 0;
          const tb = Date.parse(b.publishedAt || 0) || 0;
          return tb - ta;
        });

        const item = list[0] || null;

        if (!item) {
          return {
            _meta: toolResponseMeta(),
            structuredContent: {
              mode: "latest_song",
              channelTitle: data.channelTitle,
              item: null,
            },
            content: [{ type: "text", text: "找不到影片（index 為空）" }],
          };
        }

        const thumb = fallbackThumb(item.videoId, item.thumbnailUrl);

        return {
          _meta: toolResponseMeta(),
          structuredContent: {
            mode: "latest_song",
            channelTitle: data.channelTitle,
            item: { ...item, thumbnailUrl: thumb },
          },
          content: [
            {
              type: "text",
              text:
                `![thumb](${thumb})\n\n` +
                `🎵 **新歌（目前最新一首）**：\n\n` +
                `${item.title}\n` +
                `📅 上架：${(item.publishedAt || "").slice(0, 10)}\n` +
                `▶️ YouTube：${item.url}`,
            },
          ],
        };
      } catch (e) {
        return errorResult("latest_song", e?.message || String(e));
      }
    }
  );

  // 清單
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
          sort: { type: "string", enum: ["newest", "oldest"], default: "newest" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      _meta: toolDescriptorMeta(),
    },
    async ({ cursor = 0, pageSize = 3, sort = "newest" } = {}) => {
      try {
        const data = await fetchIndex(env);

        const list = data.videos.slice().sort((a, b) => {
          const ta = Date.parse(a.publishedAt || 0) || 0;
          const tb = Date.parse(b.publishedAt || 0) || 0;
          return sort === "oldest" ? ta - tb : tb - ta;
        });

        const items = list.slice(cursor, cursor + pageSize);
        const nextCursor = cursor + pageSize < list.length ? cursor + pageSize : null;

        return {
          _meta: toolResponseMeta(),
          structuredContent: {
            mode: "list_videos",
            channelTitle: data.channelTitle,
            total: list.length,
            cursor,
            nextCursor,
            pageSize,
            items,
          },
          content: [{ type: "text", text: `列出影片：${items.length} / ${list.length}` }],
        };
      } catch (e) {
        return errorResult("list_videos", e?.message || String(e), { cursor, pageSize, sort });
      }
    }
  );

  // 搜尋（token + mood 擴展；0 命中會 fallback 顯示最新）
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
          pageSize: intSchema(1, 20, 3),
        },
        required: ["q"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      _meta: toolDescriptorMeta(),
    },
    async ({ q, cursor = 0, pageSize = 3 } = {}) => {
      try {
        const data = await fetchIndex(env);

        const scored = data.videos.map((v) => ({ v, s: scoreVideo(v, q) }));

        // 命中結果（s>0）
        let matches = scored
          .filter((x) => x.s > 0)
          .sort((a, b) => {
            if (b.s !== a.s) return b.s - a.s;
            const ta = Date.parse(a.v.publishedAt || 0) || 0;
            const tb = Date.parse(b.v.publishedAt || 0) || 0;
            return tb - ta; // 同分新片優先
          })
          .map((x) => x.v);

        const tokens = tokenizeQuery(q);
        let fallback = false;

        // ✅ 0 命中 → fallback 顯示最新
        if (matches.length === 0) {
          fallback = true;
          matches = data.videos.slice().sort((a, b) => {
            const ta = Date.parse(a.publishedAt || 0) || 0;
            const tb = Date.parse(b.publishedAt || 0) || 0;
            return tb - ta;
          });
        }

        const items = matches.slice(cursor, cursor + pageSize);
        const nextCursor = cursor + pageSize < matches.length ? cursor + pageSize : null;

        return {
          _meta: toolResponseMeta(),
          structuredContent: {
            mode: "search_videos",
            channelTitle: data.channelTitle,
            q,
            tokens,
            fallback,
            totalMatches: fallback ? 0 : matches.length, // 真正命中數（fallback 時保持 0）
            cursor,
            nextCursor,
            pageSize,
            items,
          },
          content: [
            {
              type: "text",
              text: fallback
                ? `搜尋「${q}」：0 命中（已改顯示最新 ${items.length} 筆作參考）`
                : `搜尋「${q}」：${items.length} / ${matches.length}`,
            },
          ],
        };
      } catch (e) {
        return errorResult("search_videos", e?.message || String(e), { q, cursor, pageSize });
      }
    }
  );
}
