(() => {
  const $ = (id) => document.getElementById(id);
  const getHost = () => window.openai;

  const els = {
    root: $("root"),
    topBar: $("topBar"),
    main: $("main"),

    channelTitle: $("channelTitle"),
    modeBadge: $("modeBadge"),
    meta: $("meta"),
    status: $("status"),

    q: $("q"),
    btnSearch: $("btnSearch"),
    btnLatest: $("btnLatest"),
    btnReset: $("btnReset"),
    btnFs: $("btnFs"),
    btnPip: $("btnPip"),
    btnInline: $("btnInline"),
    btnPrev: $("btnPrev"),
    btnNext: $("btnNext"),
    btnDebug: $("btnDebug"),

    gallery: $("gallery"),
    links: $("links"),

    detailSidebar: $("detailSidebar"),
    btnCloseSidebar: $("btnCloseSidebar"),
    sbHeaderTitle: $("sbHeaderTitle"),
    sbHeaderSub: $("sbHeaderSub"),
    sbBody: $("sbBody"),
    detailImg: $("detailImg"),
    detailTitle: $("detailTitle"),
    detailSub: $("detailSub"),
    detailText: $("detailText"),
    detailFoot: $("detailFoot"),
    btnOpen: $("btnOpen"),
    btnAsk: $("btnAsk"),
    btnBack: $("btnBack"),

    detailPip: $("detailPip"),
    btnClosePip: $("btnClosePip"),
    pipBody: $("pipBody"),
    pipImg: $("pipImg"),
    pipTitle: $("pipTitle"),
    pipSub: $("pipSub"),
    pipText: $("pipText"),
    pipFoot: $("pipFoot"),
    pipOpen: $("pipOpen"),
    pipAsk: $("pipAsk"),
    pipClear: $("pipClear"),

    drawerBackdrop: $("drawerBackdrop"),
    detailDrawer: $("detailDrawer"),
    btnCloseDrawer: $("btnCloseDrawer"),
    dwBody: $("dwBody"),
    dwImg: $("dwImg"),
    dwTitle: $("dwTitle"),
    dwSub: $("dwSub"),
    dwText: $("dwText"),
    dwFoot: $("dwFoot"),
    dwOpen: $("dwOpen"),
    dwAsk: $("dwAsk"),
    dwClear: $("dwClear"),

    debugDetails: $("debugDetails"),
    dbgText: $("dbgText"),
    dbgRefresh: $("dbgRefresh"),
    dbgCopy: $("dbgCopy"),
  };

  const setStatus = (t = "") => { els.status.textContent = t; };

  const supportsDisplayMode = () => typeof getHost()?.requestDisplayMode === "function";
  const getDisplayMode = () => getHost()?.displayMode || "inline";

  const allowedModes = new Set(["list_videos","search_videos","latest_song"]);
  const looksLikeVideo = (v) => !!(v && typeof v === "object" && typeof v.title === "string" && (v.url || v.videoId || v.thumbnailUrl));
  const isOurPayload = (p) => {
    if (!p || typeof p !== "object") return false;
    if (p.mode && !allowedModes.has(p.mode)) return false;
    const items = Array.isArray(p.items) ? p.items : (p.item ? [p.item] : null);
    if (!items) return false;
    if (items.length === 0) return true;
    return looksLikeVideo(items[0]);
  };

  const getHostPayload = () => {
    const out = getHost()?.toolOutput;
    return out?.structuredContent || out;
  };

  const safeJson = (v) => { try { return JSON.stringify(v); } catch { return String(v); } };

  const computeLayout = () => {
    const dm = getDisplayMode();
    if (dm === "pip") return "pip";
    if (dm === "fullscreen") return "split";
    return (window.innerWidth >= 980) ? "split" : "drawer";
  };

  const updateCssVars = () => {
    const vw = Math.max(320, Math.floor(window.innerWidth || 0));
    const vh = Math.max(200, Math.floor(window.innerHeight || 0));

    const rightW = Math.max(300, Math.min(420, Math.floor(vw * 0.28)));
    document.documentElement.style.setProperty("--rightW", `${rightW}px`);

    const pipMaxW = Math.min(560, vw - 20);
    document.documentElement.style.setProperty("--pipMaxW", `${pipMaxW}px`);

    const rootStyle = getComputedStyle(els.root);
    const padTop = parseFloat(rootStyle.paddingTop || "0") || 0;
    const padBot = parseFloat(rootStyle.paddingBottom || "0") || 0;
    const topH = Math.ceil(els.topBar.getBoundingClientRect().height);

    let detailH = vh - padTop - padBot - topH - 18;
    detailH = Math.max(180, Math.floor(detailH));
    if (getDisplayMode() === "fullscreen") detailH = Math.max(detailH, 360);

    document.documentElement.style.setProperty("--detailH", `${detailH}px`);
  };

  const notifyHeight = () => {
    try{
      const host = getHost();
      const dm = getDisplayMode();
      const h = (dm === "pip") ? Math.floor(window.innerHeight) : document.body.scrollHeight;
      host?.notifyIntrinsicHeight?.(h);
    } catch {}
  };

  const syncAfterPaint = () => {
    requestAnimationFrame(() => {
      applyModeLayout();
      notifyHeight();
    });
  };

  const syncAfterImages = async () => {
    try {
      const imgs = [...document.querySelectorAll("img")];
      await Promise.allSettled(imgs.map(img =>
        img.decode?.().catch(()=>{}) || new Promise(r => (img.onload = img.onerror = r))
      ));
    } catch {}
    syncAfterPaint();
  };

  // ===== Drawer open state (prevent auto-popup) =====
  let drawerUserOpened = false;

  const setDrawerOpen = (open) => {
    if (open) {
      els.drawerBackdrop.classList.add("show");
      els.detailDrawer.classList.add("show");
      els.detailDrawer.setAttribute("aria-hidden", "false");
    } else {
      els.drawerBackdrop.classList.remove("show");
      els.detailDrawer.classList.remove("show");
      els.detailDrawer.setAttribute("aria-hidden", "true");
    }
  };

  const showDrawer = () => {
    drawerUserOpened = true;
    setDrawerOpen(true);
  };

  const hideDrawer = (alsoClear = false) => {
    drawerUserOpened = false;
    setDrawerOpen(false);
    if (alsoClear) clearDetail();
  };

  els.drawerBackdrop.addEventListener("click", () => hideDrawer(false));
  els.btnCloseDrawer.addEventListener("click", () => hideDrawer(false));

  // ===== State =====
  let state = {
    mode:"list_videos",
    q:"",
    cursor:0,
    pageSize:3,
    nextCursor:null,
    total:null,
    totalMatches:null,
    channelTitle:"YouTube Finder",
    items:[]
  };

  let detail = { item:null, videoId:null };

  const ytThumbFromId = (videoId) =>
    videoId ? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg` : "";

  const withCb = (url, cb) => {
    if (!url) return "";
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}cb=${encodeURIComponent(cb || "")}`;
  };

  const thumbUrlOf = (item, idx) => {
    const base = item?.thumbnailUrl || ytThumbFromId(item?.videoId);
    const cb = item?.videoId || item?.url || String(idx);
    return withCb(base, cb);
  };

  const openUrl = async (url) => {
    if (!url) return;
    try {
      const host = getHost();
      if (host?.openExternal) await host.openExternal({ href: url });
      else window.open(url, "_blank");
    } catch (err) {
      setStatus("打開連結失敗：" + (err?.message || String(err)));
    }
  };

  const requestMode = async (mode) => {
    if (!supportsDisplayMode()) return;
    try {
      const host = getHost();
      setStatus(`切換：${mode}...`);
      await host.requestDisplayMode({ mode });
      setStatus("");
      setTimeout(syncAfterPaint, 160);
    } catch (e) {
      setStatus(`切換失敗：${e?.message || String(e)}`);
    }
  };

  const resetDetailScrollTop = () => {
    [els.sbBody, els.dwBody, els.pipBody].forEach(el => {
      if (!el) return;
      try { el.scrollTop = 0; } catch {}
    });
  };

  const clearDetail = () => {
    detail.item = null;
    detail.videoId = null;
    els.detailSidebar.hidden = true;
    els.detailPip.hidden = true;
    hideDrawer(false);
    syncAfterPaint();
  };

  // ===== Layout apply (DO NOT auto-open drawer) =====
  const applyModeLayout = () => {
    const dm = getDisplayMode();
    document.body.setAttribute("data-display", dm);
    els.modeBadge.textContent = dm;

    const layout = computeLayout();
    document.body.setAttribute("data-layout", layout);

    const hasDetail = !!detail.item;

    if (layout === "split") {
      els.detailPip.hidden = true;
      setDrawerOpen(false); // close visually
      els.detailSidebar.hidden = !hasDetail;
    } else if (layout === "drawer") {
      els.detailPip.hidden = true;
      els.detailSidebar.hidden = true;

      if (hasDetail && drawerUserOpened) setDrawerOpen(true);
      else setDrawerOpen(false);

    } else { // pip
      els.detailSidebar.hidden = true;
      setDrawerOpen(false);
      els.detailPip.hidden = !hasDetail;
    }

    updateCssVars();
    refreshDebug();
  };

  const renderDetail = (item) => {
    const title = item?.title || "";
    const sub = item?.publishedAt ? `上架：${String(item.publishedAt).slice(0,10)}` : "";
    const desc = (item?.description || "").trim() || "（無說明）";
    const thumb = thumbUrlOf(item, 0);
    const foot = item?.videoId ? `videoId: ${item.videoId}` : "";

    // sidebar
    els.sbHeaderTitle.textContent = title || "右側資訊";
    els.sbHeaderSub.textContent = sub || " ";
    els.detailImg.src = thumb;
    els.detailTitle.textContent = title;
    els.detailSub.textContent = sub;
    els.detailText.textContent = desc;
    els.detailFoot.textContent = foot;

    // drawer
    els.dwImg.src = thumb;
    els.dwTitle.textContent = title;
    els.dwSub.textContent = sub;
    els.dwText.textContent = desc;
    els.dwFoot.textContent = foot;

    // pip
    els.pipImg.src = thumb;
    els.pipTitle.textContent = title;
    els.pipSub.textContent = sub;
    els.pipText.textContent = desc;
    els.pipFoot.textContent = foot;

    resetDetailScrollTop();
    syncAfterImages();
  };

  const showDetail = async (item) => {
    if (!item) return;
    detail.item = item;
    detail.videoId = item.videoId || null;

    renderDetail(item);

    const layout = computeLayout();
    if (layout === "split") {
      els.detailSidebar.hidden = false;
      els.detailPip.hidden = true;
      setDrawerOpen(false);
    } else if (layout === "drawer") {
      els.detailSidebar.hidden = true;
      els.detailPip.hidden = true;
      showDrawer(); // ✅ only here
    } else {
      els.detailPip.hidden = false;
      els.detailSidebar.hidden = true;
      setDrawerOpen(false);
    }

    resetDetailScrollTop();
    syncAfterPaint();
  };

  const desiredPageSize = () => (getDisplayMode() === "fullscreen" ? 12 : 3);
  const desiredThumbCount = () => (getDisplayMode() === "fullscreen" ? 6 : 2);

  const render = (payload) => {
    const items = Array.isArray(payload.items) ? payload.items : (payload.item ? [payload.item] : []);
    state.mode = payload.mode || state.mode;
    state.q = payload.q ?? state.q;
    state.cursor = Number(payload.cursor ?? state.cursor ?? 0);
    state.nextCursor = payload.nextCursor ?? null;
    state.pageSize = Number(payload.pageSize ?? state.pageSize ?? desiredPageSize());
    state.total = payload.total ?? state.total;
    state.totalMatches = payload.totalMatches ?? state.totalMatches;
    state.channelTitle = payload.channelTitle || state.channelTitle || "YouTube Finder";
    state.items = items;

    els.channelTitle.textContent = `🎧 ${state.channelTitle}`;

    if (state.mode === "search_videos") {
      els.meta.innerHTML = `搜尋：<b>${state.q || ""}</b>　結果：${state.totalMatches ?? items.length}`;
    } else if (state.mode === "latest_song") {
      els.meta.textContent = "最新一首";
    } else {
      els.meta.textContent = `影片總數：${state.total ?? "?"}`;
    }

    els.btnPrev.disabled = state.cursor <= 0;
    els.btnNext.disabled = state.nextCursor == null;

    els.gallery.textContent = "";
    const thumbs = items.slice(0, desiredThumbCount());
    els.gallery.innerHTML = thumbs.length ? thumbs.map((v, idx) => {
      const t = thumbUrlOf(v, idx);
      const title = (v.title||"").replace(/"/g,'&quot;');
      return `
        <button class="thumbBtn" data-i="${idx}" type="button" title="${title}">
          <div class="thumbBox">
            <img src="${t.replace(/"/g,'&quot;')}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
          </div>
        </button>
      `;
    }).join("") : `<div class="meta">（沒有縮圖）</div>`;

    els.links.innerHTML = items.length
      ? items.map((v, i) => `<li><button class="linkBtn" data-i="${i}" type="button">${(v.title||"")}</button></li>`).join("")
      : "";

    const onPick = (i) => {
      const item = state.items[i];
      if (!item) return;
      showDetail(item);
    };

    els.gallery.querySelectorAll("[data-i]").forEach(el =>
      el.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); onPick(Number(el.getAttribute("data-i"))); })
    );
    els.links.querySelectorAll("[data-i]").forEach(el =>
      el.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); onPick(Number(el.getAttribute("data-i"))); })
    );

    syncAfterPaint();
  };

  const callTool = async (name, args) => {
    const host = getHost();
    if (!host?.callTool) throw new Error("window.openai.callTool 不存在（請確認 skybridge 正常）");
    setStatus(`呼叫工具：${name}...`);
    const out = await host.callTool(name, args || {});
    const payload = out?.structuredContent || out;
    if (isOurPayload(payload)) render(payload);
    setStatus("");
  };

  let lastSig = "";
  const syncFromHostToolOutput = () => {
    const payload = getHostPayload();
    if (!isOurPayload(payload)) return;
    const sig = safeJson(payload);
    if (sig === lastSig) return;
    lastSig = sig;
    render(payload);
  };

  // ===== Buttons =====
  els.btnFs.disabled = !supportsDisplayMode();
  els.btnPip.disabled = !supportsDisplayMode();
  els.btnInline.disabled = !supportsDisplayMode();

  els.btnFs.addEventListener("click", () => requestMode("fullscreen"));
  els.btnPip.addEventListener("click", async () => {
    await requestMode("pip");
    if (!detail.videoId && state.items.length) showDetail(state.items[0]);
  });
  els.btnInline.addEventListener("click", () => requestMode("inline"));

  // ✅ 換列表前清 detail
  const clearDetailBeforeListChange = () => {
    if (detail.item) clearDetail();
    drawerUserOpened = false;
  };

  els.btnSearch.addEventListener("click", async () => {
    const q = els.q.value.trim();
    if (!q) return;
    clearDetailBeforeListChange();
    state.mode = "search_videos";
    state.q = q;
    try { await callTool("search_videos", { q, cursor: 0, pageSize: desiredPageSize() }); }
    catch (e) { setStatus(e?.message || String(e)); }
  });
  els.q.addEventListener("keydown", (e) => { if (e.key === "Enter") els.btnSearch.click(); });

  els.btnLatest.addEventListener("click", async () => {
    clearDetailBeforeListChange();
    state.mode = "latest_song";
    try { await callTool("latest_song", {}); }
    catch (e) { setStatus(e?.message || String(e)); }
  });

  els.btnReset.addEventListener("click", async () => {
    clearDetailBeforeListChange();
    state.mode = "list_videos";
    try { await callTool("list_videos", { cursor: 0, pageSize: desiredPageSize(), sort: "newest" }); }
    catch (e) { setStatus(e?.message || String(e)); }
  });

  els.btnPrev.addEventListener("click", async () => {
    if (els.btnPrev.disabled) return;
    clearDetailBeforeListChange();
    const prev = Math.max(0, (state.cursor || 0) - (state.pageSize || 3));
    try {
      if (state.mode === "search_videos") await callTool("search_videos", { q: state.q, cursor: prev, pageSize: state.pageSize });
      else await callTool("list_videos", { cursor: prev, pageSize: state.pageSize, sort: "newest" });
    } catch (e) { setStatus(e?.message || String(e)); }
  });

  els.btnNext.addEventListener("click", async () => {
    if (els.btnNext.disabled) return;
    clearDetailBeforeListChange();
    if (state.nextCursor == null) return;
    try {
      if (state.mode === "search_videos") await callTool("search_videos", { q: state.q, cursor: state.nextCursor, pageSize: state.pageSize });
      else await callTool("list_videos", { cursor: state.nextCursor, pageSize: state.pageSize, sort: "newest" });
    } catch (e) { setStatus(e?.message || String(e)); }
  });

  els.btnOpen.addEventListener("click", () => openUrl(detail?.item?.url));
  els.dwOpen.addEventListener("click", () => openUrl(detail?.item?.url));
  els.pipOpen.addEventListener("click", () => openUrl(detail?.item?.url));

  const ask = async () => {
    const t = detail?.item?.title || "";
    const msg = t ? `用繁體中文簡短介紹這支影片：${t}\n請整理 3-5 個重點。` : "簡短介紹這個內容。";
    try {
      const host = getHost();
      if (host?.sendFollowUpMessage) await host.sendFollowUpMessage({ prompt: msg });
      else setStatus("host.sendFollowUpMessage 不存在");
    } catch (e) { setStatus(e?.message || String(e)); }
  };

  els.btnAsk.addEventListener("click", ask);
  els.dwAsk.addEventListener("click", ask);
  els.pipAsk.addEventListener("click", ask);

  els.btnBack.addEventListener("click", clearDetail);
  els.pipClear.addEventListener("click", clearDetail);

  // sidebar/pip close
  els.btnCloseSidebar.addEventListener("click", () => { clearDetail(); });
  els.btnClosePip.addEventListener("click", () => { clearDetail(); });

  // drawer clear = close + clear
  els.dwClear.addEventListener("click", () => hideDrawer(true));

  // ===== Debug =====
  const refreshDebug = () => {
    const host = getHost();
    const dm = getDisplayMode();
    const layout = computeLayout();
    const rootRect = els.root.getBoundingClientRect();
    const mainCols = getComputedStyle(els.main).gridTemplateColumns;
    const sidebarHidden = els.detailSidebar.hidden;
    const pipHidden = els.detailPip.hidden;
    const drawerOpen = els.detailDrawer.classList.contains("show");
    const mh = (typeof host?.maxHeight === "number") ? host.maxHeight : null;

    const payload = getHostPayload();
    const items = (payload && Array.isArray(payload.items)) ? payload.items.length : (payload && payload.item ? 1 : 0);

    els.dbgText.textContent =
`Host / Mode
displayMode: ${dm}
requestDisplayMode: ${supportsDisplayMode() ? "yes" : "no"}
layout(computeLayout): ${layout}
host.maxHeight: ${mh ?? "n/a"}

Panels
sidebarHidden: ${sidebarHidden}
drawerOpen: ${drawerOpen}
drawerUserOpened: ${drawerUserOpened}
pipHidden: ${pipHidden}
hasDetail: ${!!detail.item}

Viewport / Root
viewport(inner): ${window.innerWidth}x${window.innerHeight}
rootRect: ${Math.round(rootRect.width)}x${Math.round(rootRect.height)}
main grid-template-columns: ${mainCols}

Last Tool Output
isOurPayload: ${isOurPayload(payload)}
mode: ${payload?.mode ?? "-"}
q: ${payload?.q ?? "-"}
items: ${items}
nextCursor: ${payload?.nextCursor ?? "-"}
channelTitle: ${payload?.channelTitle ?? "-"}`;
  };

  els.btnDebug.addEventListener("click", () => {
    els.debugDetails.open = true;
    refreshDebug();
    els.debugDetails.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });

  els.dbgRefresh.addEventListener("click", refreshDebug);
  els.dbgCopy.addEventListener("click", async () => {
    refreshDebug();
    try {
      await navigator.clipboard.writeText(els.dbgText.textContent);
      setStatus("已複製 debug");
      setTimeout(()=>setStatus(""), 1200);
    } catch {
      setStatus("clipboard not available");
      setTimeout(()=>setStatus(""), 1200);
    }
  });

  // ===== Events =====
  window.addEventListener("openai:set_globals", () => {
    syncFromHostToolOutput();
    syncAfterPaint();
  });

  window.addEventListener("resize", () => {
    updateCssVars();
    syncAfterPaint();
  });

  // ===== Boot =====
  (async () => {
    applyModeLayout();
    try {
      const payload = getHostPayload();
      if (isOurPayload(payload)) render(payload);
      else await callTool("list_videos", { cursor: 0, pageSize: desiredPageSize(), sort: "newest" });
    } catch (e) {
      setStatus(e?.message || String(e));
    }

    setInterval(syncFromHostToolOutput, 650);
    setInterval(() => { updateCssVars(); refreshDebug(); }, 1200);
  })();
})();
