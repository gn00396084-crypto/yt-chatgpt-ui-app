import { z } from "zod";
import { WIDGET_URI } from "./mcp.resources.js";
import { makeWorkerClient } from "./worker.client.js";

export function registerTools(mcp, env) {
  const { fetchIndex, normalize } = makeWorkerClient(env);

  const NOAUTH = [{ type: "noauth" }];
  const emptySchema = z.object({}).strict();

  // ✅ snapshot（可選）用於「快照式分頁」
  const listSchema = z
    .object({
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).max(200000).optional(),
      snapshot: z.string().min(1).optional(),
    })
    .strict();

  const searchSchema = z
    .object({
      query: z.string().min(1),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).max(200000).optional(),
      snapshot: z.string().min(1).optional(),
    })
    .strict();

  // ✅ 入口工具：綁 template
  const entryMeta = (extra = {}) => ({
    "openai/outputTemplate": WIDGET_URI,
    "openai/widgetAccessible": true,
    ...extra,
  });

  // ✅ widget-only：不綁 template（避免 hidden tool 綁 template 令 template 不可用）
  const widgetOnlyMeta = (extra = {}) => ({
    "openai/widgetAccessible": true,
    "openai/visibility": "private",
    ...extra,
  });

  // --- snapshot store (keep a few recent snapshots) ---
  const SNAP_TTL_MS = 10 * 60 * 1000; // 10 min
  const MAX_SNAPS = 5;
  const snapStore = new Map(); // snapshot -> { idx, ts }

  function saveSnapshot(snapshot, idx) {
    const now = Date.now();
    snapStore.set(snapshot, { idx, ts: now });

    // prune expired
    for (const [k, v] of snapStore.entries()) {
      if (now - v.ts > SNAP_TTL_MS) snapStore.delete(k);
    }
    // prune oldest if too many
    if (snapStore.size > MAX_SNAPS) {
      const entries = Array.from(snapStore.entries()).sort((a, b) => a[1].ts - b[1].ts);
      while (entries.length > MAX_SNAPS) {
        const [oldKey] = entries.shift();
        snapStore.delete(oldKey);
      }
    }
  }

  async function getIndexBySnapshot(snapshot) {
    const now = Date.now();
    if (snapshot) {
      const hit = snapStore.get(snapshot);
      if (hit && now - hit.ts <= SNAP_TTL_MS) return hit.idx;
    }
    // 沒 snapshot 或找不到 → 抓新 index，並建立新 snapshot
    const idx = await fetchIndex(800); // ✅ 拉多一點，避免少數頻道>500被截斷
    const snap = String(idx.fetchedAt || Date.now());
    const withSnap = { ...idx, _snapshot: snap };
    saveSnapshot(snap, withSnap);
    return withSnap;
  }

  function enrichVideo(raw, channelTitle) {
    const base = normalize(raw);
    const videoId = base.videoId;

    // 盡量保留 worker 可能有的欄位（description/tags）
    const description = raw?.description ? String(raw.description) : "";
    const tags = Array.isArray(raw?.tags) ? raw.tags.map((t) => String(t)) : [];

    return {
      videoId,
      title: base.title,
      url: base.url,
      publishedAt: base.publishedAt,
      channelTitle: String(channelTitle || ""),
      description,
      tags,
      thumbnailUrl: videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : "",
    };
  }

  function dedupeByVideoId(arr) {
    const seen = new Set();
    const out = [];
    for (const v of arr) {
      if (!v.videoId) continue;
      if (seen.has(v.videoId)) continue;
      seen.add(v.videoId);
      out.push(v);
    }
    return out;
  }

  function sortByPublishedDesc(arr) {
    return arr.sort((a, b) => {
      const ta = Date.parse(a.publishedAt || "") || 0;
      const tb = Date.parse(b.publishedAt || "") || 0;
      return tb - ta;
    });
  }

  function paginate(all, offset, limit) {
    const total = all.length;
    const L = Math.max(1, limit);
    const pageCount = Math.max(1, Math.ceil(total / L));
    const start = Math.min(Math.max(0, offset), total);
    const page = Math.floor(start / L) + 1;
    const end = Math.min(start + L, total);
    const videos = all.slice(start, end);
    const hasPrev = page > 1;
    const hasNext = page < pageCount;
    return { total, pageCount, page, offset: start, limit: L, videos, hasPrev, hasNext };
  }

  // ---------- smarter search ----------
  const STOPWORDS = [
    "歌曲",
    "音樂",
    "音乐",
    "歌",
    "mv",
    "m/v",
    "musicvideo",
    "lyrics",
    "歌詞",
    "歌词",
    "完整版",
    "完整版",
    "官方",
    "official",
    "cover",
    "翻唱",
    "live",
    "現場",
    "现场",
    "短片",
    "shorts",
    "short",
    "動態歌詞",
    "动态歌词",
    "純享",
    "纯享",
    "合輯",
    "合集",
    "編曲",
    "作曲",
    "作詞",
    "作词",
  ];

  function normText(s) {
    const str = String(s || "").toLowerCase();
    // 盡量去掉空白/標點/符號
    try {
      return str.replace(/[\s\p{P}\p{S}]+/gu, "");
    } catch {
      // fallback（如果 runtime 不支援 \p）
      return str.replace(/[\s~`!@#$%^&*()_\-+=[\]{}\\|;:'",.<>/?]+/g, "");
    }
  }

  function stripStopwords(norm) {
    let out = norm;
    for (const w of STOPWORDS) {
      out = out.replaceAll(normText(w), "");
    }
    return out;
  }

  function buildSearchQuery(rawQuery) {
    const raw = String(rawQuery || "").trim();
    const norm0 = normText(raw);
    let effective = stripStopwords(norm0);
    if (!effective) effective = norm0;

    // tokens：用「分隔符」切，對 CJK 沒分隔時就會是一整段，仍可去 stopwords
    let tokens = [];
    try {
      tokens = raw
        .split(/[\s\p{P}\p{S}]+/u)
        .map((t) => stripStopwords(normText(t)))
        .filter(Boolean);
    } catch {
      tokens = raw
        .split(/[\s~`!@#$%^&*()_\-+=[\]{}\\|;:'",.<>/?]+/g)
        .map((t) => stripStopwords(normText(t)))
        .filter(Boolean);
    }

    if (!tokens.length && effective) tokens = [effective];

    return { raw, effective, tokens };
  }

  function scoreVideoForQuery(v, q) {
    // v: enriched video
    const titleN = normText(v.title);
    const descN = normText(v.description);
    const tagsN = normText((v.tags || []).join(" "));
    const channelN = normText(v.channelTitle);

    const hay = titleN + descN + tagsN + channelN;

    // 若清理後 query 為空：不做 match-all，直接不匹配
    if (!q.effective) return { ok: false, score: 0 };

    const hasEffective = hay.includes(q.effective);
    const tokensOk = q.tokens.length ? q.tokens.every((t) => hay.includes(t)) : false;

    if (!hasEffective && !tokensOk) return { ok: false, score: 0 };

    let score = 0;

    // title 命中更高權重
    if (titleN.includes(q.effective)) score += 100;
    else if (hasEffective) score += 60;

    // token 加分（避免「梓渝歌曲」只命中「歌曲」類無意義 token）
    for (const t of q.tokens) {
      if (!t) continue;
      if (titleN.includes(t)) score += 20;
      else if (descN.includes(t) || tagsN.includes(t)) score += 8;
      else if (channelN.includes(t)) score += 2;
    }

    // recency 微調
    const ts = Date.parse(v.publishedAt || "") || 0;
    score += Math.min(10, ts ? ts / 1e12 : 0);

    return { ok: true, score };
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
        "openai/toolInvocation/invoked": "YouTube Finder 已開啟。",
      }),
    },
    async () => ({
      content: [{ type: "text", text: "YouTube Finder opened." }],
      structuredContent: { ready: true },
      _meta: { mode: "OPEN" },
    })
  );

  // ---------------- list_videos (paged, snapshot) ----------------
  mcp.registerTool(
    "list_videos",
    {
      title: "List Videos",
      inputSchema: listSchema,
      securitySchemes: NOAUTH,
      _meta: widgetOnlyMeta(),
    },
    async ({ limit, offset, snapshot }) => {
      const L = limit ?? 3;
      const O = offset ?? 0;

      const idx = await getIndexBySnapshot(snapshot);
      const snap = String(idx._snapshot || idx.fetchedAt || Date.now());
      const channelTitle = String(idx.channelTitle || "");

      let all = (idx.videos || []).map((v) => enrichVideo(v, channelTitle));
      all = dedupeByVideoId(all);
      all = sortByPublishedDesc(all);

      const pageData = paginate(all, O, L);

      return {
        content: [],
        structuredContent: {
          channelTitle,
          fetchedAt: String(idx.fetchedAt || ""),
          snapshot: snap,
          query: "",
          effectiveQuery: "",
          ...pageData,
          // UI 不需要 description/tags 顯示就唔必帶（但保留亦無妨）
          videos: pageData.videos.map(({ description, tags, ...rest }) => rest),
        },
        _meta: { mode: "LIST" },
      };
    }
  );

  // ---------------- search_videos (smart, paged, snapshot) ----------------
  mcp.registerTool(
    "search_videos",
    {
      title: "Search Videos",
      inputSchema: searchSchema,
      securitySchemes: NOAUTH,
      _meta: widgetOnlyMeta(),
    },
    async ({ query, limit, offset, snapshot }) => {
      const L = limit ?? 3;
      const O = offset ?? 0;

      const idx = await getIndexBySnapshot(snapshot);
      const snap = String(idx._snapshot || idx.fetchedAt || Date.now());
      const channelTitle = String(idx.channelTitle || "");

      const q = buildSearchQuery(query);

      // 清理後如果完全空 → 回傳 0 筆（避免 match-all）
      if (!q.effective) {
        const empty = paginate([], 0, L);
        return {
          content: [],
          structuredContent: {
            channelTitle,
            fetchedAt: String(idx.fetchedAt || ""),
            snapshot: snap,
            query,
            effectiveQuery: "",
            ...empty,
            videos: [],
          },
          _meta: { mode: "SEARCH", query },
        };
      }

      let all = (idx.videos || []).map((v) => enrichVideo(v, channelTitle));
      all = dedupeByVideoId(all);

      // ✅ smart match + score
      const scored = [];
      for (const v of all) {
        const r = scoreVideoForQuery(v, q);
        if (!r.ok) continue;
        scored.push({ v, score: r.score });
      }

      // sort by score then recency
      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const ta = Date.parse(a.v.publishedAt || "") || 0;
        const tb = Date.parse(b.v.publishedAt || "") || 0;
        return tb - ta;
      });

      const filtered = scored.map((x) => x.v);

      const pageData = paginate(filtered, O, L);

      return {
        content: [],
        structuredContent: {
          channelTitle,
          fetchedAt: String(idx.fetchedAt || ""),
          snapshot: snap,
          query,
          effectiveQuery: q.effective, // ✅ 讓 UI 顯示「實際搜尋」用
          ...pageData,
          videos: pageData.videos.map(({ description, tags, ...rest }) => rest),
        },
        _meta: { mode: "SEARCH", query },
      };
    }
  );
}
