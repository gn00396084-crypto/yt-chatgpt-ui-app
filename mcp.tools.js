import { z } from "zod";
import { WIDGET_URI } from "./mcp.resources.js";
import { makeWorkerClient } from "./worker.client.js";

export function registerTools(mcp, env) {
  const { fetchIndex, normalize } = makeWorkerClient(env);

  const NOAUTH = [{ type: "noauth" }];

  const emptySchema = z.object({}).strict();

  // ✅ 加 snapshot（可選），用於「快照式分頁」
  const listSchema = z.object({
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).max(200000).optional(),
    snapshot: z.string().min(1).optional()
  }).strict();

  const searchSchema = z.object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).max(200000).optional(),
    snapshot: z.string().min(1).optional()
  }).strict();

  // ✅ 入口工具：綁 template
  const entryMeta = (extra = {}) => ({
    "openai/outputTemplate": WIDGET_URI,
    "openai/widgetAccessible": true,
    ...extra
  });

  // ✅ widget-only：不綁 template（避免 hidden tool 綁 template 導致 template 不可用）
  const widgetOnlyMeta = (extra = {}) => ({
    "openai/widgetAccessible": true,
    "openai/visibility": "private",
    ...extra
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
      if ((now - v.ts) > SNAP_TTL_MS) snapStore.delete(k);
    }
    // prune oldest if too many
    if (snapStore.size > MAX_SNAPS) {
      const entries = Array.from(snapStore.entries()).sort((a,b) => a[1].ts - b[1].ts);
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
      if (hit && (now - hit.ts) <= SNAP_TTL_MS) return hit.idx;
    }
    // 沒 snapshot 或找不到 → 抓新 index，並建立新 snapshot
    const idx = await fetchIndex(500);
    const snap = String(idx.fetchedAt || Date.now());
    saveSnapshot(snap, { ...idx, _snapshot: snap });
    return { ...idx, _snapshot: snap };
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

  function sortByPublishedDesc(arr) {
    // 保守：沒有日期就放後面
    return arr.sort((a, b) => {
      const ta = Date.parse(a.publishedAt || "") || 0;
      const tb = Date.parse(b.publishedAt || "") || 0;
      return tb - ta;
    });
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

  // ---------------- list_videos (paged, snapshot) ----------------
  mcp.registerTool(
    "list_videos",
    {
      title: "List Videos",
      inputSchema: listSchema,
      securitySchemes: NOAUTH,
      _meta: widgetOnlyMeta()
    },
    async ({ limit, offset, snapshot }) => {
      const L = limit ?? 3;
      const O = offset ?? 0;

      const idx = await getIndexBySnapshot(snapshot);
      const snap = String(idx._snapshot || idx.fetchedAt || Date.now());
      const channelTitle = String(idx.channelTitle || "");

      let all = (idx.videos || []).map(v => enrichVideo(v, channelTitle));
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
          ...pageData
        },
        _meta: { mode: "LIST" }
      };
    }
  );

  // ---------------- search_videos (paged, snapshot) ----------------
  mcp.registerTool(
    "search_videos",
    {
      title: "Search Videos",
      inputSchema: searchSchema,
      securitySchemes: NOAUTH,
      _meta: widgetOnlyMeta()
    },
    async ({ query, limit, offset, snapshot }) => {
      const L = limit ?? 3;
      const O = offset ?? 0;

      const idx = await getIndexBySnapshot(snapshot);
      const snap = String(idx._snapshot || idx.fetchedAt || Date.now());
      const channelTitle = String(idx.channelTitle || "");
      const q = query.toLowerCase();

      let filtered = (idx.videos || [])
        .filter(v => String(v.title || "").toLowerCase().includes(q))
        .map(v => enrichVideo(v, channelTitle));

      filtered = dedupeByVideoId(filtered);
      filtered = sortByPublishedDesc(filtered);

      const pageData = paginate(filtered, O, L);

      return {
        content: [],
        structuredContent: {
          channelTitle,
          fetchedAt: String(idx.fetchedAt || ""),
          snapshot: snap,
          query,
          ...pageData
        },
        _meta: { mode: "SEARCH", query }
      };
    }
  );
}
