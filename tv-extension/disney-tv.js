// Disney+ im Stil der Disney+-TV-App: eine eigene Oberfläche über der Disney+-Webseite.
//
// Wie bei Netflix (netflix-tv.js) läuft die Webseite unsichtbar darunter weiter, liefert die Daten
// (Banner, Reihen, Folgen …) und bekommt Aktionen weitergereicht. Aussehen und Bedienelemente
// teilen sich beide Oberflächen (netflix-tv.css + disney-tv.css). Im Player (/play) bleibt die
// Disney-eigene Bedienleiste sichtbar; die Fernbedienung steuert sie.
(() => {
  if (!window.TV) return;
  document.documentElement.classList.add("tv-disney");

  // ---------- Hilfsfunktionen ----------

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const shown = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 8 && r.height > 8;
  };
  const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const src = (img) => (img ? img.currentSrc || img.src || "" : "");
  const leaves = (el) =>
    el ? $$("*", el).filter((e) => !e.children.length).map(text).filter((t) => t && t !== "•" && t !== "·") : [];
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  /** Disney schreibt manche Beschriftungen zweimal (sichtbar + für Screenreader): "FOLGENFOLGEN" -> "FOLGEN". */
  const undouble = (t) => {
    const n = t.length / 2;
    return Number.isInteger(n) && t.slice(0, n).toLowerCase() === t.slice(n).toLowerCase() ? t.slice(0, n) : t;
  };
  const tid = (id) => `[data-testid='${id}']`;

  /** Disney-Bilder in passender Auflösung anfordern (die Bild-Adressen haben einen width-Parameter). */
  function sized(url, width) {
    if (!url || !/bamgrid\.com/.test(url)) return url || "";
    return /[?&]width=\d+/.test(url) ? url.replace(/([?&]width=)\d+/, `$1${width}`) : url + (url.includes("?") ? "&" : "?") + `width=${width}`;
  }

  function h(tag, cls, content) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (content != null) el.textContent = content;
    return el;
  }
  function img(url, cls) {
    const el = h("img", cls);
    el.decoding = "async";
    el.addEventListener("load", () => el.classList.add("nf-loaded"));
    if (url) el.src = url;
    if (el.complete && url) el.classList.add("nf-loaded");
    return el;
  }
  function icon(name) {
    const span = h("span", "nf-icon");
    span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
    return span;
  }
  function progressOf(el) {
    const bar = $("progress, [role=progressbar][aria-valuenow]", el);
    if (bar && bar.tagName === "PROGRESS" && bar.max) return bar.value / bar.max;
    if (bar && bar.getAttribute("aria-valuemax")) return bar.getAttribute("aria-valuenow") / bar.getAttribute("aria-valuemax");
    const styled = $$("[style*='width']", el).find((e) => /width:\s*[\d.]+%/.test(e.getAttribute("style")));
    return styled ? parseFloat(styled.style.width) / 100 : null;
  }
  function progressBar(value, cls = "nf-card-progress") {
    const bar = h("div", cls);
    const fill = h("div");
    fill.style.width = `${clamp(value, 0, 1) * 100}%`;
    bar.append(fill);
    return bar;
  }

  const ICONS = {
    back: '<path d="M15 5l-7 7 7 7"/>',
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
    down: '<path d="M6 9l6 6 6-6"/>',
  };

  // Linke Leiste: Ziele auf der Disney-Seite (data-testid der versteckten Navigation)
  const NAV = [
    { id: "search", label: "Suche", icon: "search", testid: "navigation-item-search", path: /\/browse\/search/ },
    { id: "home", label: "Startseite", icon: "home", testid: "navigation-item-0-Startseite", path: /^(\/[a-z]{2}-[a-z]{2})?\/home/ },
    { id: "watchlist", label: "Meine Liste", icon: "mylist", testid: "navigation-item-2-Meine Liste", path: /\/browse\/watchlist/ },
    { id: "movies", label: "Filme", icon: "movies", testid: "navigation-item-3-Filme", path: /\/browse\/movies/ },
    { id: "series", label: "Serien", icon: "series", testid: "navigation-item-4-Serien", path: /\/browse\/series/ },
    { id: "originals", label: "Originals", icon: "originals", testid: "navigation-item-5-Originals", path: /\/browse\/originals/ },
  ];

  const isPlayer = () => /\/play\//.test(location.pathname);
  const isDetail = () => /\/browse\/entity-/.test(location.pathname);

  // ---------- Daten aus der Disney-Seite ----------

  const rowCache = new Map(); // Reihen-Überschrift -> { title, cards }, in Lade-Reihenfolge
  const slideCache = new Map(); // Banner-Nummer -> Banner
  let cachePath = "";

  /** Bezeichnung ohne Disney-Zusätze wie "Für Details zu diesem Titel auswählen." */
  function cleanLabel(label) {
    return (label || "").replace(/\s*Für Details zu diesem Titel auswählen\.?/i, "").replace(/\s+/g, " ").trim();
  }

  /** Disney-Beschreibung "[Label: X] Titel Altersfreigabe: 12 Erscheinungsjahr: 2026. Genre" zerlegen. */
  function parseLabel(raw) {
    let label = cleanLabel(raw);
    let sub = "";
    const rest = label.match(/^(.*?)\s+(Noch\s.+)$/); // Weiterschauen: "Titel Noch 16 Minuten"
    if (rest) [label, sub] = [rest[1], rest[2]];
    const age = (label.match(/Altersfreigabe:\s*(\d+)/) || [])[1];
    const year = (label.match(/Erscheinungsjahr:\s*([\d–-]+)/) || [])[1];
    const genre = (label.match(/Erscheinungsjahr:\s*[\d–-]+\.\s*([^.]+)/) || [])[1];
    label = label.split(/\s+Altersfreigabe:/)[0].replace(/^.*?Label:\s*\S+(\s+\S+)?\s+(?=\S)/, (m) => (/Label:/.test(m) ? "" : m)).trim();
    return { label, sub, meta: [age && `ab ${age}`, year, genre && genre.trim()].filter(Boolean).join("  •  ") };
  }

  function cardData(a) {
    const pic = $("img", a);
    const art = $(`${tid("poster-vertical-title-art")} img`, a);
    const r = a.getBoundingClientRect();
    const parsed = parseLabel(a.getAttribute("aria-label"));
    return {
      href: a.getAttribute("href") || "",
      id: a.dataset.itemId || a.getAttribute("href"),
      label: (art && art.alt) || (pic && pic.alt) || parsed.label || text(a),
      sub: parsed.sub,
      meta: parsed.meta,
      img: sized(src(pic), 400),
      art: art ? sized(src(art), 320) : "", // Titel-Schriftzug, den Disney über Poster legt
      tall: r.height > r.width * 1.1, // hochkant (Poster) statt 16:9
      progress: progressOf(a.closest(tid("set-shelf-item")) || a),
    };
  }

  function readHome() {
    const heroSet = $(tid("hero-carousel-shelf"));
    // Das Karussell dreht sich selbst weiter und sortiert dabei um: nach fester Nummer ordnen
    // Beim Weiterdrehen legt Disney kurz Kopien ohne Nummer an – die zählen nicht. Gesehene Banner
    // werden gemerkt (wie die Reihen), sonst sähe jedes Drehen wie eine neue Seite aus.
    const slideNo = (el) => { const m = (el.id || "").match(/slide-(\d+)$/); return m ? +m[1] : -1; };
    $$(tid("hero-carousel-shelf-item")).filter((s) => slideNo(s) >= 0).forEach((s) => {
      const a = $("a", s);
      const rating = $(`${tid("undefined-ratings-and-features")} img`, s);
      const slide = {
        href: a ? a.getAttribute("href") : "",
        bg: sized(src($(tid("hero-carousel-item-background"), s)), 1920),
        logo: sized(src($(tid("hero-carousel-title-treatment"), s)), 900),
        title: parseLabel(a && a.getAttribute("aria-label")).label.split(/\n/)[0],
        prompt: text($(tid("hero-carousel-prompt"), s)),
        rating: rating ? rating.alt : "",
        meta: text($(tid("undefined-metadata-text"), s)),
      };
      if (slide.bg && slide.href) slideCache.set(slideNo(s), slide);
    });
    const slides = [...slideCache.keys()].sort((a, b) => a - b).map((n) => slideCache.get(n));

    // Disney lädt Reihen beim Scrollen nach (und kann sie wieder entfernen): gesehene Reihen merken
    $$(tid("set"))
      .filter((set) => !set.contains(heroSet) && !$(tid("hero-carousel-shelf"), set))
      .forEach((set) => {
        const title = text($("h2, h3, h4", set));
        const cards = $$(`a${tid("set-item")}`, set).filter((a) => $("img", a)).map(cardData);
        if (!cards.length) return;
        const known = rowCache.get(title);
        if (!known || cards.length >= known.cards.length) rowCache.set(title, { title, cards });
      });
    const rows = [...rowCache.values()];

    // Suche und Raster ohne "set": alle Karten zeilenweise
    if (!rows.length && !slides.length) {
      const items = $$(`a${tid("set-item")}`).filter((a) => shown(a) && $("img", a));
      const lines = new Map();
      for (const a of items) {
        const top = Math.round(a.getBoundingClientRect().top / 40);
        if (!lines.has(top)) lines.set(top, []);
        lines.get(top).push(a);
      }
      [...lines.values()].forEach((line, i) => rows.push({ title: i === 0 ? text($("main h1, main h2")) : "", cards: line.map(cardData) }));
    }
    return { slides, rows };
  }

  function readDetail() {
    const titleImg = $(`${tid("details-title-treatment")}`);
    const logo = titleImg && (titleImg.tagName === "IMG" ? titleImg : $("img", titleImg));
    const bg = $(tid("details-page-background-image-responsive")) || $(tid("details-page-background-image"));
    const panel = $(tid("tab-panel--active"));
    const watch = $(tid("add-to-watchlist-button"));
    const season = panel && $(tid("dropdown-button"), panel);
    const progressWrap = $(tid("details-progress-label"));

    const items = panel
      ? $$(`a${tid("set-item")}`, panel).map((a) => {
          const pic = $("img", a);
          const title = text($(tid("standard-regular-list-item-title"), a));
          return {
            el: a,
            href: a.getAttribute("href") || "",
            title: title || cleanLabel(a.getAttribute("aria-label")) || (pic && pic.alt) || "",
            desc: text($(tid("standard-regular-list-item-description"), a)),
            meta: (text($(tid("standard-regular-list-metadata"), a)).match(/\(([^)]+)\)/) || [])[1] || "",
            img: sized(src(pic), 400),
            progress: progressOf(a),
            episode: /\/play\//.test(a.getAttribute("href") || ""),
          };
        })
      : [];

    return {
      key: location.pathname,
      title: (document.title || "").replace(/\s*\|\s*Disney\+\s*$/, ""),
      bg: sized(src(bg), 1920),
      logo: sized(src(logo), 900),
      meta: [...new Set(leaves($(tid("masthead-metadata"))).flatMap((t) => t.split(/\s*•\s*/)))].filter((t) => t && t.length < 60),
      ratings: $$(`${tid("masthead-metadata")} img`).map((i) => i.alt).filter(Boolean),
      focused: text($(tid("details-featured-focused-title"))),
      synopsis: text($(tid("details-featured-description"))),
      progressText: text(progressWrap),
      progress: progressWrap ? progressOf(progressWrap.parentElement) : null,
      actions: $$(tid("playback-action-button")).map((a) => ({ el: a, label: text(a) || a.getAttribute("aria-label") || "Abspielen" })),
      watch: watch && { el: watch, added: !/hinzu/i.test(watch.getAttribute("aria-label") || "") },
      tabs: $$(tid("details-page-tab")).map((t) => ({ el: t, label: undouble(text(t)), active: t.getAttribute("aria-selected") === "true" || /active|selected/.test(t.className) })),
      season: season && { el: season, label: text(season) },
      items,
      details: items.length ? "" : text(panel).slice(0, 900),
    };
  }


  // ---------- Daten aus Disneys Schnittstelle (über disney-bridge.js im Seiten-Kontext) ----------
  // Startseite, Filme, Serien, Originals und Meine Liste kommen direkt aus der Schnittstelle, die auch die
  // Disney-Seite benutzt (deeplink → page → set). Die Disney-Seite muss dafür nichts zeichnen und wird nicht
  // mehr zum Nachladen gescrollt – sie schläft (content-visibility: hidden).
  const EXPLORE = "https://disney.api.edge.bamgrid.com/explore/v1.21/";
  let bridgeSeq = 0;
  const bridgeWait = new Map();
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.tvdp !== "res") return;
    const w = bridgeWait.get(e.data.id);
    if (!w) return;
    bridgeWait.delete(e.data.id);
    if (e.data.ok) w.resolve(e.data.data); else w.reject(new Error(e.data.error));
  });
  function bridge(op, args) {
    return new Promise((resolve, reject) => {
      const id = ++bridgeSeq;
      bridgeWait.set(id, { resolve, reject });
      window.postMessage({ tvdp: "req", id, op, args }, "*");
      setTimeout(() => { if (bridgeWait.delete(id)) reject(new Error("Zeitüberschreitung")); }, 20000);
    });
  }
  const explore = (path) => bridge("get", { url: EXPLORE + path });
  /** Seitenwechsel über Disneys eigenen Router (ohne Neuladen) */
  const go = (path) => bridge("navigate", { path }).catch(() => (location.href = path));

  const imageUrl = (id, width) =>
    id ? `https://disney.images.edge.bamgrid.com/ripcut-delivery/v2/variant/disney/${id}/compose?format=webp&width=${width}` : "";
  const artId = (art, kind, ...ratios) => {
    const set = art?.standard?.[kind] || {};
    for (const r of ratios) if (set[r]?.imageId) return set[r].imageId;
    const any = Object.values(set)[0];
    return any?.imageId || "";
  };
  function metaOf(v) {
    const m = v?.metastringParts || {};
    const years = m.releaseYearRange ? [m.releaseYearRange.startYear, m.releaseYearRange.endYear].filter(Boolean).join("–") : "";
    return [m.ratingInfo?.rating?.text && `ab ${m.ratingInfo.rating.text}`, years, m.genres?.values?.[0]].filter(Boolean).join("  •  ");
  }
  const TALL = /poster|vertical/;
  /** Eintrag der Schnittstelle → Karte (wie bisher cardData) */
  function apiCard(item, style) {
    const v = item.visuals || {};
    const action = (item.actions || []).find((a) => a.pageId || a.deeplinkId) || {};
    const tall = TALL.test(style || "");
    const playable = action.type === "playback";
    const pct = item.personalization?.userState?.progress?.progressPercentage;
    return {
      href: playable ? `/play/${action.deeplinkId}` : action.pageId ? `/browse/${action.pageId}` : "",
      id: item.id,
      label: v.title || action.visuals?.title || "",
      sub: v.episodeTitle || "",
      meta: metaOf(v),
      img: tall ? imageUrl(artId(v.artwork, "tile", "0.71", "0.67", "0.75"), 400)
        : imageUrl(artId(v.artwork, "tile", "1.78") || artId(v.artwork, "thumbnail", "1.78"), 400),
      art: "", // Disneys Kacheln enthalten den Titel-Schriftzug schon
      tall,
      progress: pct != null ? pct / 100 : null,
    };
  }
  function apiSlide(item) {
    const v = item.visuals || {};
    const action = (item.actions || []).find((a) => a.pageId) || {};
    return {
      href: action.pageId ? `/browse/${action.pageId}` : "",
      bg: imageUrl(artId(v.artwork, "background", "1.78") || artId(v.artwork, "hero", "1.78"), 1920),
      logo: imageUrl(artId(v.artwork, "title_treatment", "3.32", "1.78"), 900),
      title: v.title || "",
      prompt: v.promoLabel?.header || v.description?.brief || "",
      rating: v.metastringParts?.ratingInfo?.rating?.text || "",
      meta: metaOf(v).replace(/^ab \d+\s+•\s+/, ""),
    };
  }

  /** Disney-Adresse → Kennung der Seite in der Schnittstelle (home, movies, series, originals, watchlist) */
  function pageRef() {
    const m = location.pathname.match(/\/browse\/([a-z]+)$/);
    if (m && m[1] !== "search") return m[1];
    return /\/home$/.test(location.pathname) ? "home" : null;
  }

  const pages = new Map(); // Kennung → { slides, rows, sets: [{style, title, id, loaded}], ready, busy }
  async function loadPage(ref) {
    if (pages.has(ref)) return pages.get(ref);
    const pg = { slides: [], rows: [], sets: [], ready: false, error: "" };
    pages.set(ref, pg);
    try {
      const dl = await explore(`deeplink?refId=${ref}&refIdType=deeplinkId`);
      const pageId = JSON.stringify(dl).match(/page-[0-9a-f-]{36}/)?.[0];
      if (!pageId) throw new Error("Seite nicht gefunden");
      pg.pageId = pageId.replace(/^page-/, "");
      const data = await explore(`page/${pageId}?disableSmartFocus=true&enhancedContainersLimit=4&limit=20`);
      for (const c of data?.data?.page?.containers || []) {
        const style = c.style?.name || "";
        if (/hero/.test(style)) {
          pg.slides = (c.items || []).map(apiSlide).filter((x) => x.bg && x.href);
          if (!pg.slides.length) pg.heroSet = c.id; // kurz nach dem Start oft noch leer: gleich nachladen
          continue;
        }
        if (c.type !== "set") continue;
        const set = { id: c.id, style, title: c.visuals?.name || "", loaded: !!c.items?.length };
        pg.sets.push(set);
        if (set.loaded) pg.rows.push({ title: set.title, cards: c.items.map((it) => apiCard(it, style)).filter((x) => x.img) });
      }
      pg.ready = true;
      loadMoreRows(ref, 6);
    } catch (error) {
      // Gleich nach dem Start hat die Brücke oft noch keinen Zugang: kurz warten und neu versuchen
      pg.error = error.message;
      const tries = (retries.get(ref) || 0) + 1;
      retries.set(ref, tries);
      if (tries < 15) setTimeout(() => pages.get(ref) === pg && pages.delete(ref), 1500);
      else pg.ready = true; // aufgeben: Disney-Seite selbst zeigen
    }
    return pg;
  }
  const retries = new Map();

  /** Weitere Reihen laden (Disney liefert anfangs nur die ersten mit Karten) – in Seitenreihenfolge. */
  async function loadMoreRows(ref, count) {
    const pg = pages.get(ref);
    if (!pg || pg.busy) return;
    pg.busy = true;
    try {
      if (pg.heroSet && !pg.slides.length) {
        for (let attempt = 0; attempt < 5 && !pg.slides.length; attempt++) {
          if (attempt) await new Promise((r) => setTimeout(r, 2000));
          const data = await explore(`set/${pg.heroSet}?limit=20&pageId=${pg.pageId}`).catch(() => null);
          pg.slides = (data?.data?.set?.items || []).map(apiSlide).filter((x) => x.bg && x.href);
        }
      }
      let added = 0;
      for (const set of pg.sets) {
        if (added >= count) break;
        if (set.loaded) continue;
        set.loaded = true;
        try {
          const data = await explore(`set/${set.id}?limit=20&pageId=${pg.pageId}`);
          const items = data?.data?.set?.items || [];
          const cards = items.map((it) => apiCard(it, set.style)).filter((x) => x.img);
          if (cards.length) {
            pg.rows.push({ title: set.title || data?.data?.set?.visuals?.name || "", cards });
            added++;
          }
        } catch (e) { /* Reihe auslassen */ }
      }
    } finally {
      pg.busy = false;
    }
  }

  // ---------- Zustand ----------

  const S = {
    view: null,       // "home" | "detail" | "loading" | null
    zone: "hero",     // Startseite: "nav" | "hero" | "rows"
    nav: 1,
    slide: 0,         // gewählter Banner-Eintrag
    row: 0,
    cols: [],
    home: null,
    homeSig: "",
    d: null,
    dSig: "",
    dZone: "buttons", // Detailseite: "buttons" | "tabs" | "items"
    dBtn: 0,
    dTab: 0,
    dCol: 0,
    picker: null,
    returnZone: null,
    navAt: 0,
    navTarget: null,
  };
  TV.disney = S; // Zustand für Tests (dev/cdp.py --ext 'TV.disney')
  TV.disneyPages = pages; // geladene Seiten aus der Schnittstelle (für Tests)
  TV.disneyApi = { apiSlide, apiCard, explore };

  const root = h("div");
  root.id = "nftv";
  document.documentElement.append(root);
  let dom = {};

  function computeView() {
    if (isPlayer()) return null;
    if (/\/enter-pin\//.test(location.pathname)) return $(tid("digit-0")) ? "pin" : "loading";
    if (/\/select-profile/.test(location.pathname)) return $("[data-testid^='profile-avatar-']") ? "profiles" : "loading";
    if (S.navTarget && Date.now() - S.navAt < 8000 && (!S.navTarget.test(location.pathname) || Date.now() - S.navAt < 900)) return "loading";
    if (isDetail()) return $(tid("explore-details-view")) && $(tid("playback-action-button") + ", " + tid("details-page-tab")) ? "detail" : "loading";
    const ref = pageRef();
    if (ref) {
      const pg = pages.get(ref);
      if (!pg) loadPage(ref);
      if (pg && pg.ready && (pg.rows.length || pg.slides.length)) return "home";
      return pg && pg.ready && pg.error ? null : "loading";
    }
    if (/\/(home|browse)/.test(location.pathname)) {
      if ($(tid("hero-carousel-shelf-item") + ", " + tid("set-item"))) return "home";
      if (/\/browse\/search/.test(location.pathname)) return null; // leere Suche: Eingabe über die Tastatur
      if (!$("input[type=password], input[type=email]")) return "loading";
    }
    return null;
  }

  TV.site.takeover = () => !!S.view;

  // ---------- Startseite ----------

  function buildHome() {
    const { slides, rows } = S.home;
    root.replaceChildren();
    const page = h("div", "nf-home");
    dom.heroBg = img("", "nf-hero-bg");
    dom.peekBg = img("", "nf-peek-bg");
    page.append(dom.heroBg, dom.peekBg, h("div", "nf-shade"));

    // Banner (Karussell)
    const hero = h("div", "nf-hero");
    dom.heroLogo = img("", "nf-logo");
    dom.heroTitle = h("h1", "nf-title");
    dom.heroPrompt = h("div", "dp-prompt");
    dom.heroAttrs = h("div", "nf-attrs");
    const buttons = h("div", "nf-buttons");
    dom.heroBtn = h("div", "nf-btn nf-btn-primary");
    dom.heroBtn.append(icon("info"), h("span", "", "Details ansehen"));
    dom.heroBtn.onclick = () => { S.zone = "hero"; homeKey("ok"); };
    buttons.append(dom.heroBtn);
    dom.dots = h("div", "dp-dots");
    dom.dotEls = slides.map((s, i) => {
      const dot = h("div", "dp-dot");
      dot.onclick = () => { S.zone = "hero"; S.slide = i; renderHome(); };
      dom.dots.append(dot);
      return dot;
    });
    hero.append(dom.heroLogo, dom.heroTitle, dom.heroPrompt, dom.heroAttrs, buttons, dom.dots);
    page.append(hero);

    const peek = h("div", "nf-peek");
    dom.peekTitle = h("h1", "nf-peek-title");
    dom.peekRow = h("div", "nf-peek-row");
    peek.append(dom.peekTitle, dom.peekRow);
    page.append(peek);

    const rowsEl = h("div", "nf-rows");
    dom.rowsEl = rowsEl;
    dom.rows = [];
    rows.forEach((row) => appendRow(row));
    page.append(rowsEl);
    root.append(page, buildRail(), backButton());
  }

  /** Eine Reihe unten an die Startseite anhängen (auch nachträglich, ohne Neuaufbau). */
  function appendRow(row) {
    const rowEl = h("div", "nf-row");
    rowEl.append(h("h2", "nf-row-title", row.title));
    const track = h("div", "nf-track");
    rowEl.append(track);
    dom.rowsEl.append(rowEl);
    const entry = { el: rowEl, track, cards: [] };
    dom.rows.push(entry);
    appendCards(dom.rows.length - 1, row.cards);
  }

  /** Karten an eine bestehende Reihe anhängen. */
  function appendCards(r, cards) {
    const entry = dom.rows[r];
    for (const card of cards) {
      const i = entry.cards.length;
      const c = h("div", "nf-card" + (card.tall ? " dp-tall" : ""));
      c.onclick = () => { S.zone = "rows"; S.row = r; S.cols[r] = i; renderHome(); openCard(card); };
      c.append(img(card.img, "nf-card-img"));
      if (card.art) c.append(h("div", "dp-art-shade"), img(card.art, "dp-title-art"));
      if (card.progress != null) c.append(progressBar(card.progress));
      entry.track.append(c);
      entry.cards.push(c);
    }
  }

  function backButton() {
    const b = h("div", "nf-back");
    b.append(icon("back"));
    b.title = "Zurück";
    b.onclick = () => TV.site.key("back");
    return b;
  }

  function buildRail() {
    const rail = h("div", "nf-rail");
    const avatar = $(`${tid("dropdown-active-profile")}`);
    const avatarImg = avatar && (avatar.tagName === "IMG" ? avatar : $("img", avatar));
    if (avatarImg) rail.append(img(src(avatarImg), "nf-avatar"));
    dom.nav = NAV.map((item, i) => {
      const el = h("div", "nf-rail-item");
      el.onclick = () => { S.nav = i; navigate(item); };
      el.append(icon(item.icon), h("span", "nf-rail-label", item.label));
      rail.append(el);
      return el;
    });
    dom.rail = rail;
    return rail;
  }

  function renderHome() {
    const { slides, rows } = S.home;
    const hasHero = slides.length > 0;
    if (!hasHero && S.zone === "hero") S.zone = rows.length ? "rows" : "nav";
    S.row = clamp(S.row, 0, Math.max(0, rows.length - 1));
    const inRows = S.zone === "rows" || (S.zone === "nav" && S.returnZone === "rows");

    root.classList.toggle("nf-in-rows", inRows || !hasHero);
    root.classList.toggle("nf-nav-open", S.zone === "nav");
    root.classList.remove("nf-d-in-rows");
    dom.rail.classList.toggle("nf-rail-open", S.zone === "nav");
    const active = NAV.findIndex((n) => n.path.test(location.pathname));
    dom.nav.forEach((el, i) => {
      el.classList.toggle("nf-on", S.zone === "nav" && i === S.nav);
      el.classList.toggle("nf-active", i === active);
    });

    // Banner: aktuellen Eintrag zeigen
    if (hasHero) {
      S.slide = (S.slide + slides.length) % slides.length;
      const s = slides[S.slide];
      setImg(dom.heroBg, s.bg, true);
      dom.heroLogo.style.display = s.logo ? "" : "none";
      setImg(dom.heroLogo, s.logo);
      for (const n of [S.slide + 1, S.slide - 1]) {
        const next = slides[(n + slides.length) % slides.length];
        if (next && !preloaded.has(next.bg)) {
          preloaded.add(next.bg);
          new Image().src = next.bg;
          if (next.logo) new Image().src = next.logo;
        }
      }
      dom.heroTitle.textContent = s.logo ? "" : s.title;
      dom.heroPrompt.textContent = s.prompt;
      dom.heroAttrs.textContent = [s.rating && `ab ${s.rating}`, s.meta].filter(Boolean).join("  •  ");
      dom.dotEls.forEach((d, i) => d.classList.toggle("dp-on", i === S.slide));
    }
    dom.heroBtn.classList.toggle("nf-on", S.zone === "hero");

    const top = inRows || !hasHero ? 44 : 77;
    const first = inRows || !hasHero ? S.row : 0;
    const offset = dom.rows[first] ? dom.rows[first].el.offsetTop : 0;
    dom.rowsEl.style.transform = `translateY(calc(var(--u) * ${top} - ${offset}px))`;
    // Nur Reihen in Sichtweite zeichnen und anfassen – sonst schiebt der Pi bei jedem Schritt
    // Hunderte Karten mit Schatten mit und ruckelt. Erst alle Positionen lesen, dann schreiben
    // (abwechselndes Lesen/Schreiben erzwingt sonst pro Reihe ein neues Layout).
    const near = (r) => r >= S.row - 1 && r <= S.row + 3;
    const shifts = dom.rows.map((row, r) => {
      if (!near(r)) return null;
      const col = clamp(S.cols[r] || 0, 0, row.cards.length - 1);
      S.cols[r] = col;
      // Karten sind unterschiedlich breit (Poster/Kacheln): an der echten Position ausrichten
      return row.cards[col] ? row.cards[col].offsetLeft : 0;
    });
    dom.rows.forEach((row, r) => {
      row.el.classList.toggle("nf-row-gone", (inRows || !hasHero) && r < S.row);
      row.el.classList.toggle("dp-far", shifts[r] === null);
      if (shifts[r] === null) return;
      const col = S.cols[r];
      row.track.style.transform = `translateX(${-shifts[r]}px)`;
      row.cards.forEach((c, i) => {
        c.classList.toggle("nf-on", S.zone === "rows" && r === S.row && i === col);
        c.classList.toggle("nf-past", i < col);
      });
    });

    const row = rows[S.row];
    const card = row && row.cards[S.cols[S.row] || 0];
    if (inRows && card) {
      dom.peekTitle.textContent = card.label;
      dom.peekRow.textContent = [card.meta, card.sub, row.title].filter(Boolean).join("  •  ");
      setImg(dom.peekBg, card.img, true);
    }
  }

  const preloaded = new Set();

  /** Bild wechseln; mit keep bleibt das alte sichtbar, bis das neue geladen ist (kein Aufblitzen). */
  function setImg(el, url, keep) {
    if (el.dataset.src === url) return;
    el.dataset.src = url || "";
    if (!keep) el.classList.remove("nf-loaded");
    if (url) el.src = url;
    else el.removeAttribute("src");
  }

  function homeKey(key) {
    const { slides, rows } = S.home;
    if (S.zone === "nav") {
      if (key === "up") S.nav = Math.max(0, S.nav - 1);
      else if (key === "down") S.nav = Math.min(NAV.length - 1, S.nav + 1);
      else if (key === "right" || key === "back") S.zone = S.returnZone || (slides.length ? "hero" : "rows");
      else if (key === "ok") return navigate(NAV[S.nav]);
    } else if (S.zone === "hero") {
      // Links/rechts blättert durch die Banner-Titel, am Anfang geht es in die Leiste
      if (key === "left" && S.slide === 0) openNav("hero");
      else if (key === "left") S.slide--;
      else if (key === "right") S.slide++;
      else if (key === "down" && rows.length) (S.zone = "rows"), (S.row = 0);
      else if (key === "up") openNav("hero");
      else if (key === "back") TV.home();
      else if (key === "ok") openCard(slides[S.slide], "hero");
    } else if (S.zone === "rows") {
      const row = rows[S.row];
      const col = S.cols[S.row] || 0;
      if (key === "left") {
        if (col === 0) openNav("rows");
        else S.cols[S.row] = col - 1;
      } else if (key === "right") {
        if (col < row.cards.length - 1) S.cols[S.row] = col + 1;
      } else if (key === "up") {
        if (S.row > 0) S.row--;
        else if (slides.length) S.zone = "hero";
      } else if (key === "down") {
        if (S.row < rows.length - 1) S.row++;
        if (S.row >= rows.length - 3) loadMoreRows(pageRef(), 4); // weitere Reihen aus der Schnittstelle
      } else if (key === "back") {
        if (slides.length) (S.zone = "hero"), (S.row = 0);
        else TV.home();
      } else if (key === "ok") {
        openCard(row.cards[col], "rows");
      }
    }
    renderHome();
  }

  function openNav(from) {
    S.returnZone = from;
    S.zone = "nav";
    const active = NAV.findIndex((n) => n.path.test(location.pathname));
    S.nav = active >= 0 ? active : 1;
  }

  function navigate(item) {
    const link = $(`a${tid(item.testid)}`) || $(tid(item.testid));
    S.zone = "hero";
    S.returnZone = null;
    S.row = 0;
    S.cols = [];
    S.slide = 0;
    if (item.id === "search") {
      if (link) link.click();
      setTimeout(openSearch, 1200);
      return;
    }
    S.navAt = Date.now();
    S.navTarget = item.path;
    if (link) link.click();
  }

  /** Suche: Bildschirmtastatur auf das Suchfeld von Disney legen; Ergebnisse erscheinen als Reihen. */
  function openSearch() {
    const input = $("input[type=search], input[data-testid*='search'], input[name*='search' i], input[placeholder]");
    if (!input) return;
    TV.keyboard(input, () => {
      S.zone = "rows";
      S.row = 0;
      S.cols = [];
    });
  }

  function openCard(card, from) {
    if (!card || !card.href) return;
    S.returnZone = from;
    S.navAt = Date.now();
    S.navTarget = /\/play\//.test(card.href) ? /\/play\// : /\/browse\/entity-/;
    go(card.href); // Disneys Router, ohne Neuladen
  }

  // ---------- Detailseite ----------

  function buildDetail() {
    const d = S.d;
    root.replaceChildren();
    const page = h("div", "nf-detail");
    page.append(img(d.bg, "nf-d-bg"), h("div", "nf-d-shade"));
    const mini = h("div", "nf-d-mini");
    mini.append(d.logo ? img(d.logo) : h("h1", "", d.title));
    page.append(mini);

    const info = h("div", "nf-d-info");
    info.append(d.logo ? img(d.logo, "nf-logo") : h("h1", "nf-title", d.title));
    const attrs = [d.ratings.length && `ab ${d.ratings[0]}`, ...d.meta.filter((m) => !d.ratings.includes(m))].filter(Boolean);
    if (attrs.length) info.append(h("div", "nf-attrs", attrs.join("  •  ")));
    if (d.focused) info.append(h("div", "dp-focused", d.focused));
    if (d.synopsis) info.append(h("p", "nf-syn", d.synopsis));
    if (d.progressText) {
      const prog = h("div", "nf-d-progress");
      if (d.progress != null) prog.append(progressBar(d.progress, "nf-d-bar"));
      prog.append(h("span", "", d.progressText));
      info.append(prog);
    }

    const buttons = h("div", "nf-buttons");
    dom.dButtons = [];
    const addButton = (iconName, label, action, primary) => {
      const b = h("div", "nf-btn" + (primary ? " nf-btn-primary" : ""));
      b.append(icon(iconName), h("span", "", label));
      b.onclick = () => action();
      buttons.append(b);
      dom.dButtons.push({ el: b, action });
    };
    d.actions.forEach((a, i) => addButton(i === 0 ? "play" : "restart", titleCase(a.label), () => play(a.el), i === 0));
    if (d.watch) addButton(d.watch.added ? "check" : "mylist", "Meine Liste", () => d.watch.el.click());
    info.append(buttons);
    page.append(info);

    // Reiter (Folgen / Empfehlungen / Details) und ihr Inhalt
    const lower = h("div", "dp-lower");
    const tabs = h("div", "dp-tabs");
    dom.tabs = d.tabs.map((t, i) => {
      const el = h("div", "dp-tab" + (t.active ? " dp-tab-active" : ""), titleCase(t.label));
      el.onclick = () => { S.dZone = "tabs"; S.dTab = i; selectTab(); };
      tabs.append(el);
      return el;
    });
    if (d.season) {
      dom.seasonChip = h("div", "dp-tab dp-season");
      dom.seasonChip.append(h("span", "", d.season.label), icon("down"));
      dom.seasonChip.onclick = openPicker;
      tabs.append(dom.seasonChip);
    } else dom.seasonChip = null;
    lower.append(tabs);

    const track = h("div", "nf-track dp-items");
    dom.items = d.items.map((it, i) => {
      const c = h("div", "nf-card nf-ep");
      const pic = h("div", "nf-ep-pic");
      pic.append(img(it.img, "nf-card-img"));
      if (it.progress) pic.append(progressBar(it.progress));
      c.append(pic, h("div", "nf-ep-title", it.title));
      if (it.meta || it.desc) c.append(h("div", "nf-ep-sub", it.meta || it.desc));
      c.onclick = () => { S.dZone = "items"; S.dCol = i; openItem(it); };
      track.append(c);
      return c;
    });
    lower.append(track);
    if (d.details) lower.append(h("p", "dp-details", d.details));
    dom.itemsTrack = track;
    page.append(lower);
    dom.lower = lower;

    dom.picker = h("div", "nf-picker");
    page.append(dom.picker);
    root.append(page, backButton());
  }

  const titleCase = (s) => (s && s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s);

  /** Fokusbare Einträge der Reiter-Zeile: Reiter, danach ggf. die Staffelwahl. */
  const tabCount = () => dom.tabs.length + (dom.seasonChip ? 1 : 0);

  function renderDetail() {
    const z = S.dZone;
    root.classList.toggle("nf-d-in-rows", z !== "buttons");
    root.classList.remove("nf-nav-open", "nf-in-rows");
    S.dBtn = clamp(S.dBtn, 0, Math.max(0, dom.dButtons.length - 1));
    dom.dButtons.forEach((b, i) => b.el.classList.toggle("nf-on", z === "buttons" && !S.picker && i === S.dBtn));
    S.dTab = clamp(S.dTab, 0, Math.max(0, tabCount() - 1));
    dom.tabs.forEach((t, i) => t.classList.toggle("nf-on", z === "tabs" && !S.picker && i === S.dTab));
    if (dom.seasonChip) dom.seasonChip.classList.toggle("nf-on", z === "tabs" && !S.picker && S.dTab === dom.tabs.length);
    S.dCol = clamp(S.dCol, 0, Math.max(0, dom.items.length - 1));
    dom.items.forEach((c, i) => {
      c.classList.toggle("nf-on", z === "items" && !S.picker && i === S.dCol);
      c.classList.toggle("nf-past", z === "items" && i < S.dCol);
    });
    const cur = dom.items[S.dCol];
    dom.itemsTrack.style.transform = `translateX(${-(z === "items" && cur ? cur.offsetLeft : 0)}px)`;
    dom.lower.style.transform = `translateY(calc(var(--u) * ${z === "buttons" ? 74 : 30}))`;

    dom.picker.classList.toggle("nf-picker-open", !!S.picker);
    if (S.picker) {
      dom.picker.replaceChildren(
        h("h2", "", "Staffel wählen"),
        ...S.picker.options.map((o, i) => {
          const item = h("div", "nf-picker-item" + (i === S.picker.index ? " nf-on" : ""), o.label);
          item.onclick = () => { S.picker.index = i; pickerKey("ok"); };
          return item;
        })
      );
    }
  }

  function detailKey(key) {
    if (S.picker) return pickerKey(key);
    if (key === "back") return history.back();
    const z = S.dZone;
    if (z === "buttons") {
      if (key === "left") S.dBtn--;
      else if (key === "right") S.dBtn++;
      else if (key === "down" && tabCount()) S.dZone = "tabs";
      else if (key === "ok" && dom.dButtons[S.dBtn]) dom.dButtons[S.dBtn].action();
    } else if (z === "tabs") {
      if (key === "left") S.dTab--;
      else if (key === "right") S.dTab++;
      else if (key === "up") S.dZone = "buttons";
      else if (key === "down" && dom.items.length) (S.dZone = "items"), (S.dCol = 0);
      else if (key === "ok") return selectTab();
    } else {
      if (key === "left") S.dCol--;
      else if (key === "right") S.dCol++;
      else if (key === "up") S.dZone = "tabs";
      else if (key === "ok" && S.d.items[S.dCol]) openItem(S.d.items[S.dCol]);
    }
    renderDetail();
  }

  function selectTab() {
    if (dom.seasonChip && S.dTab === dom.tabs.length) return openPicker();
    const tab = S.d.tabs[S.dTab];
    if (tab) tab.el.click(); // Inhalt kommt beim nächsten Lesen der Seite
    renderDetail();
  }

  function openItem(it) {
    if (it.episode) play(it.el);
    else it.el.click(); // Empfehlung: deren Detailseite öffnen
  }

  function openPicker() {
    const toggle = S.d.season.el;
    toggle.click(); // Disney-Menü (versteckt) öffnen, um die Staffeln auszulesen
    setTimeout(() => {
      const scope = toggle.closest(tid("dropdown")) || toggle.parentElement || document;
      const options = $$("[role=option], [role=menuitem], li, button", scope)
        .filter((o) => o !== toggle && /Staffel|Season|Teil/i.test(text(o)))
        .map((o) => ({ label: text(o), el: o }));
      if (!options.length) return toggle.click();
      const current = options.findIndex((o) => o.label === S.d.season.label);
      S.picker = { options, index: Math.max(0, current) };
      renderDetail();
    }, 400);
  }

  function pickerKey(key) {
    const p = S.picker;
    if (key === "up") p.index = Math.max(0, p.index - 1);
    else if (key === "down") p.index = Math.min(p.options.length - 1, p.index + 1);
    else if (key === "back") {
      S.picker = null;
      S.d.season.el.click();
    } else if (key === "ok") {
      p.options[p.index].el.click();
      S.picker = null;
      S.dZone = "items";
      S.dCol = 0;
    }
    renderDetail();
  }

  function play(el) {
    el.click();
  }

  // ---------- Player: Disney-eigene Leiste über die Fernbedienung steuern ----------

  /** Element im Player suchen – auch in den Schattenbäumen der Player-Bausteine. */
  function deep(selector, rootNode = document, out = []) {
    rootNode.querySelectorAll(selector).forEach((e) => out.push(e));
    rootNode.querySelectorAll("*").forEach((e) => e.shadowRoot && deep(selector, e.shadowRoot, out));
    return out;
  }

  function wakeControls() {
    // Die Leiste erscheint bei Mausbewegung über dem Player
    // Nur pointer-actions bzw. die Player-Oberfläche reagieren auf Mausbewegungen
    const surface = deep("pointer-actions")[0] || deep("disney-web-player-ui")[0] || document.body;
    const r = surface.getBoundingClientRect();
    surface.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  }

  const playingVideo = () => $$("video").find((v) => v.videoWidth > 0) || null;

  /** Knopf "Intro überspringen" / "Nächste Folge", falls Disney ihn gerade anbietet. */
  function skipButton() {
    return deep("button").find((b) => {
      const host = b.getRootNode().host;
      return host && /skip|up-next/.test(host.tagName.toLowerCase()) && shown(b);
    });
  }

  Object.assign(TV.site, {
    inPlayer: isPlayer,
    playerKey(key) {
      if (key === "back") {
        history.back();
        return true;
      }
      wakeControls(); // Disney-Leiste einblenden, damit man sieht, was passiert
      const v = playingVideo();
      if (key === "ok") {
        const skip = skipButton();
        if (skip) skip.click();
        else if (v) v.paused ? v.play() : v.pause();
      } else if ((key === "left" || key === "right") && v) {
        v.currentTime = Math.max(0, v.currentTime + (key === "left" ? -10 : 10));
      }
      return true;
    },
  });

  // ---------- Steuerung ----------

  TV.site.key = (key) => {
    if (S.view === "home" && S.home) homeKey(key);
    else if (S.view === "detail" && S.d) detailKey(key);
    else if (S.view === "profiles" && S.profiles) profilesKey(key);
    else if (S.view === "pin") pinKey(key);
    else if (S.view === "loading" && (key === "back" || key === "home")) TV.home();
  };

  // ---------- Profilauswahl ----------

  /** Bild eines Profils: <img> oder CSS-Hintergrund des Avatar-Elements. */
  function avatarSrc(el) {
    const pic = el && (el.matches("img") ? el : $("img", el));
    if (pic) return src(pic);
    const bg = el && getComputedStyle(el).backgroundImage;
    const m = bg && bg.match(/url\("?([^")]+)"?\)/);
    return m ? m[1] : "";
  }

  function readProfiles() {
    return $$("[data-testid^='profile-avatar-']").map((t) => ({
      el: t,
      name: t.getAttribute("aria-label") || text(t),
      img: avatarSrc($(tid("selected-avatar-image"), t) || t),
      lock: !!(t.parentElement && $("svg[aria-label='lock']", t.parentElement)),
    }));
  }

  const LOCK_SVG =
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6' +
    'a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V7a3 3 0 0 0-6 0z"/></svg>';

  function buildProfiles() {
    root.replaceChildren();
    const page = h("div", "nf-profiles dp-profiles");
    page.append(h("div", "dp-wordmark dp-wordmark-small", "Disney+"), h("h1", "nf-profiles-title", "Wer schaut gerade?"));
    const row = h("div", "nf-profiles-row");
    dom.profiles = S.profiles.map((p, i) => {
      const tile = h("div", "nf-profile");
      const pic = h("div", "nf-profile-pic");
      pic.append(img(p.img));
      tile.append(pic, h("div", "nf-profile-name", p.name));
      if (p.lock) {
        const lock = h("div", "dp-profile-lock");
        lock.innerHTML = LOCK_SVG;
        tile.append(lock);
      }
      tile.onclick = () => { S.profile = i; profilesKey("ok"); };
      row.append(tile);
      return tile;
    });
    page.append(row);
    root.append(page, backButton());
  }

  function renderProfiles() {
    S.profile = clamp(S.profile || 0, 0, S.profiles.length - 1);
    dom.profiles.forEach((t, i) => t.classList.toggle("nf-on", i === S.profile));
  }

  function profilesKey(key) {
    if (key === "left") S.profile--;
    else if (key === "right") S.profile++;
    else if (key === "back") return TV.home();
    else if (key === "ok") {
      const p = S.profiles[clamp(S.profile, 0, S.profiles.length - 1)];
      S.pinProfile = p;
      S.pin = "";
      S.pinKey = 0;
      p.el.click();
    }
    renderProfiles();
  }

  // ---------- PIN-Eingabe (vier einzelne Ziffernfelder bei Disney) ----------

  const PIN_BACKSPACE = "\u232B";
  // Wie in der Disney+-TV-App: eine waagrechte Zahlenreihe, darunter "PIN vergessen?" und "Abbrechen"
  const PIN_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", PIN_BACKSPACE];
  const PIN_ACTIONS = ["PIN vergessen?", "Abbrechen"];

  function buildPin() {
    root.replaceChildren();
    const page = h("div", "dp-pin");
    const name = (S.pinProfile && S.pinProfile.name) || text($("h1, h2, h3"));
    const picUrl = (S.pinProfile && S.pinProfile.img) || avatarSrc($(tid("selected-avatar-image")));
    const head = h("div", "dp-pin-head");
    const pic = h("div", "nf-profile-pic dp-pin-pic");
    pic.append(img(picUrl));
    head.append(pic, h("div", "dp-pin-name", name));
    page.append(head, h("h1", "dp-pin-title", "Gib deine Profil-PIN ein"));
    dom.pinBoxes = [0, 1, 2, 3].map(() => h("div", "dp-pin-box"));
    const boxes = h("div", "dp-pin-boxes");
    boxes.append(...dom.pinBoxes);
    dom.pinError = h("div", "dp-pin-error");
    page.append(boxes, dom.pinError);

    const pad = h("div", "dp-pin-pad");
    dom.pinKeys = PIN_DIGITS.map((k, i) => {
      const b = h("div", "dp-pin-key" + (k === PIN_BACKSPACE ? " dp-pin-del" : ""), k);
      b.onclick = () => { S.pinRow = 0; S.pinKey = i; pinKey("ok"); };
      pad.append(b);
      return b;
    });
    const actions = h("div", "dp-pin-actions");
    dom.pinActions = PIN_ACTIONS.map((label, i) => {
      const b = h("div", "dp-pin-action", label);
      b.onclick = () => { S.pinRow = 1; S.pinAction = i; pinKey("ok"); };
      actions.append(b);
      return b;
    });
    page.append(pad, actions);
    root.append(page, backButton());
  }

  function renderPin() {
    dom.pinBoxes.forEach((b, i) => {
      b.classList.toggle("dp-filled", i < S.pin.length);
      b.classList.toggle("dp-current", i === S.pin.length);
    });
    dom.pinKeys.forEach((k, i) => k.classList.toggle("nf-on", !S.pinRow && i === S.pinKey));
    dom.pinActions.forEach((a, i) => a.classList.toggle("nf-on", S.pinRow === 1 && i === (S.pinAction || 0)));
    const error = $("[role=alert], [data-testid*='error' i]");
    dom.pinError.textContent = error ? text(error) : "";
  }

  /** PIN an Disney übergeben (über disney-main.js als "Einfügen"); nach 4 Ziffern prüft Disney selbst. */
  function setPin(value) {
    S.pin = value;
    S.pinSetAt = Date.now();
    window.dispatchEvent(new CustomEvent("tv-disney-pin", { detail: value }));
  }

  function pinKey(key) {
    if (key === "back") return closePin();
    if (!S.pinRow) {
      if (key === "left") S.pinKey = Math.max(0, S.pinKey - 1);
      else if (key === "right") S.pinKey = Math.min(PIN_DIGITS.length - 1, S.pinKey + 1);
      else if (key === "down") (S.pinRow = 1), (S.pinAction = 0);
      else if (key === "ok") pressPin(PIN_DIGITS[S.pinKey]);
    } else {
      if (key === "left") S.pinAction = 0;
      else if (key === "right") S.pinAction = 1;
      else if (key === "up") S.pinRow = 0;
      else if (key === "ok") {
        if (S.pinAction === 1) return closePin();
        const forgot = $(tid("enter-pin-forgot-pin"));
        if (forgot) forgot.click();
      }
    }
    renderPin();
  }

  function pressPin(k) {
    if (k === PIN_BACKSPACE) return setPin(S.pin.slice(0, -1));
    if (S.pin.length < 4) setPin(S.pin + k);
  }

  function closePin() {
    S.pin = "";
    const cancel = $(tid("enter-pin-header-cancel-button"));
    if (cancel) cancel.click();
    else history.back();
  }

  window.addEventListener("keydown", (e) => {
    if (S.view !== "pin" || !/^[0-9]$/.test(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    pressPin(e.key);
    renderPin();
  }, true);

  function buildLoading() {
    root.replaceChildren();
    const page = h("div", "nf-loading dp-loading");
    page.append(h("div", "dp-wordmark", "Disney+"), h("div", "nf-spinner"));
    root.append(page);
  }

  // Per Skript gestartete Animationen der Disney-Seite (Web Animations, z. B. Lade-Platzhalter) laufen trotz
  // content-visibility weiter und erzwingen 60 Bilder/s. Im Schlaf anhalten, beim Aufwachen fortsetzen.
  const pausedAnims = new Set();
  let animCheckAt = 0;
  function pauseHiddenAnimations(asleep) {
    if (!asleep) {
      for (const a of pausedAnims) { try { a.play(); } catch (e) { /* schon entfernt */ } }
      pausedAnims.clear();
      return;
    }
    if (Date.now() - animCheckAt < 2000) return;
    animCheckAt = Date.now();
    for (const a of document.getAnimations()) {
      const t = a.effect && a.effect.target;
      if (a.playState === "running" && t && document.body.contains(t)) {
        a.pause();
        pausedAnims.add(a);
      }
    }
  }

  function update() {
    const view = computeView();
    document.documentElement.classList.toggle("nftv-on", !!view);
    // Vorschau-Videos der versteckten Seite anhalten – nie das Video des Players
    if (view) {
      for (const v of $$("video")) {
        if (v.closest(tid("disney-web-player-wrapper") + ", " + tid("disney-web-player-container"))) continue;
        v.muted = true;
        if (!v.paused) v.pause();
      }
    }

    // Startseite fertig geladen: die versteckte Disney-Seite schlafen legen (nicht mehr berechnen,
    // nicht mehr auslesen). Sonst rechnet sie bei jedem Bild ihre ~700 Sichtbarkeits-Beobachter
    // durch und die Navigation ruckelt. Nach dem Zurückkommen von anderen Seiten (Detail, Player)
    // bleibt sie 5 s wach, damit z. B. "Weiterschauen" aktuell eingelesen wird.
    // Seiten aus der Schnittstelle (Startseite, Filme, Serien …): die Disney-Seite wird dafür nicht gebraucht und
    // schläft (nicht zeichnen, nicht berechnen). Wach bleibt sie nur für Detailseiten, Profile, PIN und Player.
    const wasAsleep = S.asleep;
    S.asleep = view === "home" && !!pageRef();
    document.documentElement.classList.toggle("dp-asleep", S.asleep);
    if (S.asleep !== wasAsleep) bridge("hidden", { on: S.asleep }).catch(() => {}); // Disneys Zeitgeber anhalten
    pauseHiddenAnimations(S.asleep);

    if (view === "home") {
      const pg = pages.get(pageRef());
      const data = pg ? { slides: pg.slides, rows: pg.rows.slice() } : readHome();
      // Neu aufbauen nur bei anderer Seite oder anderem Banner. Nachgeladene Reihen und Karten
      // werden angehängt, damit Bilder und Auswahl stehen bleiben.
      const sig = JSON.stringify([location.pathname, data.slides.map((s) => s.href)]);
      const fresh = S.view !== "home" || sig !== S.homeSig || !S.home;
      const stable = !fresh && S.home.rows.every((old, r) => data.rows[r] && data.rows[r].title === old.title &&
        old.cards.every((c, i) => data.rows[r].cards[i] && data.rows[r].cards[i].id === c.id));
      if (fresh || !stable) {
        // Grund festhalten (für Tests: TV.disney.rebuilds)
        let reason = fresh ? (S.view !== "home" ? "Ansicht" : sig !== S.homeSig ? "Banner/Seite" : "neu") : "";
        if (!reason) {
          const r = S.home.rows.findIndex((old, i) => !data.rows[i] || data.rows[i].title !== old.title ||
            old.cards.some((c, j) => !data.rows[i].cards[j] || data.rows[i].cards[j].id !== c.id));
          const old = S.home.rows[r], now = data.rows[r];
          reason = `Reihe ${r} "${old && old.title}" -> "${now && now.title}" (${old && old.cards.length} -> ${now && now.cards.length})`;
        }
        S.rebuilds = (S.rebuilds || []).slice(-9).concat(reason);
        if (S.view === "detail" && S.returnZone) S.zone = S.returnZone;
        S.home = data;
        S.homeSig = sig;
        buildHome();
      } else {
        data.rows.forEach((row, r) => {
          if (r >= dom.rows.length) appendRow(row);
          else if (row.cards.length > dom.rows[r].cards.length) appendCards(r, row.cards.slice(dom.rows[r].cards.length));
        });
        S.home = data;
      }
      S.view = "home";
      renderHome();
    } else if (view === "detail") {
      const data = readDetail();
      const sig = JSON.stringify([data.key, data.bg, data.focused, data.season && data.season.label, data.tabs.map((t) => t.active), data.items.map((i) => i.href), data.watch && data.watch.added, data.actions.map((a) => a.label)]);
      if (S.view !== "detail" || sig !== S.dSig) {
        if (S.view !== "detail" || (S.d && S.d.key !== data.key)) {
          S.dZone = "buttons";
          S.dBtn = 0;
          S.dTab = 0;
          S.dCol = 0;
        }
        S.d = data;
        S.dSig = sig;
        buildDetail();
      }
      S.view = "detail";
      renderDetail();
    } else if (view === "profiles") {
      const profiles = readProfiles();
      const sig = JSON.stringify(profiles.map((p) => [p.name, p.img, p.lock]));
      if (S.view !== "profiles" || sig !== S.profilesSig) {
        S.profiles = profiles;
        S.profilesSig = sig;
        buildProfiles();
      }
      S.view = "profiles";
      renderProfiles();
    } else if (view === "pin") {
      if (S.view !== "pin") {
        S.pin = "";
        buildPin();
      }
      S.view = "pin";
      // Disney leert die Felder nach einer falschen PIN – mitziehen
      const filled = [0, 1, 2, 3].filter((i) => ($(tid(`digit-${i}`)) || {}).value).length;
      if (filled < S.pin.length && Date.now() - (S.pinSetAt || 0) > 1500) S.pin = S.pin.slice(0, filled);
      renderPin();
    } else if (view === "loading") {
      if (S.view !== "loading") buildLoading();
      S.view = "loading";
    } else {
      if (S.view) root.replaceChildren();
      S.view = null;
    }
  }

  /** Unsichtbare Seite schrittweise nach unten scrollen, damit Disney alle Reihen lädt. */
  function preload() {
    const scroller = document.body;
    if (S.preloadDone || Date.now() - (S.preloadAt || 0) < 350) return;
    S.preloadAt = Date.now();
    const before = scroller.scrollTop;
    scroller.scrollTop = before + 1400;
    const atEnd = scroller.scrollTop === before;
    S.preloadIdle = atEnd ? (S.preloadIdle || 0) + 1 : 0;
    S.preloadSteps = (S.preloadSteps || 0) + 1;
    // Ende erreicht (ein letzter Platzhalter bleibt bei Disney oft stehen) oder genug geladen
    if (S.preloadIdle >= 4 || S.preloadSteps > 80) {
      S.preloadDone = true;
      scroller.scrollTop = 0;
    }
  }

  setInterval(update, 400);
  update();
})();
