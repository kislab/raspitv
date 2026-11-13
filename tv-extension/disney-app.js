// Disney+ – eigene TV-Oberfläche, von Grund auf neu.
//
// Disneys Webseite liefert nur noch Daten (ihre Schnittstelle, angesprochen über disney-bridge.js), den Player
// und die Profil-/PIN-Abfrage. Zu sehen ist sie nur im Player; sonst schläft sie (wird nicht berechnet).
//
// Schnell: jede Seite kommt sofort aus dem Zwischenspeicher (localStorage), frische Daten werden parallel
// nachgeladen und ohne Sprung eingefügt. Flüssig auf dem Pi: nur Reihen in Sichtweite stehen im DOM, verschoben
// wird nur per transform auf eigenen GPU-Ebenen, Kartenbreiten sind fest (kein Layout-Lesen beim Blättern), und das
// große Hintergrundbild wechselt erst, wenn die Auswahl kurz ruht.
//
// Eigene Ansichten bilden einen Stapel (Seite → Detail → …) unabhängig von Disneys Adresse; Disneys Router wird nur
// zum Abspielen (/play/…) und für „Meine Liste“ benutzt.
(() => {
  if (!window.TV || window.top !== window) return;
  try {
    const loc = localStorage.getItem("raspitv-dp-locale");
    if (loc && /^\/(home)?$/.test(location.pathname)) { location.replace(`/${loc}/home${location.search}`); return; }
    const m = location.pathname.match(/^\/([a-z]{2}-[a-z]{2})\//);
    if (m) localStorage.setItem("raspitv-dp-locale", m[1]);
  } catch (e) { /* egal */ }
  const html = document.documentElement;
  html.classList.add("tv-disney");

  // ---------- Hilfsfunktionen ----------

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tid = (id) => `[data-testid='${id}']`;
  const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

  function h(tag, cls, content) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (content != null) el.textContent = content;
    return el;
  }
  /** Bild, das erst nach dem Laden eingeblendet wird */
  function pic(url, cls) {
    const el = h("img", cls);
    el.decoding = "async";
    el.onload = () => el.classList.add("dpa-ld");
    if (url) el.src = url;
    return el;
  }
  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
    mylist: '<path d="M12 5v14M5 12h14"/>',
    movies: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
    series: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/>',
    originals: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
    restart: '<path d="M6 5v14"/><path d="M19 5l-9 7 9 7z" fill="currentColor"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    lock: '<path d="M7 10V7a5 5 0 0 1 10 0v3"/><rect x="5" y="10" width="14" height="11" rx="1" fill="currentColor"/>',
  };
  function icon(name) {
    const span = h("span", "dpa-icon");
    span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
    return span;
  }

  // Zwischenspeicher (localStorage der Disney-Seite, eigener Präfix)
  // Seiten und Detailseiten werden je Profil gespeichert (Weiterschauen, Empfehlungen sind persönlich)
  const pk = () => ((S.profileInfo && S.profileInfo.id) || "x").slice(0, 8) + "-";
  const store = {
    get(key) { try { return JSON.parse(localStorage.getItem("raspitv-dp-" + key)); } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem("raspitv-dp-" + key, JSON.stringify(value)); } catch (e) { /* voll */ } },
    clear(prefix) {
      try {
        for (const k of Object.keys(localStorage)) if (k.startsWith("raspitv-dp-" + prefix)) localStorage.removeItem(k);
      } catch (e) { /* egal */ }
    },
  };

  // ---------- Brücke zur Disney-Seite (disney-bridge.js) ----------

  let seq = 0;
  const waiting = new Map();
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.tvdp !== "res") return;
    const w = waiting.get(e.data.id);
    if (!w) return;
    waiting.delete(e.data.id);
    if (e.data.ok) w.resolve(e.data.data); else w.reject(new Error(e.data.error));
  });
  function bridge(op, args) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      waiting.set(id, { resolve, reject });
      window.postMessage({ tvdp: "req", id, op, args }, "*");
      setTimeout(() => { if (waiting.delete(id)) reject(new Error("Zeitüberschreitung")); }, 20000);
    });
  }
  /** Wartet, bis die Disney-Seite ihren Zugang hat (ihre erste Anfrage an die Schnittstelle) */
  let readyP = null;
  function ready() {
    readyP = readyP || (async () => {
      for (let i = 0; i < 160; i++) {
        if ((await bridge("ready").catch(() => ({}))).ready) {
          await expected();
          S.authed = true;
          changed();
          return;
        }
        await sleep(i < 40 ? 150 : 500);
      }
      throw new Error("Disney+ antwortet nicht");
    })().catch((e) => { readyP = null; throw e; });
    return readyP;
  }
  /** Nach einem Profilwechsel: erst Daten holen, wenn Disney wirklich das neue Profil meldet (sonst kämen die des
      alten und landeten im Zwischenspeicher des neuen) */
  async function expected() {
    const exp = store.get("expect");
    if (!exp || Date.now() - exp.at > 90e3) return;
    for (let i = 0; i < 100; i++) {
      const p = await bridge("profile").catch(() => null);
      if (p && p.id === exp.id) break;
      await sleep(200);
    }
    store.set("expect", 0);
  }
  /** Gewähltes Profil sofort als aktuelles führen: Leiste und Zwischenspeicher zeigen gleich das neue */
  function expectProfile(p) {
    if (!p || !p.id) return;
    store.set("expect", { id: p.id, at: Date.now() });
    const info = { ...(S.profileInfo || {}), id: p.id, name: p.name, img: p.img || "" };
    S.profileInfo = info;
    store.set("profile", info);
  }
  const EXPLORE = "https://disney.api.edge.bamgrid.com/explore/v1.21/";
  async function api(path) {
    await ready();
    return bridge("get", { url: EXPLORE + path });
  }
  /** Disneys eigener Router (ohne Neuladen) */
  const go = (path) => bridge("navigate", { path }).catch(() => (location.href = path));

  // ---------- Daten aus der Schnittstelle ----------

  const IMG = "https://disney.images.edge.bamgrid.com/ripcut-delivery/v2/variant/disney/";
  const imageUrl = (id, width) => (id ? `${IMG}${id}/compose?format=webp&width=${width}` : "");
  function artId(art, kind, ...ratios) {
    const set = art?.standard?.[kind] || {};
    for (const r of ratios) if (set[r]?.imageId) return set[r].imageId;
    return Object.values(set)[0]?.imageId || "";
  }
  const years = (r) => (r ? [r.startYear, r.endYear].filter(Boolean).join("–") : "");
  function metaOf(v) {
    const m = v?.metastringParts || {};
    return [m.ratingInfo?.rating?.text && `ab ${m.ratingInfo.rating.text}`, years(m.releaseYearRange),
      m.genres?.values?.[0]].filter(Boolean).join("  •  ");
  }
  const TALL = /poster|vertical/;
  const bgOf = (v, w = 1440) => imageUrl(artId(v?.artwork, "background", "1.78") || artId(v?.artwork, "hero", "1.78"), w);

  /** Eintrag einer Reihe → Karte. „Weiterschauen“ spielt direkt weiter, alles andere öffnet die Detailseite. */
  function card(item, style = "") {
    const v = item.visuals || {};
    const acts = item.actions || [];
    const playA = acts.find((a) => a.type === "playback");
    const pageA = acts.find((a) => a.pageId);
    const tall = TALL.test(style);
    const pct = item.personalization?.userState?.progress?.progressPercentage;
    const ep = v.seasonNumber && v.episodeNumber ? `S${v.seasonNumber}:F${v.episodeNumber}` : "";
    return {
      id: item.id,
      title: v.title || pageA?.visuals?.title || playA?.visuals?.title || "",
      sub: [ep, v.episodeTitle].filter(Boolean).join(" "),
      meta: metaOf(v),
      desc: v.description?.brief || "",
      img: tall ? imageUrl(artId(v.artwork, "tile", "0.71", "0.67", "0.75"), 300)
        : imageUrl(artId(v.artwork, "tile", "1.78") || artId(v.artwork, "thumbnail", "1.78"), 440),
      bg: bgOf(v),
      tall,
      play: (/continue/.test(style) || !pageA) && playA ? playA.deeplinkId : "",
      page: pageA ? pageA.pageId : "",
      progress: pct != null ? pct / 100 : null,
    };
  }
  function slide(item) {
    const v = item.visuals || {};
    return { ...card(item, "hero"), play: "", logo: imageUrl(artId(v.artwork, "title_treatment", "3.32", "1.78"), 700),
      prompt: v.promoLabel?.header || "", desc: v.description?.brief || v.description?.medium || "" };
  }

  // Seiten (Startseite, Filme, Serien, Originals, Meine Liste): Kennung → { slides, rows, version, at }
  const pages = new Map();
  function getPage(ref) {
    let pg = pages.get(ref);
    if (!pg) {
      const cached = store.get(pk() + "page-" + ref);
      pg = { ref, slides: cached?.slides || [], rows: cached?.rows || [], version: 0, at: 0, loading: null, error: "", cached: !!cached };
      pages.set(ref, pg);
    }
    if (!pg.loading && Date.now() - pg.at > 5 * 60e3) {
      pg.loading = fetchPage(pg).catch((e) => { pg.error = e.message; pg.at = Date.now() - 5 * 60e3 + 4000; changed(); }).finally(() => { pg.loading = null; });
    }
    return pg;
  }

  async function fetchPage(pg) {
    let pageId = store.get("pid-" + pg.ref);
    if (!pageId) {
      const dl = await api(`deeplink?refId=${pg.ref}&refIdType=deeplinkId`);
      pageId = JSON.stringify(dl).match(/page-[0-9a-f-]{36}/)?.[0];
      if (!pageId) throw new Error("Seite nicht gefunden");
      store.set("pid-" + pg.ref, pageId);
    }
    const data = await api(`page/${pageId}?disableSmartFocus=true&enhancedContainersLimit=6&limit=24`);
    const pid = pageId.replace(/^page-/, "");
    const setOf = async (id) => (await api(`set/${id}?limit=24&pageId=${pid}`))?.data?.set;
    const sets = [];
    let slides = [], heroSet = "";
    for (const c of data?.data?.page?.containers || []) {
      const style = c.style?.name || "";
      if (/hero/.test(style)) {
        slides = (c.items || []).map(slide).filter((s) => s.bg);
        if (!slides.length) heroSet = c.id;
      } else if (c.type === "set") {
        sets.push({ id: c.id, style, title: c.visuals?.name || "", items: c.items?.length ? c.items : null });
      }
    }
    // Noch nicht geladene Reihen: vorerst aus dem Zwischenspeicher, damit nichts springt
    const old = new Map(pg.rows.map((r) => [r.id, r]));
    const publish = () => {
      pg.slides = slides.length || !pg.slides.length ? slides : pg.slides;
      pg.rows = sets.map((s) => {
        if (!s.items) return old.get(s.id) || null;
        const cards = s.items.map((it) => card(it, s.style)).filter((c) => c.img && (c.page || c.play));
        return cards.length ? { id: s.id, title: s.title, tall: TALL.test(s.style), cards } : null;
      }).filter(Boolean);
      pg.version++;
      changed();
    };
    publish();
    let timer = 0;
    const publishSoon = () => { if (!timer) timer = setTimeout(() => { timer = 0; publish(); }, 250); };
    const todo = sets.filter((s) => !s.items);
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const s = todo[next++];
        try {
          const d = await setOf(s.id);
          s.items = d?.items || [];
          s.title = s.title || d?.visuals?.name || "";
        } catch (e) {
          s.items = [];
        }
        publishSoon();
      }
    };
    const hero = heroSet ? (async () => {
      for (let i = 0; i < 3 && !slides.length; i++) {
        if (i) await sleep(1500);
        slides = ((await setOf(heroSet).catch(() => null))?.items || []).map(slide).filter((s) => s.bg);
      }
      publishSoon();
    })() : null;
    await Promise.all([worker(), worker(), worker(), worker(), hero]);
    clearTimeout(timer);
    publish();
    pg.at = Date.now();
    pg.error = "";
    store.set(pk() + "page-" + pg.ref, { slides: pg.slides, rows: pg.rows });
  }

  // Detailseiten: Entity-Kennung → { data, at }
  const details = new Map();
  function getDetail(id) {
    let d = details.get(id);
    if (!d) {
      d = { id, data: store.get(pk() + "detail-" + id), at: 0, loading: null, error: "" };
      details.set(id, d);
    }
    if (!d.loading && Date.now() - d.at > 60e3) {
      d.loading = fetchDetail(d).catch((e) => { d.error = e.message; d.at = Date.now() - 60e3 + 4000; changed(); }).finally(() => { d.loading = null; });
    }
    return d;
  }

  async function fetchDetail(d) {
    const res = await api(`page/${d.id}?disableSmartFocus=true&enhancedContainersLimit=15&limit=30`);
    const p = res?.data?.page || {};
    const v = p.visuals || {};
    const m = v.metastringParts || {};
    const plays = (p.actions || []).filter((a) => a.type === "playback");
    const resume = plays.find((a) => a.options?.some((o) => o.type !== "from_beginning")) || plays[0];
    const restart = plays.find((a) => a.options?.some((o) => o.type === "from_beginning"));
    const containers = p.containers || [];
    const episodes = containers.find((c) => c.type === "episodes");
    const recs = containers.find((c) => c.type === "set" && c.items?.length);
    const det = containers.find((c) => c.type === "details");
    const old = d.data;
    const seasons = (episodes?.seasons || []).map((se, i) => ({
      id: se.id, label: se.visuals?.name || `Staffel ${i + 1}`,
      items: se.items?.length ? se.items.map(episode) : old?.seasons?.find((o) => o.id === se.id)?.items || null,
    }));
    const tabs = [];
    if (episodes) tabs.push({ kind: "episodes", label: episodes.visuals?.name || "Folgen" });
    if (recs) tabs.push({ kind: "recs", label: recs.visuals?.name || "Empfehlungen", items: recs.items.map((it) => card(it, "standard_art")).filter((c) => c.img) });
    if (det) tabs.push({ kind: "details", label: det.visuals?.name || "Details", text: detailsText(det) });
    const pct = p.personalization?.userState?.progress?.progressPercentage;
    // Staffel der zuletzt gesehenen Folge vorwählen (Disney setzt sie im Weiter-Knopf nicht direkt; die erste
    // Staffel mit Folgen ist ein guter Anfang)
    d.data = {
      id: d.id,
      title: v.title || "",
      bg: bgOf(v),
      logo: imageUrl(artId(v.artwork, "title_treatment", "3.32", "1.78"), 700),
      meta: [m.ratingInfo?.rating?.text && `ab ${m.ratingInfo.rating.text}`, years(m.releaseYearRange),
        ...(m.genres?.values || []).slice(0, 2), seasons.length > 1 ? `${seasons.length} Staffeln` : "",
        m.runtime?.runtimeMs ? `${Math.round(m.runtime.runtimeMs / 60000)} Min.` : ""].filter(Boolean).join("  •  "),
      desc: v.description?.medium || v.description?.brief || "",
      play: resume ? { id: resume.deeplinkId, label: resume.visuals?.displayText || resume.options?.[0]?.displayText || "Abspielen" } : null,
      restart: restart && pct > 0 ? { id: restart.deeplinkId, label: restart.visuals?.displayText || "Von vorn" } : null,
      progress: pct ? pct / 100 : null,
      watch: (p.actions || []).some((a) => a.type === "modifySaves") ? { on: !!p.personalization?.userState?.inWatchlist } : null,
      tabs,
      seasons,
    };
    d.at = Date.now();
    d.error = "";
    store.set(pk() + "detail-" + d.id, d.data);
    trimDetails();
    changed();
  }
  function episode(it) {
    const v = it.visuals || {};
    const play = (it.actions || []).find((a) => a.type === "playback");
    const pct = it.personalization?.userState?.progress?.progressPercentage;
    return {
      id: it.id,
      play: play ? play.deeplinkId : "",
      no: v.episodeNumber || "",
      label: v.seasonNumber && v.episodeNumber ? `S${v.seasonNumber}:F${v.episodeNumber}` : "",
      title: v.episodeTitle || v.title || "",
      desc: v.description?.brief || v.description?.medium || "",
      meta: v.durationMs ? `${Math.round(v.durationMs / 60000)} Min.` : "",
      img: imageUrl(artId(v.artwork, "thumbnail", "1.78") || artId(v.artwork, "tile", "1.78"), 440),
      progress: pct != null ? pct / 100 : null,
    };
  }
  async function loadSeason(d, i) {
    const se = d.data?.seasons[i];
    if (!se || se.items || se.loading) return;
    se.loading = true;
    try {
      se.items = ((await api(`season/${se.id}?limit=60`))?.data?.season?.items || []).map(episode);
    } catch (e) {
      se.items = [];
    }
    se.loading = false;
    store.set(pk() + "detail-" + d.id, d.data);
    changed();
  }
  function detailsText(det) {
    const v = det.visuals || {};
    const lines = [v.description?.full || v.description?.medium || ""];
    const pair = (x, val) => x && val && lines.push(`${x.label || ""} ${val}`.trim());
    pair(v.releaseYearRange, years(v.releaseYearRange));
    pair(v.genres, (v.genres?.values || []).join(", "));
    pair(v.ratingInfo, v.ratingInfo?.rating?.text);
    for (const k of ["starring", "directors", "creators", "producers"]) pair(v[k], (v[k]?.values || []).join(", "));
    return lines.filter(Boolean).join("\n");
  }
  /** Höchstens 30 Detailseiten im Zwischenspeicher */
  function trimDetails() {
    try {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith("raspitv-dp-" + pk() + "detail-"));
      const keep = new Set([...details.keys()].slice(-30).map((id) => "raspitv-dp-" + pk() + "detail-" + id));
      for (const k of keys) if (!keep.has(k) && keys.length > 30) localStorage.removeItem(k);
    } catch (e) { /* egal */ }
  }

  // Suche
  const searches = new Map(); // Suchbegriff → { cards, done }
  function getSearch(q) {
    let s = searches.get(q);
    if (!s) {
      s = { cards: [], done: false };
      searches.set(q, s);
      api(`search?query=${encodeURIComponent(q)}`).then((res) => {
        const sets = (res?.data?.page?.containers || []).filter((c) => c.type === "set");
        s.cards = sets.flatMap((c) => (c.items || []).map((it) => card(it, "standard_art"))).filter((c) => c.img && c.page);
      }).catch(() => {}).finally(() => { s.done = true; changed(); });
    }
    return s;
  }

  // ---------- Zustand ----------

  const NAV = [
    { id: "profile", label: "Profil wechseln", icon: "" },
    { id: "search", label: "Suche", icon: "search" },
    { id: "home", label: "Startseite", icon: "home" },
    { id: "watchlist", label: "Meine Liste", icon: "mylist" },
    { id: "movies", label: "Filme", icon: "movies" },
    { id: "series", label: "Serien", icon: "series" },
    { id: "originals", label: "Originals", icon: "originals" },
  ];
  const isPlayer = () => /\/(play|video)\//.test(location.pathname);
  const isLogin = () => /\/(login|identity|sign-up|signup|welcome|subscribe|account)/.test(location.pathname) ||
    !!$("input[type=password], input[type=email]");

  // Ansichten-Stapel: { type: "page", ref } | { type: "detail", id } | { type: "search" }
  // Jede Ansicht merkt sich ihre Auswahl (zone, row, cols …), damit „Zurück“ genau dort landet.
  const S = {
    stack: [{ type: "page", ref: "home", zone: "hero", row: 0, cols: {}, slide: 0 }],
    mode: null,      // was gerade zu sehen ist: "app" | "profiles" | "pin" | "loading" | null (Disney-Seite / Player)
    rail: false,
    nav: 1,
    built: null,     // Schlüssel der aufgebauten Ansicht
    playInfo: null,
    restartAt: 0,
  };
  const top = () => S.stack[S.stack.length - 1];
  TV.disney = S; // Zustand für Tests (dev/cdp.py --ext 'TV.disney')
  S.trace = [];
  const trace = (what) => { S.trace.push(`${Math.round(performance.now())} ${what} ${location.pathname}`); if (S.trace.length > 40) S.trace.shift(); };
  TV.disneyData = { pages, details, searches };

  // ---------- Grundgerüst ----------

  const root = h("div");
  root.id = "dpa";
  const bgs = [pic("", "dpa-bg"), pic("", "dpa-bg")];
  bgs.forEach((b) => { b.onload = () => b.dataset.want === "1" && b.classList.add("dpa-show"); });
  const shade = h("div", "dpa-shade");
  const viewEl = h("div", "dpa-view");
  const rail = buildRail();
  root.append(...bgs, shade, viewEl, rail.el);
  html.append(root);

  // Hintergrund: das neue Bild lädt auf der verdeckten Ebene und wird dann übergeblendet
  let bgFront = 0, bgUrl = "", bgTimer = 0;
  function setBg(url, delay = 0) {
    clearTimeout(bgTimer);
    if (url === bgUrl) return;
    const apply = () => {
      bgUrl = url;
      const back = bgs[1 - bgFront], front = bgs[bgFront];
      front.dataset.want = "0";
      front.classList.remove("dpa-show");
      if (!url) return;
      back.dataset.want = "1";
      if (back.getAttribute("src") === url && back.complete) back.classList.add("dpa-show");
      else back.src = url;
      bgFront = 1 - bgFront;
    };
    if (delay) bgTimer = setTimeout(apply, delay); else apply();
  }

  function buildRail() {
    const el = h("div", "dpa-rail");
    const bg = h("div", "dpa-rail-bg");
    const list = h("div", "dpa-rail-items");
    let avatar = null, name = null;
    const items = NAV.map((n, i) => {
      const it = h("div", "dpa-rail-item");
      it.onclick = () => { S.nav = i; railKey("ok"); };
      if (n.id === "profile") {
        // oben links: aktives Profil (Bild und Name), OK öffnet die Profilauswahl
        it.classList.add("dpa-rail-profile");
        avatar = h("div", "dpa-rail-avatar");
        name = h("span", "dpa-rail-name");
        const label = h("span", "dpa-rail-label");
        label.append(name, h("span", "dpa-rail-sub", "Profil wechseln"));
        it.append(avatar, label);
        el.append(it);
        return it;
      }
      it.append(icon(n.icon), h("span", "dpa-rail-label", n.label));
      list.append(it);
      return it;
    });
    el.prepend(bg);
    el.append(list);
    return { el, items, avatar, name };
  }
  function renderRail() {
    const p = S.profileInfo;
    if (p && rail.shown !== p.id + p.img) {
      rail.shown = p.id + p.img;
      rail.avatar.replaceChildren(pic(p.img));
      rail.name.textContent = p.name;
    }
    const t = top();
    const active = t.type === "search" ? "search" : t.type === "page" ? t.ref : "";
    rail.el.classList.toggle("dpa-rail-open", S.rail);
    rail.el.style.display = t.type === "detail" ? "none" : "";
    rail.items.forEach((el, i) => {
      el.classList.toggle("dpa-on", S.rail && i === S.nav);
      el.classList.toggle("dpa-active", NAV[i].id === active);
    });
  }

  // ---------- Reihen (Startseite, Seiten, Suche) ----------
  // Feste Maße in --u (10 px bei 1080p): keine Layout-Abfragen beim Blättern.
  const U = () => window.innerWidth / 192;
  const ROW_H = { wide: 4.4 + 18 + 4.6, tall: 4.4 + 28.5 + 4.6 };
  const STEP = { wide: 32 + 2, tall: 19 + 2 };

  /** Reihen-Tafel: hält nur die Reihen in Sichtweite im DOM */
  function makeBoard(container) {
    const el = h("div", "dpa-rows");
    container.append(el);
    return { el, rows: [], live: new Map(), offsets: [], focusEl: null };
  }
  function setBoardRows(b, rows) {
    b.rows = rows;
    let y = 0;
    b.offsets = rows.map((r) => { const o = y; y += r.tall ? ROW_H.tall : ROW_H.wide; return o; });
    // aufgebaute Reihen behalten, wenn Inhalt gleich; sonst neu
    for (const [id, live] of b.live) {
      const r = rows.find((x) => x.id === id);
      const sig = r ? r.cards.map((c) => c.id + (c.progress ?? "")).join() : "";
      if (!r || sig !== live.sig) { live.el.remove(); b.live.delete(id); if (b.focusEl && !b.focusEl.isConnected) b.focusEl = null; }
    }
  }
  function buildRow(row) {
    const el = h("div", "dpa-row" + (row.tall ? " dpa-tall" : ""));
    const track = h("div", "dpa-track");
    const step = row.tall ? STEP.tall : STEP.wide;
    const cards = row.cards.map((c, i) => {
      const ce = h("div", "dpa-card");
      ce.style.left = `calc(var(--u) * ${i * step})`;
      ce.dataset.i = i;
      return ce;
    });
    track.append(...cards);
    el.append(h("div", "dpa-row-title", row.title || ""), track);
    return { el, track, cards, filled: 0, sig: row.cards.map((c) => c.id + (c.progress ?? "")).join() };
  }
  /** Bilder nur bis kurz hinter den sichtbaren Bereich setzen */
  function fillRow(live, row, upto) {
    for (let i = live.filled; i < Math.min(upto, row.cards.length); i++) {
      const c = row.cards[i];
      const ce = live.cards[i];
      ce.append(pic(c.img), h("div", "dpa-card-name", c.title));
      if (c.progress != null && c.progress > 0) {
        const bar = h("div", "dpa-progress");
        const fill = h("div");
        fill.style.width = `${Math.round(clamp(c.progress, 0.03, 1) * 100)}%`;
        bar.append(fill);
        ce.append(bar);
      }
    }
    live.filled = Math.max(live.filled, Math.min(upto, row.cards.length));
  }
  /** Tafel zeichnen: Reihe r mit Spalte cols[id] ist gewählt (focus=false: nur Lage, keine Auswahl) */
  function renderBoard(b, r, cols, baseY, focus) {
    const u = U();
    const near = (i) => i >= r - 1 && i <= r + 3;
    b.rows.forEach((row, i) => {
      let live = b.live.get(row.id);
      if (!near(i)) {
        if (live) { live.el.remove(); b.live.delete(row.id); }
        return;
      }
      if (!live) {
        live = buildRow(row);
        live.el.style.top = `calc(var(--u) * ${b.offsets[i]})`;
        b.el.append(live.el);
        b.live.set(row.id, live);
      } else {
        live.el.style.top = `calc(var(--u) * ${b.offsets[i]})`;
      }
      live.el.classList.toggle("dpa-gone", i < r); // schon durchgeblätterte Reihen ausblenden
      const col = clamp(cols[row.id] || 0, 0, row.cards.length - 1);
      fillRow(live, row, col + (row.tall ? 11 : 7));
      const shift = Math.max(0, col - 0) * (row.tall ? STEP.tall : STEP.wide);
      live.track.style.transform = `translateX(${-shift * u}px)`;
    });
    b.el.style.transform = `translateY(${(baseY - (b.offsets[r] || 0)) * u}px)`;
    const want = focus && b.rows[r] ? b.live.get(b.rows[r].id)?.cards[clamp(cols[b.rows[r].id] || 0, 0, b.rows[r].cards.length - 1)] : null;
    if (b.focusEl !== want) {
      b.focusEl?.classList.remove("dpa-on");
      want?.classList.add("dpa-on");
      b.focusEl = want || null;
    }
  }

  // ---------- Ansicht: Seite (Startseite, Filme, Serien, Originals, Meine Liste) ----------

  let V = {}; // Elemente der aufgebauten Ansicht

  function buildPage(t) {
    trace("buildPage " + t.ref);
    viewEl.replaceChildren();
    const hero = h("div", "dpa-head dpa-head-hero");
    const logo = pic("", "dpa-logo");
    const title = h("div", "dpa-title");
    const meta = h("div", "dpa-meta");
    const desc = h("div", "dpa-desc");
    const btn = h("div", "dpa-btn");
    btn.append(icon("info"), h("span", null, "Details"));
    const btns = h("div", "dpa-btns");
    btns.append(btn);
    const dots = h("div", "dpa-dots");
    hero.append(logo, title, meta, desc, btns, dots);
    const info = h("div", "dpa-head dpa-head-info");
    const iTitle = h("div", "dpa-title dpa-small");
    const iMeta = h("div", "dpa-meta");
    const iDesc = h("div", "dpa-desc");
    info.append(iTitle, iMeta, iDesc);
    const empty = h("div", "dpa-empty");
    viewEl.append(hero, info, empty);
    const board = makeBoard(viewEl);
    V = { key: `page:${t.ref}`, hero, logo, title, meta, desc, btn, dots, info, iTitle, iMeta, iDesc, empty, board, version: -1, slideShown: -1 };
  }

  function renderPage(t) {
    const pg = getPage(t.ref);
    if (V.version !== pg.version) {
      // Auswahl über die Reihen-Kennung halten, wenn Reihen dazukommen
      const focusId = V.board.rows[t.row]?.id;
      setBoardRows(V.board, pg.rows);
      if (focusId) {
        const i = pg.rows.findIndex((r) => r.id === focusId);
        if (i >= 0) t.row = i;
      }
      V.version = pg.version;
      V.dots.replaceChildren(...pg.slides.map(() => h("div", "dpa-dot")));
      V.slideShown = -1;
    }
    const hasHero = pg.slides.length > 0;
    if (!hasHero && t.zone === "hero") t.zone = "rows";
    else if (hasHero && !t.touched && t.zone === "rows" && !t.row) t.zone = "hero"; // Banner kam später
    t.row = clamp(t.row, 0, Math.max(0, pg.rows.length - 1));
    viewEl.className = `dpa-view dpa-zone-${t.zone}`;
    V.empty.textContent = !pg.rows.length && !pg.loading && pages.get(t.ref).at
      ? (t.ref === "watchlist" ? "Noch nichts auf deiner Liste." : "Hier gibt es gerade nichts.") : "";

    if (hasHero) {
      t.slide = (t.slide + pg.slides.length) % pg.slides.length;
      const s = pg.slides[t.slide];
      if (V.slideShown !== t.slide) {
        V.slideShown = t.slide;
        V.logo.style.display = s.logo ? "" : "none";
        if (s.logo && V.logo.getAttribute("src") !== s.logo) { V.logo.classList.remove("dpa-ld"); V.logo.src = s.logo; }
        V.title.textContent = s.logo ? "" : s.title;
        V.meta.textContent = [s.prompt, s.meta].filter(Boolean).join("  •  ");
        V.desc.textContent = s.desc;
        [...V.dots.children].forEach((d, i) => d.classList.toggle("dpa-on", i === t.slide));
        // Nachbarbilder vorladen
        for (const n of [t.slide + 1, t.slide - 1]) {
          const x = pg.slides[(n + pg.slides.length) % pg.slides.length];
          if (x && !preloaded.has(x.bg)) { preloaded.add(x.bg); new Image().src = x.bg; }
        }
      }
    }
    V.btn.classList.toggle("dpa-on", t.zone === "hero" && !S.rail);
    const inRows = t.zone === "rows";
    const row = pg.rows[t.row];
    const c = row && row.cards[clamp(t.cols[row.id] || 0, 0, row.cards.length - 1)];
    if (inRows && c) {
      V.iTitle.textContent = c.title;
      V.iMeta.textContent = [c.sub, c.meta].filter(Boolean).join("  •  ");
      V.iDesc.textContent = c.desc;
      setBg(c.bg, 380); // erst wenn die Auswahl ruht
    } else if (hasHero) {
      setBg(pg.slides[t.slide].bg, 0);
    } else setBg("", 0);
    renderBoard(V.board, t.row, t.cols, inRows ? 50 : hasHero ? 74 : 50, inRows && !S.rail);
  }
  const preloaded = new Set();

  function pageKey(t, key) {
    const pg = getPage(t.ref);
    const row = pg.rows[t.row];
    if (t.zone === "hero") {
      if (key === "left") return openRail();
      if (key === "right") { t.slide++; autoSlideAt = Date.now(); }
      else if (key === "down" && pg.rows.length) t.zone = "rows";
      else if (key === "ok") { const s = pg.slides[t.slide]; if (s) openCard(s); }
      else if (key === "back") return backFromPage(t);
      return;
    }
    // Reihen
    if (!row) { if (key === "back") return backFromPage(t); if (key === "left") openRail(); return; }
    const col = clamp(t.cols[row.id] || 0, 0, row.cards.length - 1);
    if (key === "left") { if (col === 0) return openRail(); t.cols[row.id] = col - 1; }
    else if (key === "right") t.cols[row.id] = Math.min(row.cards.length - 1, col + 1);
    else if (key === "up") { if (t.row > 0) t.row--; else if (pg.slides.length) t.zone = "hero"; }
    else if (key === "down") t.row = Math.min(pg.rows.length - 1, t.row + 1);
    else if (key === "ok") openCard(row.cards[col]);
    else if (key === "back") {
      if (t.row > 0 || col > 0) { t.row = 0; t.cols = {}; if (pg.slides.length) t.zone = "hero"; }
      else if (pg.slides.length) t.zone = "hero";
      else return backFromPage(t);
    }
  }
  function backFromPage(t) {
    if (t.ref !== "home") return openNavItem(NAV.findIndex((n) => n.id === "home"));
    TV.home();
  }

  // Banner dreht sich langsam weiter, solange er gewählt ist und niemand drückt
  let autoSlideAt = Date.now();
  setInterval(() => {
    const t = top();
    if (S.mode !== "app" || S.rail || t.type !== "page" || t.zone !== "hero" || Date.now() - autoSlideAt < 9000) return;
    autoSlideAt = Date.now();
    t.slide++;
    render();
  }, 1000);

  // ---------- Ansicht: Suche ----------

  function buildSearch(t) {
    viewEl.replaceChildren();
    const field = h("div", "dpa-field");
    const label = h("span", null, "");
    const input = h("input");
    input.type = "text";
    field.append(icon("search"), label, input);
    const info = h("div", "dpa-head dpa-head-info");
    info.style.top = "calc(var(--u) * 18)";
    const iTitle = h("div", "dpa-title dpa-small");
    const iMeta = h("div", "dpa-meta");
    info.append(iTitle, iMeta);
    const empty = h("div", "dpa-empty");
    viewEl.append(field, info, empty);
    const board = makeBoard(viewEl);
    input.value = t.q || "";
    input.addEventListener("input", () => { t.q = input.value; t.row = 0; t.cols = {}; clearTimeout(V.typing); V.typing = setTimeout(render, 450); });
    V = { key: "search", field, label, input, info, iTitle, iMeta, empty, board, q: null };
  }
  function renderSearch(t) {
    const q = (t.q || "").trim();
    V.label.textContent = q || "Titel, Figuren oder Genres";
    V.field.classList.toggle("dpa-filled", !!q);
    V.field.classList.toggle("dpa-on", t.zone === "field" && !S.rail);
    const res = q.length >= 2 ? getSearch(q) : { cards: [], done: true };
    const sig = q + "|" + res.cards.length;
    if (V.q !== sig) {
      V.q = sig;
      const per = 5;
      const rows = [];
      for (let i = 0; i < res.cards.length; i += per) rows.push({ id: `s${i}`, title: i ? "" : "Ergebnisse", tall: false, cards: res.cards.slice(i, i + per) });
      setBoardRows(V.board, rows);
    }
    V.empty.textContent = q.length >= 2 && res.done && !res.cards.length ? `Nichts gefunden für „${q}“.` : "";
    viewEl.className = `dpa-view dpa-zone-${t.zone}`;
    // im Raster: Spalte über alle Reihen gleich
    for (const r of V.board.rows) t.cols[r.id] = Math.min(t.col || 0, r.cards.length - 1);
    t.row = clamp(t.row || 0, 0, Math.max(0, V.board.rows.length - 1));
    const row = V.board.rows[t.row];
    const c = row && row.cards[t.cols[row.id]];
    const inRows = t.zone === "rows" && c;
    V.info.style.opacity = inRows ? "1" : "0";
    if (inRows) {
      V.iTitle.textContent = c.title;
      V.iMeta.textContent = c.meta;
      setBg(c.bg, 380);
    } else setBg("", 0);
    // Raster: Spuren nicht verschieben (alle Karten passen)
    renderBoard(V.board, t.row, Object.fromEntries(V.board.rows.map((r) => [r.id, 0])), inRows ? 50 : 34, false);
    const want = inRows ? V.board.live.get(row.id)?.cards[t.cols[row.id]] : null;
    if (V.board.focusEl !== want) { V.board.focusEl?.classList.remove("dpa-on"); want?.classList.add("dpa-on"); V.board.focusEl = want || null; }
  }
  function searchKey(t, key) {
    if (t.zone === "field") {
      if (key === "ok") return openKeyboard(t);
      if (key === "down" && V.board.rows.length) { t.zone = "rows"; t.row = 0; t.col = 0; }
      else if (key === "left") openRail();
      else if (key === "back") openNavItem(NAV.findIndex((n) => n.id === "home"));
      return;
    }
    const row = V.board.rows[t.row];
    if (!row) { t.zone = "field"; return; }
    const col = t.cols[row.id] || 0;
    if (key === "left") { if (col === 0) return openRail(); t.col = col - 1; }
    else if (key === "right") t.col = Math.min(row.cards.length - 1, col + 1);
    else if (key === "up") { if (t.row > 0) t.row--; else t.zone = "field"; }
    else if (key === "down") t.row = Math.min(V.board.rows.length - 1, t.row + 1);
    else if (key === "ok") openCard(row.cards[col]);
    else if (key === "back") t.zone = "field";
  }
  function openKeyboard(t) {
    if (V.key !== "search") return;
    V.input.value = t.q || "";
    TV.keyboard(V.input, (value) => {
      t.q = value;
      if ((value || "").trim().length >= 2) { t.zone = "rows"; t.row = 0; t.col = 0; }
      render();
    });
  }

  // ---------- Ansicht: Detailseite ----------

  function buildDetail(t, d) {
    viewEl.replaceChildren();
    viewEl.className = "dpa-view dpa-detail";
    const head = h("div", "dpa-head");
    const logo = pic(d.logo, "dpa-logo");
    if (!d.logo) logo.style.display = "none";
    const title = h("div", "dpa-title", d.logo ? "" : d.title);
    const meta = h("div", "dpa-meta", d.meta);
    const desc = h("div", "dpa-desc", d.desc);
    const btns = h("div", "dpa-btns");
    const buttons = [];
    const addBtn = (iconName, label, run, round) => {
      const b = h("div", "dpa-btn" + (round ? " dpa-round" : ""));
      b.append(icon(iconName));
      if (label) b.append(h("span", null, label));
      b.onclick = run;
      btns.append(b);
      buttons.push({ el: b, run });
    };
    if (d.play) addBtn("play", d.play.label, () => play(d.play.id, d.title, ""));
    if (d.restart) addBtn("restart", d.restart.label, () => play(d.restart.id, d.title, "", true));
    if (d.watch) addBtn(d.watch.on ? "check" : "mylist", "", () => toggleWatchlist(t, d), true);
    head.append(logo, title, meta, desc, btns);
    const tabs = h("div", "dpa-tabs");
    const tabEls = d.tabs.map((tab, i) => {
      const el = h("div", "dpa-tab", tab.label);
      el.onclick = () => { t.tab = i; t.zone = "tabs"; render(); };
      tabs.append(el);
      return el;
    });
    viewEl.append(head, tabs);
    const tab = d.tabs[t.tab] || {};
    let seasonEls = [], itemEls = [], items = [], trackEl = null;
    if (tab.kind === "episodes") {
      if (d.seasons.length > 1) {
        const bar = h("div", "dpa-seasons");
        seasonEls = d.seasons.map((se, i) => {
          const el = h("div", "dpa-season", se.label);
          el.onclick = () => { t.season = i; t.col = 0; render(); };
          bar.append(el);
          return el;
        });
        viewEl.append(bar);
      }
      items = d.seasons[t.season]?.items || [];
    } else if (tab.kind === "recs") items = tab.items;
    if (tab.kind === "details") viewEl.append(h("div", "dpa-text", tab.text));
    if (items.length) {
      const wrap = h("div", "dpa-items" + (seasonEls.length ? " dpa-with-seasons" : ""));
      const track = h("div", "dpa-track");
      itemEls = items.map((it, i) => {
        const el = h("div", "dpa-ep");
        el.style.left = `calc(var(--u) * ${i * STEP.wide})`;
        const p = h("div", "dpa-ep-pic");
        p.append(pic(i < 10 ? it.img : ""));
        if (it.progress > 0) {
          const bar = h("div", "dpa-progress");
          const fill = h("div");
          fill.style.width = `${Math.round(clamp(it.progress, 0.03, 1) * 100)}%`;
          bar.append(fill);
          p.append(bar);
        }
        el.append(p, h("div", "dpa-ep-title", tab.kind === "episodes" ? `${it.no ? it.no + ". " : ""}${it.title}` : it.title));
        if (tab.kind === "episodes") el.append(h("div", "dpa-ep-meta", it.meta), h("div", "dpa-ep-desc", it.desc));
        else el.append(h("div", "dpa-ep-meta", it.meta));
        el.onclick = () => { t.col = i; t.zone = "items"; detailKey(t, "ok"); };
        track.append(el);
        return el;
      });
      wrap.append(track);
      viewEl.append(wrap);
      trackEl = track;
    } else if (tab.kind === "episodes") {
      viewEl.append(h("div", "dpa-text", d.seasons[t.season]?.loading || !d.seasons[t.season]?.items ? "Folgen werden geladen …" : "Keine Folgen."));
    }
    V = { key: `detail:${t.id}`, sig: detailSig(t, d), buttons, tabEls, seasonEls, itemEls, items, track: trackEl, filled: 10, tab };
  }
  const detailSig = (t, d) => JSON.stringify([d.title, d.play?.label, d.restart?.label, d.watch?.on, d.tabs.map((x) => x.label + (x.items ? x.items.length : "")),
    t.tab, t.season, (d.seasons[t.season]?.items || []).map((e) => e.id + e.progress)]);

  function renderDetail(t) {
    const entry = getDetail(t.id);
    const d = entry.data;
    if (!d) return renderLoading(entry.error ? "Diese Seite lässt sich gerade nicht laden." : "");
    t.tab = clamp(t.tab || 0, 0, Math.max(0, d.tabs.length - 1));
    t.season = clamp(t.season || 0, 0, Math.max(0, d.seasons.length - 1));
    if (d.tabs[t.tab]?.kind === "episodes") loadSeason(entry, t.season);
    if (V.key !== `detail:${t.id}` || V.sig !== detailSig(t, d)) buildDetail(t, d);
    const zones = detailZones(t);
    if (!zones.includes(t.zone)) t.zone = zones[0];
    V.buttons.forEach((b, i) => b.el.classList.toggle("dpa-on", t.zone === "buttons" && i === (t.btn || 0)));
    V.tabEls.forEach((el, i) => { el.classList.toggle("dpa-active", i === t.tab); el.classList.toggle("dpa-on", t.zone === "tabs" && i === t.tab); });
    V.seasonEls.forEach((el, i) => { el.classList.toggle("dpa-active", i === t.season); el.classList.toggle("dpa-on", t.zone === "seasons" && i === t.season); });
    t.col = clamp(t.col || 0, 0, Math.max(0, V.itemEls.length - 1));
    V.itemEls.forEach((el, i) => el.classList.toggle("dpa-on", t.zone === "items" && i === t.col));
    if (V.track) {
      const u = U();
      V.track.style.transform = `translateX(${-t.col * STEP.wide * u}px)`;
      // Bilder weiter rechts erst bei Bedarf
      for (let i = V.filled; i < Math.min(V.items.length, t.col + 8); i++) {
        const im = V.itemEls[i].querySelector("img");
        if (im && !im.src) im.src = V.items[i].img;
      }
      V.filled = Math.max(V.filled, t.col + 8);
    }
    setBg(d.bg, 0);
  }
  function detailZones(t) {
    const z = [];
    if (V.buttons.length) z.push("buttons");
    if (V.tabEls.length) z.push("tabs");
    if (V.seasonEls.length) z.push("seasons");
    if (V.itemEls.length) z.push("items");
    return z.length ? z : ["buttons"];
  }
  function detailKey(t, key) {
    const d = getDetail(t.id).data;
    if (!d) { if (key === "back") popView(); return; }
    const zones = detailZones(t);
    const zi = zones.indexOf(t.zone);
    if (key === "back") return popView();
    if (key === "up" && zi > 0) t.zone = zones[zi - 1];
    else if (key === "down" && zi < zones.length - 1) t.zone = zones[zi + 1];
    else if (t.zone === "buttons") {
      if (key === "left") t.btn = Math.max(0, (t.btn || 0) - 1);
      else if (key === "right") t.btn = Math.min(V.buttons.length - 1, (t.btn || 0) + 1);
      else if (key === "ok") V.buttons[t.btn || 0]?.run();
    } else if (t.zone === "tabs") {
      if (key === "left" && t.tab > 0) { t.tab--; t.col = 0; }
      else if (key === "right" && t.tab < d.tabs.length - 1) { t.tab++; t.col = 0; }
      else if (key === "ok" && zones.includes("items")) t.zone = zones[zones.length - 1];
    } else if (t.zone === "seasons") {
      if (key === "left" && t.season > 0) { t.season--; t.col = 0; }
      else if (key === "right" && t.season < d.seasons.length - 1) { t.season++; t.col = 0; }
      else if (key === "ok") t.zone = "items";
    } else if (t.zone === "items") {
      if (key === "left") t.col = Math.max(0, t.col - 1);
      else if (key === "right") t.col = Math.min(V.items.length - 1, t.col + 1);
      else if (key === "ok") {
        const it = V.items[t.col];
        if (!it) return;
        if (V.tab.kind === "episodes") play(it.play, d.title, [it.label, it.title].filter(Boolean).join(" "));
        else openCard(it);
      }
    }
  }

  /** „Meine Liste“: Disneys Knopf auf der (unsichtbar) mitlaufenden Detailseite drücken */
  async function toggleWatchlist(t, d) {
    d.watch.on = !d.watch.on; // sofort zeigen
    V.sig = "";
    render();
    const path = location.pathname.replace(/\/(home|browse\/.*)$/, "") + `/browse/${t.id}`;
    if (!location.pathname.endsWith(`/browse/${t.id}`)) go(path.replace(/^\/+/, "/"));
    for (let i = 0; i < 40; i++) {
      const btn = $(`${tid("add-to-watchlist-button")}, ${tid("remove-from-watchlist-button")}`);
      if (btn && location.pathname.endsWith(t.id)) {
        const isOn = btn.matches(tid("remove-from-watchlist-button"));
        if (isOn !== d.watch.on) btn.click();
        break;
      }
      await sleep(200);
    }
    const w = pages.get("watchlist");
    if (w) w.at = 0;
    setTimeout(() => { getDetail(t.id).at = 0; getDetail(t.id); }, 1500);
  }

  // ---------- Navigation ----------

  function openCard(c) {
    if (!c) return;
    if (c.play) return play(c.play, c.title, c.sub);
    if (c.page) pushView({ type: "detail", id: c.page, zone: "buttons", btn: 0, tab: 0, season: 0, col: 0 });
  }
  function pushView(v) {
    S.stack.push(v);
    S.rail = false;
    render();
  }
  function popView() {
    if (S.stack.length > 1) S.stack.pop();
    render();
  }
  function openRail() {
    S.rail = true;
    const t = top();
    const active = NAV.findIndex((n) => n.id === (t.type === "search" ? "search" : t.ref));
    S.nav = active >= 0 ? active : 2;
  }
  function railKey(key) {
    if (key === "up") S.nav = Math.max(0, S.nav - 1);
    else if (key === "down") S.nav = Math.min(NAV.length - 1, S.nav + 1);
    else if (key === "right" || key === "back") S.rail = false;
    else if (key === "ok") openNavItem(S.nav);
  }
  function openNavItem(i) {
    const n = NAV[i];
    S.rail = false;
    if (n.id === "profile") {
      // sofort die eigene Auswahl zeigen (Profile aus Disneys Schnittstelle); Disney lädt erst nach der Wahl
      if (S.profileInfo?.profiles?.length) {
        const cur = S.profileInfo.profiles.findIndex((p) => p.id === S.profileInfo.id);
        pushView({ type: "profiles", sel: Math.max(0, cur) });
      } else switchTo(null);
      return;
    }
    if (n.id === "search") {
      S.stack = [{ type: "search", zone: "field", q: "", row: 0, col: 0, cols: {} }];
      render();
      setTimeout(() => top().type === "search" && openKeyboard(top()), 50);
      return;
    }
    S.stack = [{ type: "page", ref: n.id, zone: "hero", row: 0, cols: {}, slide: 0 }];
    render();
  }

  /** Disneys Profilauswahl aufrufen (nur per Seitenaufruf möglich) und dort gleich das gewählte Profil drücken */
  function switchTo(p) {
    if (p) expectProfile(p);
    store.set("switchTo", p ? { name: p.name, img: p.img, at: Date.now() } : { at: Date.now(), manual: true });
    renderLoading("");
    const loc = (location.pathname.match(/^\/([a-z]{2}-[a-z]{2})\//) || [])[1];
    location.href = `${loc ? "/" + loc : ""}/select-profile`;
  }
  function pendingSwitch() {
    const sw = store.get("switchTo");
    return sw && Date.now() - sw.at < 60e3 ? sw : null;
  }
  function buildProfilePick(t) {
    viewEl.replaceChildren();
    viewEl.className = "dpa-view";
    const page = h("div", "dpa-profiles");
    page.append(h("div", "dpa-wordmark", "Disney+"), h("h1", null, "Profil wechseln"));
    const row = h("div", "dpa-profile-row");
    const els = S.profileInfo.profiles.map((p, i) => {
      const tile = h("div", "dpa-profile");
      const av = h("div", "dpa-avatar");
      av.append(pic(p.img));
      tile.append(av, h("div", "dpa-profile-name", p.name));
      if (p.pin) { const l = icon("lock"); l.className = "dpa-lock"; tile.append(l); }
      tile.onclick = () => { t.sel = i; profilePickKey(t, "ok"); };
      row.append(tile);
      return tile;
    });
    page.append(row);
    viewEl.append(page);
    V = { key: "pick", els };
    setBg("", 0);
  }
  function renderProfilePick(t) {
    if (V.key !== "pick") buildProfilePick(t);
    t.sel = clamp(t.sel || 0, 0, V.els.length - 1);
    V.els.forEach((el, i) => el.classList.toggle("dpa-on", i === t.sel));
  }
  function profilePickKey(t, key) {
    const list = S.profileInfo.profiles;
    if (key === "left") t.sel--;
    else if (key === "right") t.sel++;
    else if (key === "back") popView();
    else if (key === "ok") {
      const p = list[clamp(t.sel, 0, list.length - 1)];
      if (p.id === S.profileInfo.id) return popView();
      S.pinProfile = { name: p.name, img: p.img };
      switchTo(p);
    }
  }

  // ---------- Abspielen ----------

  function play(deeplinkId, title, sub, fromStart) {
    if (!deeplinkId) return;
    S.playInfo = { title, sub, at: Date.now() };
    S.restartAt = fromStart ? Date.now() : 0;
    S.playing = Date.now();
    renderLoading("");
    go(`/play/${deeplinkId}`);
  }

  // ---------- Profile und PIN (Daten aus der Disney-Seite) ----------

  function avatarSrc(el) {
    const im = el && (el.matches("img") ? el : $("img", el));
    if (im) return im.currentSrc || im.src || "";
    const bg = el && getComputedStyle(el).backgroundImage;
    return (bg && bg.match(/url\("?([^")]+)"?\)/) || [])[1] || "";
  }
  function readProfiles() {
    return $$("[data-testid^='profile-avatar-']").map((t) => ({
      el: t,
      name: t.getAttribute("aria-label") || text(t),
      img: avatarSrc($(tid("selected-avatar-image"), t) || t),
      lock: !!(t.parentElement && $("svg[aria-label='lock']", t.parentElement)),
    }));
  }
  function renderProfiles() {
    const profiles = readProfiles();
    const sig = JSON.stringify(profiles.map((p) => [p.name, p.img, p.lock]));
    if (V.key !== "profiles" || V.sig !== sig) {
      viewEl.replaceChildren();
      viewEl.className = "dpa-view";
      const page = h("div", "dpa-profiles");
      page.append(h("div", "dpa-wordmark", "Disney+"), h("h1", null, "Wer schaut gerade?"));
      const row = h("div", "dpa-profile-row");
      const els = profiles.map((p, i) => {
        const tile = h("div", "dpa-profile");
        const av = h("div", "dpa-avatar");
        av.append(pic(p.img));
        tile.append(av, h("div", "dpa-profile-name", p.name));
        if (p.lock) { const l = icon("lock"); l.className = "dpa-lock"; tile.append(l); }
        tile.onclick = () => { S.profile = i; profilesKey("ok"); };
        row.append(tile);
        return tile;
      });
      page.append(row);
      viewEl.append(page);
      V = { key: "profiles", sig, profiles, els };
      setBg("", 0);
    }
    S.profile = clamp(S.profile || 0, 0, Math.max(0, V.profiles.length - 1));
    V.els.forEach((el, i) => el.classList.toggle("dpa-on", i === S.profile));
  }
  function profilesKey(key) {
    if (V.key !== "profiles") return;
    if (key === "left") S.profile--;
    else if (key === "right") S.profile++;
    else if (key === "back") {
      // aus „Profil wechseln“ gekommen: zurück zur Startseite, sonst RaspiTV
      if (pendingSwitch()?.manual) { store.set("switchTo", 0); history.back(); }
      else TV.home();
      return;
    }
    else if (key === "ok") {
      store.set("switchTo", 0);
      const p = V.profiles[clamp(S.profile, 0, V.profiles.length - 1)];
      if (!p) return;
      S.pinProfile = p;
      expectProfile((S.profileInfo?.profiles || []).find((x) => x.name === p.name) || null);
      pages.clear(); details.clear(); searches.clear();
      S.stack = [{ type: "page", ref: "home", zone: "hero", row: 0, cols: {}, slide: 0 }];
      p.el.click();
    }
  }

  const PIN_DEL = "⌫";
  const PIN_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", PIN_DEL];
  const PIN_ACTIONS = ["PIN vergessen?", "Abbrechen"];
  function renderPin() {
    if (V.key !== "pin") {
      viewEl.replaceChildren();
      viewEl.className = "dpa-view";
      S.pin = "";
      S.pinRow = 0;
      S.pinKey = 0;
      const page = h("div", "dpa-pin");
      const head = h("div", "dpa-pin-head");
      const av = h("div", "dpa-avatar");
      av.append(pic(S.pinProfile?.img || avatarSrc($(tid("selected-avatar-image")))));
      head.append(av, h("div", "dpa-pin-name", S.pinProfile?.name || text($("h1, h2, h3"))));
      const boxes = h("div", "dpa-pin-boxes");
      const boxEls = [0, 1, 2, 3].map(() => h("div", "dpa-pin-box"));
      boxes.append(...boxEls);
      const error = h("div", "dpa-pin-error");
      const pad = h("div", "dpa-pin-pad");
      const keyEls = PIN_KEYS.map((k, i) => {
        const b = h("div", "dpa-pin-key" + (k === PIN_DEL ? " dpa-del" : ""), k);
        b.onclick = () => { S.pinRow = 0; S.pinKey = i; pinKey("ok"); };
        pad.append(b);
        return b;
      });
      const actions = h("div", "dpa-pin-actions");
      const actEls = PIN_ACTIONS.map((label, i) => {
        const b = h("div", "dpa-pin-action", label);
        b.onclick = () => { S.pinRow = 1; S.pinAction = i; pinKey("ok"); };
        actions.append(b);
        return b;
      });
      page.append(head, h("h1", null, "Gib deine Profil-PIN ein"), boxes, error, pad, actions);
      viewEl.append(page);
      V = { key: "pin", boxEls, keyEls, actEls, error };
      setBg("", 0);
    }
    // Disney leert die Felder nach einer falschen PIN – mitziehen
    const filled = [0, 1, 2, 3].filter((i) => ($(tid(`digit-${i}`)) || {}).value).length;
    if (filled < S.pin.length && Date.now() - (S.pinSetAt || 0) > 1500) S.pin = S.pin.slice(0, filled);
    V.boxEls.forEach((b, i) => { b.classList.toggle("dpa-filled", i < S.pin.length); b.classList.toggle("dpa-current", i === S.pin.length); });
    V.keyEls.forEach((k, i) => k.classList.toggle("dpa-on", !S.pinRow && i === S.pinKey));
    V.actEls.forEach((a, i) => a.classList.toggle("dpa-on", S.pinRow === 1 && i === (S.pinAction || 0)));
    const err = $("[role=alert], [data-testid*='error' i]");
    V.error.textContent = err ? text(err) : "";
  }
  /** PIN an Disney übergeben (disney-main.js fügt sie als „Einfügen“ ein); nach 4 Ziffern prüft Disney selbst */
  function setPin(value) {
    S.pin = value;
    S.pinSetAt = Date.now();
    window.dispatchEvent(new CustomEvent("tv-disney-pin", { detail: value }));
  }
  function pressPin(k) {
    if (k === PIN_DEL) setPin(S.pin.slice(0, -1));
    else if (S.pin.length < 4) setPin(S.pin + k);
  }
  function pinKey(key) {
    if (key === "back") return closePin();
    if (!S.pinRow) {
      if (key === "left") S.pinKey = Math.max(0, S.pinKey - 1);
      else if (key === "right") S.pinKey = Math.min(PIN_KEYS.length - 1, S.pinKey + 1);
      else if (key === "down") { S.pinRow = 1; S.pinAction = 0; }
      else if (key === "ok") pressPin(PIN_KEYS[S.pinKey]);
    } else {
      if (key === "left") S.pinAction = 0;
      else if (key === "right") S.pinAction = 1;
      else if (key === "up") S.pinRow = 0;
      else if (key === "ok") {
        if (S.pinAction === 1) return closePin();
        $(tid("enter-pin-forgot-pin"))?.click();
      }
    }
  }
  function closePin() {
    S.pin = "";
    const cancel = $(tid("enter-pin-header-cancel-button"));
    if (cancel) cancel.click(); else history.back();
  }
  window.addEventListener("keydown", (e) => {
    if (S.mode !== "pin" || !/^[0-9]$/.test(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    pressPin(e.key);
    render();
  }, true);

  function renderLoading(message) {
    if (V.key !== "loading" || V.message !== message) {
      trace("loading " + message);
      viewEl.replaceChildren();
      viewEl.className = "dpa-view";
      const page = h("div", "dpa-loading");
      page.append(h("div", "dpa-spinner"));
      if (message) page.append(h("div", "dpa-message", message));
      viewEl.append(page);
      V = { key: "loading", message };
    }
  }

  // ---------- Was ist zu sehen? ----------

  function computeMode() {
    if (isPlayer()) return null;
    if (/\/enter-pin\//.test(location.pathname)) return $(tid("digit-0")) ? "pin" : "loading";
    if (/\/select-profile/.test(location.pathname)) {
      const sw = pendingSwitch();
      if (sw && !sw.manual) {
        // gewünschtes Profil gleich selbst drücken – Disneys Auswahl bekommt man nicht zu sehen
        const tile = $$("[data-testid^='profile-avatar-']").find((el) => (el.getAttribute("aria-label") || text(el)) === sw.name);
        if (tile && !S.autoPicked) {
          S.autoPicked = true;
          S.pinProfile = { name: sw.name, img: sw.img };
          store.set("switchTo", 0);
          tile.click();
        }
        return "loading";
      }
      if (S.autoPicked) return "loading"; // schon gedrückt: Disney wechselt gleich, ihre Auswahl nicht zeigen
      return $("[data-testid^='profile-avatar-']") ? "profiles" : "loading";
    }
    if (isLogin()) return null;
    // gerade „Abspielen“ gedrückt: Ladekreis, bis Disneys Player übernimmt
    if (S.playing && Date.now() - S.playing < 8000) return "loading";
    return "app";
  }

  let frame = 0;
  /** Neu zeichnen im nächsten Bild (mehrere Änderungen werden zusammengefasst) */
  function changed() {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(); });
  }

  let wasPlayer = false;
  function render() {
    const mode = computeMode();
    if (mode !== S.mode) {
      if (mode !== "app") S.rail = false;
      S.mode = mode;
    }
    const player = isPlayer();
    if (player) S.playing = 0;
    // Zurück aus dem Player: Fortschritt („Weiterschauen“, Folgen) neu holen
    if (wasPlayer && !player) {
      for (const pg of pages.values()) pg.at = 0;
      for (const d of details.values()) d.at = 0;
    }
    wasPlayer = player;

    html.classList.toggle("dpa-on", !!mode);
    // Disney-Seite schlafen lassen, solange sie nur Daten liefert (Profile/PIN liest die Oberfläche aus ihr)
    const asleep = mode === "app" || (mode === "loading" && !/\/(enter-pin|select-profile)/.test(location.pathname));
    html.classList.toggle("dpa-sleep", asleep);
    // Disneys Zeitgeber erst anhalten, wenn sie ihren Zugang hat (sonst startet sie womöglich gar nicht)
    const hidden = asleep && !!S.authed;
    if (hidden !== S.hidden) {
      S.hidden = hidden;
      bridge("hidden", { on: hidden }).catch(() => {});
    }
    if (!mode) {
      if (V.key) { viewEl.replaceChildren(); V = {}; setBg("", 0); }
      // Player oder Disney-Seite (Anmeldung) zeigen
      if (player || isLogin()) window.TVBoot?.release(); else window.TVBoot?.idle(400);
      return;
    }

    if (mode === "app") {
      const t = top();
      const pg = t.type === "page" ? getPage(t.ref) : null;
      if (pg && !pg.rows.length && !pg.slides.length) {
        // erster Start ohne Zwischenspeicher
        // Fehlermeldung erst, wenn es länger dauert (abgemeldet schickt Disney nach ein paar Sekunden selbst zur
        // Anmeldung – bis dahin nur der Ladekreis)
        renderLoading(pg.error && !pg.loading && performance.now() > 20000 ? "Disney+ ist gerade nicht erreichbar – versucht es gleich nochmal …" : "");
        if (pg.error) window.TVBoot?.release();
      } else if (pg) { if (V.key !== `page:${t.ref}`) buildPage(t); renderPage(t); }
      else if (t.type === "search") { if (V.key !== "search") buildSearch(t); renderSearch(t); }
      else if (t.type === "detail") renderDetail(t);
      else if (t.type === "profiles") renderProfilePick(t);
      renderRail();
      if (t.type === "profiles") rail.el.style.display = "none";
      // freigeben, sobald etwas Eigenes steht (aus dem Zwischenspeicher sofort)
      if (!pg || pg.rows.length || pg.slides.length) window.TVBoot?.release();
    } else {
      rail.el.style.display = "none";
      if (mode === "profiles") renderProfiles();
      else if (mode === "pin") renderPin();
      else renderLoading("");
      if (mode !== "loading") window.TVBoot?.release();
    }
  }

  // ---------- Tasten ----------

  TV.site.takeover = () => !!S.mode;
  TV.site.key = (key) => {
    autoSlideAt = Date.now();
    if (S.mode === "app") {
      if (S.rail) railKey(key);
      else {
        const t = top();
        t.touched = true;
        if (t.type === "page") pageKey(t, key);
        else if (t.type === "search") searchKey(t, key);
        else if (t.type === "detail") detailKey(t, key);
        else if (t.type === "profiles") profilePickKey(t, key);
      }
    } else if (S.mode === "profiles") profilesKey(key);
    else if (S.mode === "pin") pinKey(key);
    else if (key === "back" || key === "home") {
      if (S.playing) { S.playing = 0; history.back(); } else TV.home();
    }
    render();
  };

  // ---------- Player: eigene Leiste (Titel, Zeit, Fortschritt), Disneys Leiste ist ausgeblendet ----------

  function deep(selector, rootNode = document, out = []) {
    rootNode.querySelectorAll(selector).forEach((e) => out.push(e));
    rootNode.querySelectorAll("*").forEach((e) => e.shadowRoot && deep(selector, e.shadowRoot, out));
    return out;
  }
  const playingVideo = () => $$("video").find((v) => v.videoWidth > 0 && !v.paused) || $$("video").find((v) => v.videoWidth > 0) || null;
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 8 && r.height > 8; };
  /** „Intro überspringen“ / „Nächste Folge“, falls Disney ihn gerade anbietet */
  function skipButton() {
    return deep("button").find((b) => {
      const host = b.getRootNode().host;
      return host && /skip|up-next/.test(host.tagName.toLowerCase()) && shown(b);
    });
  }
  const ICON_PLAY = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M7 4l13 8-13 8z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
  let bar = null, skipPill = null, barTimer = 0;
  const clock = (sec) => {
    sec = Math.max(0, Math.floor(sec));
    const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
    return (hh ? `${hh}:${String(mm).padStart(2, "0")}` : `${mm}`) + `:${String(ss).padStart(2, "0")}`;
  };
  function buildBar() {
    bar = h("div");
    bar.id = "tv-player-bar";
    const titles = h("div", "tv-pb-titles");
    titles.append(h("div", "tv-pb-title"), h("div", "tv-pb-sub"));
    const row = h("div", "tv-pb-row");
    const track = h("div", "tv-pb-track");
    track.append(h("div", "tv-pb-fill"), h("div", "tv-pb-knob"));
    row.append(h("div", "tv-pb-icon"), h("div", "tv-pb-time tv-pb-now"), track, h("div", "tv-pb-time tv-pb-left"));
    bar.append(titles, row, h("div", "tv-pb-hint"));
    skipPill = h("div");
    skipPill.id = "tv-skip";
    skipPill.append(h("span", "tv-skip-ok", "OK"), h("span"));
    html.append(bar, skipPill);
  }
  // Titel, Folge und Laufzeit (Disneys Video meldet als Dauer „unendlich“) – aus der Schnittstelle
  let info = null, infoPath = "", infoAt = 0;
  function refreshInfo() {
    if (!isPlayer()) { info = null; infoPath = ""; return; }
    if (infoPath === location.pathname && info?.duration) return;
    if (Date.now() - infoAt < 3000) return;
    infoAt = Date.now();
    const path = location.pathname;
    bridge("player").then((x) => { if (x && location.pathname === path) { info = x; infoPath = path; } }).catch(() => {});
  }
  function duration(v) {
    if (v.duration && isFinite(v.duration)) return v.duration;
    return (infoPath === location.pathname && info?.duration) || 0;
  }
  function showBar(hint, keep) {
    const v = playingVideo();
    if (!v || !isPlayer()) return;
    if (!bar) buildBar();
    const known = infoPath === location.pathname && info?.title ? info
      : S.playInfo && S.playInfo.at > Date.now() - 6 * 3600e3 ? S.playInfo : null;
    bar.querySelector(".tv-pb-title").textContent = known?.title || (document.title || "").replace(/\s*\|\s*Disney\+\s*$/, "");
    bar.querySelector(".tv-pb-sub").textContent = known?.sub || "";
    bar.querySelector(".tv-pb-icon").innerHTML = v.paused ? ICON_PLAY : ICON_PAUSE;
    const dur = duration(v);
    const ratio = dur ? Math.min(1, v.currentTime / dur) : 0;
    bar.querySelector(".tv-pb-fill").style.width = `${ratio * 100}%`;
    bar.querySelector(".tv-pb-knob").style.left = `${ratio * 100}%`;
    bar.querySelector(".tv-pb-now").textContent = clock(v.currentTime);
    const left = dur - v.currentTime;
    bar.querySelector(".tv-pb-left").textContent = !dur ? "" : left >= 60 ? `noch ${Math.round(left / 60)} Min.` : `noch ${clock(left)}`;
    bar.querySelector(".tv-pb-hint").textContent = hint || (v.paused ? "Pausiert – OK zum Fortsetzen" : "◀ ▶ 10 Sekunden  ·  ▲ ▼ 1 Minute");
    bar.classList.add("tv-pb-show");
    clearTimeout(barTimer);
    if (!v.paused && !keep) barTimer = setTimeout(() => bar.classList.remove("tv-pb-show"), 4000);
  }
  function hideBar() {
    bar?.classList.remove("tv-pb-show");
    skipPill?.classList.remove("tv-skip-show");
  }
  function seek(seconds) {
    const v = playingVideo();
    if (!v) return;
    const dur = duration(v) || Infinity;
    v.currentTime = clamp(v.currentTime + seconds, 0, dur - 2);
    const abs = Math.abs(seconds);
    showBar(`${seconds < 0 ? "−" : "+"}${abs >= 60 ? `${abs / 60} Min.` : `${abs} Sek.`}`);
  }
  // Pille für „Überspringen“, Leiste aktuell halten, „Von vorn“ umsetzen
  setInterval(() => {
    refreshInfo();
    if (!isPlayer()) { if (S.mode !== null || !bar) hideBar(); return; }
    if (!skipPill) buildBar();
    const skip = skipButton();
    const label = skip ? (skip.textContent || skip.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim() : "";
    skipPill.classList.toggle("tv-skip-show", !!skip);
    if (label && skipPill.lastChild.textContent !== label) skipPill.lastChild.textContent = label;
    if (bar?.classList.contains("tv-pb-show")) showBar(bar.querySelector(".tv-pb-hint").textContent, true);
    if (S.restartAt && Date.now() - S.restartAt < 30000) {
      const v = playingVideo();
      if (v && v.currentTime > 5 && !v.paused) { v.currentTime = 0; S.restartAt = 0; }
    }
  }, 500);

  Object.assign(TV.site, {
    inPlayer: isPlayer,
    playerKey(key) {
      if (key === "back") {
        hideBar();
        history.back();
        return true;
      }
      const v = playingVideo();
      if (!v) return true;
      if (key === "ok") {
        const skip = skipButton();
        if (skip) { skip.click(); showBar("Übersprungen"); }
        else { v.paused ? v.play() : v.pause(); setTimeout(() => showBar(), 60); }
      } else if (key === "left" || key === "right") seek(key === "left" ? -10 : 10);
      else if (key === "up" || key === "down") seek(key === "down" ? -60 : 60);
      else showBar();
      return true;
    },
    playPause() {
      if (!isPlayer()) return false;
      const v = playingVideo();
      if (!v) return false;
      v.paused ? v.play() : v.pause();
      setTimeout(() => showBar(), 60);
      return true;
    },
  });

  // ---------- Start ----------

  // Aktives Profil (für die Leiste) – und Zwischenspeicher verwerfen, wenn es ein anderes ist als beim letzten Mal
  S.profileInfo = store.get("profile");
  setInterval(() => {
    if (!S.authed || isPlayer() || store.get("expect") || (S.profileInfo && Date.now() - (S.profileAt || 0) < 5000)) return;
    S.profileAt = Date.now();
    bridge("profile").then((p) => {
      if (!p || !p.id) return;
      const before = S.profileInfo && S.profileInfo.id;
      if (!S.profileInfo || before !== p.id || S.profileInfo.img !== p.img || JSON.stringify(S.profileInfo.profiles) !== JSON.stringify(p.profiles)) {
        S.profileInfo = p;
        store.set("profile", p);
        if (before && before !== p.id) {
          // anderes Profil: dessen eigene Daten (Zwischenspeicher sofort, frische gleich danach)
          pages.clear(); details.clear(); searches.clear();
          S.stack = [{ type: "page", ref: "home", zone: "hero", row: 0, cols: {}, slide: 0 }];
          V = {};
        }
        changed();
      }
    }).catch(() => {});
  }, 1000);
  // Seitenwechsel bei Disney (Profilwahl, Player …) bemerken: Adresse und Seiteninhalt grob beobachten
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) { lastPath = location.pathname; render(); return; }
    // Profil-, PIN- und Anmeldeseite werden von Disney nachgeladen – solange weiter prüfen
    if (S.mode !== "app" || S.playing) render();
  }, 300);
  render();
  // Testhilfe: Detailseite direkt öffnen
  TV.disneyOpen = (id) => { pushView({ type: "detail", id: /^entity-/.test(id) ? id : `entity-${id}`, zone: "buttons", btn: 0, tab: 0, season: 0, col: 0 }); };
})();
