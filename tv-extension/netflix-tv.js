// Netflix im Stil der Netflix-TV-App: eine komplett eigene Oberfläche über der Netflix-Webseite.
//
// Die Webseite läuft unsichtbar darunter weiter. Die Inhalte (Startseite, Serien, Filme, Meine Liste,
// Suche, Detailansicht mit Staffeln und Folgen) kommen direkt aus Netflix' GraphQL-Schnittstelle – über
// die Brücke netflix-bridge.js, die die Abfragen der Seite selbst wiederverwendet. Nur „Neu und beliebt“
// liest noch die versteckte Seite aus (dafür nutzt Netflix eine ältere Schnittstelle). Abgespielt wird,
// indem die Seite zu /watch/<id> wechselt. Im Player (/watch) ist die eigene Oberfläche aus, Profilauswahl
// und PIN zeigt sie selbst (Daten aus der Seite).
(() => {
  if (!window.TV) return;

  // ---------- Hilfsfunktionen ----------

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const shown = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 8 && r.height > 8;
  };
  const area = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height; };
  const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const src = (img) => (img ? img.currentSrc || img.src || "" : "");
  const leaves = (el) =>
    el ? $$("*", el).filter((e) => !e.children.length).map(text).filter((t) => t && t !== "•" && t !== "·") : [];
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

  function h(tag, cls, content) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (content != null) el.textContent = content;
    return el;
  }
  function img(url, cls) {
    const el = h("img", cls);
    el.decoding = "async";
    // Weich einblenden, sobald das Bild geladen ist
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
  /** Fortschritt einer Karte (0…1) aus Fortschrittsbalken oder prozentualer Breite. */
  function progressOf(el) {
    const bar = $("progress", el);
    if (bar && bar.max) return bar.value / bar.max;
    const styled = $$("[style*='width']", el).find((e) => /width:\s*[\d.]+%/.test(e.getAttribute("style")));
    return styled ? parseFloat(styled.style.width) / 100 : null;
  }

  const CARD_STEP = 37.6; // Kartenbreite 36 + Abstand 1.6 (in --u)
  const EP_STEP = 41.6;   // Folgenbreite 40 + Abstand 1.6

  // Netflix-"N" als Vektorgrafik (Ladebildschirm, Profilauswahl)
  const N_LOGO =
    '<svg viewBox="0 0 111 200" xmlns="http://www.w3.org/2000/svg">' +
    '<path fill="#b1060f" d="M0 0h40v200H0z"/><path fill="#b1060f" d="M71 0h40v200H71z"/>' +
    '<path fill="#e50914" d="M0 0h40l71 200H71z"/></svg>';

  const ICONS = {
    back: '<path d="M15 5l-7 7 7 7"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
    series: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/>',
    movies: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
    latest: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    mylist: '<path d="M12 5v14M5 12h14"/>',
    play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
  };

  // Linke Leiste: Ziele auf der Netflix-Seite (data-uia der versteckten Navigation)
  const NAV = [
    { id: "search", label: "Suche", icon: "search" },
    { id: "home", label: "Startseite", icon: "home", uia: "nav-home", path: /^\/browse\/?$/, cat: null },
    { id: "series", label: "Serien", icon: "series", uia: "nav-series", path: /^\/browse\/genre\/83/, cat: "genre-83" },
    { id: "movies", label: "Filme", icon: "movies", uia: "nav-movies", path: /^\/browse\/genre\/34399/, cat: "genre-34399" },
    { id: "latest", label: "Neu und beliebt", icon: "latest", uia: "nav-latest", path: /^\/latest/, cat: "latest" },
    { id: "mylist", label: "Meine Liste", icon: "mylist", uia: "nav-myProfile", path: /^\/browse\/my-list/, cat: "myProfile" },
  ];

  // ---------- Daten aus Netflix' Schnittstelle (Brücke: netflix-bridge.js) ----------

  let seq = 0;
  const waiting = new Map();
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.tvnf !== "res") return;
    const w = waiting.get(event.data.id);
    if (!w) return;
    waiting.delete(event.data.id);
    if (event.data.ok) w.resolve(event.data.data); else w.reject(new Error(event.data.error));
  });
  function call(op, args) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      waiting.set(id, { resolve, reject });
      window.postMessage({ tvnf: "req", id, op, args }, "*");
      setTimeout(() => { if (waiting.delete(id)) reject(new Error("Zeitüberschreitung")); }, 45000);
    });
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Abfrage stellen. Kennt die Brücke sie noch nicht (erster Start), die versteckte Seite einmal dorthin
   *  schicken, wo Netflix sie selbst stellt (learnPath), bis die Brücke sie mitgeschnitten hat. */
  async function q(name, vars, learnPath, policy) {
    try {
      return await call("q", { name, vars, policy });
    } catch (error) {
      if (!/unbekannt/.test(error.message) || !learnPath) throw error;
      const back = location.pathname + location.search;
      await call("nav", { path: learnPath });
      for (let i = 0; i < 24; i++) {
        await sleep(500);
        const r = await call("ready").catch(() => null);
        if (r && r.have.includes(name)) break;
      }
      await call("nav", { path: /^\/browse/.test(back) ? back.replace(/[?&]jbv=\d+/, "") : "/browse" }).catch(() => {});
      return call("q", { name, vars, policy });
    }
  }

  const cert = (adv) => (adv && adv.certificationValue ? `ab ${adv.certificationValue}` : "");
  const minutes = (sec) => (sec ? (sec >= 3600 ? `${Math.floor(sec / 3600)} Std. ${Math.round((sec % 3600) / 60)} Min.` : `${Math.round(sec / 60)} Min.`) : "");

  function apiCard(node, continueRow) {
    const ue = node && node.unifiedEntity;
    if (!ue || !ue.videoId) return null;
    const art = node.contextualArtwork || {};
    let progress = null;
    if (continueRow) {
      const ep = ue.currentEpisode || ue;
      const pos = ep.bookmark && ep.bookmark.position;
      if (pos != null && ep.runtimeSec) progress = pos / ep.runtimeSec;
    }
    return {
      id: ue.videoId,
      label: node.displayString || ue.title || "",
      img: (art.artworkHighRes && art.artworkHighRes.url) || (art.artwork && art.artwork.url) || "",
      progress,
    };
  }

  function apiBillboard(ent) {
    const pe = ent && ent.promotedEntity;
    if (!pe) return null;
    const show = pe.parentShow || pe;
    const art = ent.contextualArtwork || {};
    const id = show.videoId || pe.videoId;
    if (!id) return null;
    return {
      id,
      title: show.title || pe.title || "",
      bg: (art.horizontalBackgroundImage && art.horizontalBackgroundImage.url) || "",
      logo: (art.logoImage && art.logoImage.url) || "",
      attrs: [show.releaseYear || pe.releaseYear, cert(pe.contentAdvisory), show.numSeasonsLabel].filter(Boolean).map(String),
      synopsis: (ent.contextualSynopsis && ent.contextualSynopsis.text) || "",
      callouts: ((ent.callouts && ent.callouts.inFocus) || []).map((c) => c.text).filter(Boolean),
    };
  }

  /** Netflix-Seite (Abschnitte) → { billboard, rows } wie die eigene Oberfläche sie braucht */
  function apiRows(page, firstTitle) {
    let billboard = null;
    const rows = [];
    for (const edge of (page && page.sections && page.sections.edges) || []) {
      const n = edge.node;
      if (!n) continue;
      if (n.__typename === "PinotSingleItemSection") {
        if (!billboard) billboard = apiBillboard(n.entity);
        continue;
      }
      const ents = (n.entities && n.entities.edges) || [];
      const continueRow = ents.some((e) => /ContinueWatching/.test((e.node && e.node.__typename) || ""));
      const cards = ents.map((e) => apiCard(e.node, continueRow)).filter((c) => c && c.img);
      if (cards.length) rows.push({ title: n.displayString || (rows.length ? "" : firstTitle || ""), cards });
    }
    return { billboard, rows };
  }

  // Top-10-Reihen: wie alle anderen Karten im Querformat (Netflix liefert dort sonst Hochformat-Cover)
  const LANDSCAPE = { imageParamsForRankedBoxart: { artworkType: "SDP", dimension: { width: 665, height: 375 },
    features: { fallbackStrategy: "STILL", suppressTop10Badge: true } } };

  const cache = {}; // Bereich → {at, home}: erneuter Wechsel ohne Warten
  const FRESH_MS = 10 * 60 * 1000;
  async function fetchHome(cat) {
    let home;
    if (cat === "latest") {
      home = await latestRows();
    } else {
      const data = await q("GetBrowsePage", { ...LANDSCAPE, categoryId: cat, sectionCount: 30, carouselPageSize: 40 }, "/browse");
      home = apiRows(data && data.page);
    }
    cache[String(cat)] = { at: Date.now(), home };
    return home;
  }
  let preloaded = false;
  async function loadHome(cat) {
    const mine = (S.loadSeq = (S.loadSeq || 0) + 1);
    S.homeLoading = true;
    try {
      const home = await fetchHome(cat);
      if (mine !== S.loadSeq) return;
      S.home = home;
      S.homeFails = 0;
      // „Neu und beliebt“ braucht drei große Abfragen: schon einmal im Hintergrund holen
      if (!preloaded) { preloaded = true; setTimeout(() => fetchHome("latest").catch(() => {}), 8000); }
    } catch (error) {
      if (mine !== S.loadSeq) return;
      // Seite noch nicht so weit (z. B. Profilauswahl): später erneut; nach vielen Fehlern die alte Art nutzen
      if (++S.homeFails > 20) S.api = false;
    } finally {
      if (mine === S.loadSeq) S.homeLoading = false;
    }
  }

  /** „Neu und beliebt“: Netflix' eigene Seite dafür lädt im Player-Browser nicht – stattdessen die Reihen mit
   *  Neuheiten und Top 10 aus Startseite, Serien und Filmen */
  async function latestRows() {
    const pages = await Promise.all([null, "genre-83", "genre-34399"].map((cat) =>
      q("GetBrowsePage", { ...LANDSCAPE, categoryId: cat, sectionCount: 34, carouselPageSize: 20 }, "/browse").catch(() => null)));
    const [home, series, movies] = pages.map((d) => apiRows(d && d.page).rows);
    const pick = (rows, re, title) => {
      const row = (rows || []).find((r) => re.test(r.title));
      return row && { title: title || row.title, cards: row.cards };
    };
    const rows = [
      pick(series, /^Top-10-Serien/),
      pick(movies, /^Top-10-Filme/),
      pick(home, /^Neu auf Netflix/),
      pick(series, /^Neu auf Netflix/, "Neue Serien"),
      pick(movies, /^Neu auf Netflix/, "Neue Filme"),
      pick(home, /^Top-Suchanfragen/),
      pick(home, /^Publikumshits/) || pick(series, /^Publikumshits/),
      pick(home, /^Heutige Top-Auswahl/),
    ].filter((r) => r && r.cards.length);
    return { billboard: null, rows };
  }

  async function search(term) {
    const mine = (S.loadSeq = (S.loadSeq || 0) + 1);
    S.home = null;
    S.homeLoading = true;
    try {
      const data = await q("SearchPageQueryResults", { searchTerm: term }, `/search?q=${encodeURIComponent(term)}`);
      if (mine !== S.loadSeq) return;
      const result = apiRows(data && data.page, `Ergebnisse für „${term}“`);
      if (!result.rows.length) result.rows.push({ title: `Keine Ergebnisse für „${term}“`, cards: [] });
      S.home = result;
    } catch (error) {
      if (mine === S.loadSeq) S.home = { billboard: null, rows: [{ title: `Suche ging nicht (${error.message})`, cards: [] }] };
    } finally {
      if (mine === S.loadSeq) S.homeLoading = false;
    }
  }

  async function loadSeason(seasonId, showTitle) {
    const data = await q("PreviewModalEpisodeSelectorSeasonEpisodes", { seasonId, count: 80 });
    const season = data && data.videos && data.videos[0];
    return ((season && season.episodes && season.episodes.edges) || []).map((e) => e.node).filter(Boolean).map((ep) => ({
      id: ep.videoId,
      num: ep.number,
      label: ep.title || "",
      img: (ep.artwork && ep.artwork.url) || "",
      progress: ep.bookmark && ep.bookmark.position > 0 && ep.runtimeSec ? ep.bookmark.position / ep.runtimeSec : null,
      duration: minutes(ep.displayRuntimeSec || ep.runtimeSec),
      synopsis: (ep.contextualSynopsis && ep.contextualSynopsis.text) || "",
      run: () => playVideo(ep.videoId, `${showTitle} · ${ep.number}. ${ep.title || ""}`),
    }));
  }

  async function loadDetail(id) {
    const learn = `/browse?jbv=${id}`;
    const dm = await q("DetailModal", { unifiedEntityId: `Video:${id}` }, learn);
    const e = dm && dm.unifiedEntities && dm.unifiedEntities[0];
    if (!e) throw new Error("Titel nicht gefunden");
    const isShow = e.__typename === "Show";
    const simIds = ((e.similars || []).map((x) => x.videoId)).filter(Boolean).slice(0, 25);
    const [self, sims] = await Promise.all([
      q("VideoDetailsModalSimilars", { videoIds: [id] }, learn).catch(() => null),
      simIds.length ? q("VideoDetailsModalSimilars", { videoIds: simIds }, learn).catch(() => null) : null,
    ]);
    const me = self && self.videos && self.videos[0];
    const cur = e.currentEpisode;
    const pos = cur && cur.bookmark ? cur.bookmark.position : 0;
    const d = {
      key: id,
      id,
      title: e.title || "",
      bg: (e.storyArt && e.storyArt.url) || (e.boxartHighRes && e.boxartHighRes.url) || "",
      logo: (e.titleLogoUnbrandedStacked && e.titleLogoUnbrandedStacked.url) || (e.titleLogoBranded && e.titleLogoBranded.url) || "",
      meta: [e.latestYear, cert(e.contentAdvisory),
        isShow ? (e.seasons && e.seasons.totalCount ? `${e.seasons.totalCount} ${e.seasons.totalCount === 1 ? "Staffel" : "Staffeln"}` : "")
          : minutes(cur ? cur.runtimeSec : 0)].filter(Boolean).map(String),
      synopsis: (me && me.contextualSynopsis && me.contextualSynopsis.text) || (cur && cur.contextualSynopsis && cur.contextualSynopsis.text) || "",
      progressText: "",
      progress: null,
      episodes: [],
      similar: ((sims && sims.videos) || []).filter((v) => v && v.boxart && v.boxart.url).map((v) => ({
        label: v.title || "", img: v.boxart.url, info: v.numSeasonsLabel || "",
        run: () => openDetail(v.videoId),
      })),
      close: null,
    };
    if (isShow && cur && cur.parentSeason && pos > 0) {
      d.progressText = `St. ${cur.parentSeason.number}: F. ${cur.number} „${cur.title || ""}“`;
      if (cur.runtimeSec) d.progress = pos / cur.runtimeSec;
    }
    const playId = isShow ? (cur && cur.videoId) || id : id;
    const playTitle = isShow && cur ? `${d.title} · ${cur.number}. ${cur.title || ""}` : d.title;
    d.play = { label: pos > 0 ? "Fortsetzen" : "Abspielen", run: () => playVideo(playId, playTitle) };
    d.myList = { added: !!e.isInPlaylist, toggle: () => toggleMyList(d) };
    if (isShow) {
      const sel = await q("PreviewModalEpisodeSelector", { showId: id, seasonCount: (e.seasons && e.seasons.totalCount) || 1 }, learn).catch(() => null);
      const show = sel && sel.videos && sel.videos[0];
      d.seasons = ((show && show.seasons && show.seasons.edges) || []).map((x) => x.node).filter(Boolean)
        .map((s) => ({ id: s.videoId, label: s.title || "" }));
      const current = d.seasons.find((s) => cur && cur.parentSeason && s.id === cur.parentSeason.videoId) || d.seasons[0];
      if (current) {
        if (d.seasons.length > 1) d.season = { label: current.label, id: current.id };
        d.seasonLabel = current.label;
        d.episodes = await loadSeason(current.id, d.title).catch(() => []);
      }
    }
    return d;
  }

  function openDetail(id) {
    if (!id) return;
    S.returnZone = S.view === "detail" ? S.returnZone : S.zone;
    S.detailId = id;
    S.d = null;
    const mine = id;
    loadDetail(id).then((d) => {
      if (S.detailId === mine) S.d = d;
    }).catch((error) => {
      if (S.detailId !== mine) return;
      S.detailId = null;
      S.lastError = error.message;
    });
  }

  /** Meine Liste: Netflix' eigenen Knopf in der (versteckten) Detailansicht drücken */
  async function toggleMyList(d) {
    const back = location.pathname;
    await call("nav", { path: `/browse?jbv=${d.id}` });
    let button = null;
    for (let i = 0; i < 20 && !button; i++) {
      await sleep(300);
      button = $("[data-uia^='add-to-my-list']");
    }
    if (button) {
      button.click();
      d.myList = { ...d.myList, added: !d.myList.added };
      S.d = { ...d, myList: d.myList };
      S.d.myList.toggle = () => toggleMyList(S.d);
      await sleep(800);
    }
    await call("nav", { path: /^\/browse/.test(back) ? back : "/browse" }).catch(() => {});
  }

  function playVideo(id, title) {
    rememberTitle(title);
    call("nav", { path: `/watch/${id}` }).catch(() => { location.href = `/watch/${id}`; });
  }

  // ---------- Daten aus der Netflix-Seite („Neu und beliebt“, Profile) ----------

  const rowCache = new Map(); // Reihen-Überschrift -> bisher gesehene Karten (Karussell blättert nach)

  function cardData(el) {
    return {
      href: el.getAttribute("href") || "",
      label: el.getAttribute("aria-label") || text(el),
      img: src($("img", el)),
      progress: progressOf(el),
    };
  }

  function readHome() {
    const bb = $("[data-uia='billboard']");
    let billboard = null;
    if (shown(bb)) {
      const bg = $("[data-uia='billboard-background-media+image']", bb);
      const logo = $("[data-uia='billboard-title'] img, [data-uia='billboard-logo'] img", bb);
      billboard = {
        bg: bg && (bg.tagName === "IMG" ? src(bg) : src($("img", bg))),
        logo: src(logo),
        title: text($("[data-uia='billboard-title']", bb)),
        attrs: leaves($("[data-uia='attributes-elements']", bb)),
        synopsis: text($("[data-uia='billboard-synopsis']", bb)),
        callouts: $$("[data-uia='billboard-callout']", bb).map(text).filter(Boolean),
      };
    }

    let rows = $$("[data-uia^='carousel-row-section']").map((sec) => ({
      title: text($("h2, h3, [role=heading]", sec)),
      cards: $$("a[data-uia$='-card']", sec).map(cardData),
    }));
    if (!rows.length) rows = gridRows(); // Suche, Meine Liste: Raster statt Karussell

    rows = rows
      .map((row) => {
        // Karten zusammenführen: beim Weiterblättern tauscht Netflix sie aus
        const key = row.key || row.title || "_";
        const known = rowCache.get(key) || [];
        for (const card of row.cards) {
          const i = known.findIndex((k) => k.href === card.href);
          if (i < 0) known.push(card);
          else known[i] = card;
        }
        rowCache.set(key, known);
        return { title: row.title, cards: known.filter((c) => c.img || c.label) };
      })
      .filter((row) => row.cards.length);
    return { billboard, rows };
  }

  /** Karten ohne Karussell (Suchergebnisse, Meine Liste) nach Zeilen gruppieren. */
  function gridRows() {
    const cards = $$("a[href*='jbv='], a[data-uia$='-card']").filter((a) => shown(a) && $("img", a));
    const lines = new Map();
    for (const a of cards) {
      const top = Math.round(a.getBoundingClientRect().top / 40);
      if (!lines.has(top)) lines.set(top, []);
      lines.get(top).push(a);
    }
    const query = new URLSearchParams(location.search).get("q");
    const heading = query ? `Ergebnisse für „${query}“` : /my-list/.test(location.pathname) ? "Meine Liste" : text($("main h1, [data-uia*='gallery'] h2"));
    // Jede Zeile bekommt einen eigenen Schlüssel, damit der Karten-Speicher sie nicht vermischt
    return [...lines.values()].map((line, i) => ({ title: i === 0 ? heading : "", key: `grid-${i}`, cards: line.map(cardData) }));
  }

  function detailEl() {
    return $$("[data-uia*='DETAIL_MODAL'], [role=dialog][aria-modal=true]").find((d) => area(d) > 20000) || null;
  }

  function readDetail(m) {
    const player = $("[data-uia='previewModal--player_container']", m) || m;
    const pics = $$("img", player).filter(shown).sort((a, b) => area(b) - area(a));
    const bg = pics[0];
    const logo = pics.find((p) => p !== bg && p.naturalWidth / Math.max(1, p.naturalHeight) > 1.3);
    const about = $$("h3, h4", m).map(text).find((t) => t.startsWith("Über "));
    const progressText = $$("*", player).map((e) => (e.children.length ? "" : text(e))).find((t) => /\d+ von \d+/.test(t));
    const playEl = $("[data-uia='play-button']", m);
    const myList = $("[data-uia^='add-to-my-list']", m);
    const season = $("[data-uia='dropdown-toggle']", m);
    const episodes = $$("[data-uia='episode-selector'] [data-uia='titleCard--container']", m).map((e) => ({
      el: e,
      label: e.getAttribute("aria-label") || "",
      num: text(e.firstElementChild),
      img: src($("img", e)),
      progress: progressOf(e),
      duration: leaves(e).find((t) => /^\d+\s*(Min|Std)/.test(t)) || "",
    }));
    const titleText = about ? about.slice(5) : (pics[0] && pics[0].alt) || "";
    for (const ep of episodes) ep.run = () => play(ep.el, `${titleText} · ${ep.num}. ${ep.label}`);
    const similar = $$("[data-uia='titleCard--container']", m)
      .filter((e) => !e.closest("[data-uia='episode-selector'], [data-uia^='trailersAndMore']"))
      .map((e) => ({ el: e, label: e.getAttribute("aria-label") || "", img: src($("img", e)), info: leaves(e).find((t) => /Staffel|Std|Min|Folge/.test(t)) || "", run: () => e.click() }));

    return {
      key: location.search,
      title: about ? about.slice(5) : (bg && bg.alt) || "",
      bg: src(bg),
      logo: src(logo),
      meta: leaves($("[data-uia='videoMetadata--container']", m)).filter((t) => t.length < 30),
      synopsis: text($("[data-uia='preview-modal-synopsis']", m)),
      progressText: progressText || "",
      progress: progressOf(player),
      play: playEl && { el: playEl, label: playEl.getAttribute("aria-label") || "Abspielen", run: () => (rememberTitle(titleText), playEl.click()) },
      myList: myList && { el: myList, added: /added/.test(myList.dataset.uia), toggle: () => myList.click() },
      season: season && { el: season, label: text(season) },
      episodes,
      similar,
      close: $("[data-uia='previewModal-closebtn']", m),
    };
  }

  // ---------- Zustand ----------

  const S = {
    view: null,        // "home" | "detail" | null (eigene Oberfläche aus)
    zone: "hero",      // Startseite: "nav" | "hero" | "rows"
    nav: 1,
    heroBtn: 0,
    row: 0,
    cols: [],          // gewählte Karte je Reihe
    home: null,        // Daten der Startseite
    homeSig: "",
    d: null,           // Daten der Detailseite
    dSig: "",
    dZone: "buttons",  // Detailseite: "buttons" | "rows"
    dBtn: 0,
    dRow: 0,
    dCols: [0, 0],
    picker: null,      // Staffelwahl: { options: [{label, el}], index }
    returnZone: null,  // wohin nach dem Schließen der Detailseite
    closedAt: 0,       // Zeitpunkt des letzten Schließens der Detailseite
    navAt: 0,          // Zeitpunkt des letzten Seitenwechsels über die Leiste
    navTarget: null,   // erwarteter Pfad nach dem Wechsel
    profile: 0,        // gewähltes Profil in der Profilauswahl
    profiles: null,    // Profile: [{ name, img, lock, el }]
    profilesSig: "",
    pin: "",           // bisher eingegebene PIN-Ziffern
    pinKey: 0,         // gewählte Taste auf dem Ziffernblock
    pinProfile: null,  // Profil, für das die PIN abgefragt wird
    api: true,         // Daten aus der Schnittstelle (false: „Neu und beliebt“ aus der Seite)
    navId: "home",     // gewählter Bereich der Leiste
    cat: null,         // Kategorie der Schnittstelle (null = Startseite)
    homeLoading: false,
    homeFails: 0,
    builtHome: null,   // zuletzt gebaute Daten (neu bauen, wenn sich S.home ändert)
    detailId: null,    // geöffnete Detailansicht (Schnittstelle)
    builtD: null,
    watching: false,
  };

  const root = h("div");
  root.id = "nftv";
  document.documentElement.append(root);

  function computeView() {
    if (location.pathname.startsWith("/watch")) return null;
    if (shown($("[data-uia='profile-gate-pin']"))) return "pin";
    if (shown($("[data-uia='profile-gate-screen'], [data-uia='profile-selector']"))) return "profiles";
    // Nach einem Wechsel über die Leiste: Ladebildschirm, bis die neue Seite da ist
    if (S.api && /^\/(browse|latest|search)/.test(location.pathname)) {
      if (S.detailId) return S.d ? "detail" : "loading";
      return S.home ? "home" : "loading";
    }
    if (S.navTarget && Date.now() - S.navAt < 8000 && (!S.navTarget.test(location.pathname) || Date.now() - S.navAt < 900)) return "loading";
    // Nach "Zurück" schließt Netflix die Detailansicht mit einer Animation – solange gilt schon die Startseite
    // Offene Detailansicht steht als ?jbv=… in der Adresse; das Element bleibt nach dem Schließen noch kurz stehen.
    if (/[?&]jbv=/.test(location.search) && detailEl() && Date.now() - S.closedAt > 1500) return "detail";
    if (/^\/(browse|latest|search)/.test(location.pathname)) {
      if ($("[data-uia='billboard'], [data-uia^='carousel-row-section'], a[href*='jbv=']")) return "home";
      // Netflix lädt noch: statt der halbfertigen Webseite den Ladebildschirm zeigen
      if (!$("form, input[type=password], [data-uia*='login']")) return "loading";
    }
    return null;
  }

  TV.site.takeover = () => !!S.view;
  TV.netflix = S; // Zustand für Tests (dev/cdp.py --ext 'TV.netflix')
  TV.netflixOpen = (id) => openDetail(id); // für Tests
  TV.netflixNav = (id) => navigate(NAV.find((n) => n.id === id)); // für Tests

  // ---------- Startseite ----------

  let dom = {}; // Verweise auf die gebauten Elemente

  function buildHome() {
    const { billboard, rows } = S.home;
    root.replaceChildren();
    const page = h("div", "nf-home");

    const heroBg = img(billboard && billboard.bg, "nf-hero-bg");
    const peekBg = img("", "nf-peek-bg");
    page.append(heroBg, peekBg, h("div", "nf-shade"));

    // Banner
    const hero = h("div", "nf-hero");
    if (billboard) {
      if (billboard.logo) hero.append(img(billboard.logo, "nf-logo"));
      else hero.append(h("h1", "nf-title", billboard.title));
      if (billboard.attrs.length) hero.append(h("div", "nf-attrs", billboard.attrs.join("  •  ")));
      hero.append(h("p", "nf-syn", billboard.synopsis));
      const buttons = h("div", "nf-buttons");
      const play = h("div", "nf-btn nf-btn-primary");
      play.append(icon("play"), h("span", "", "Abspielen"));
      const info = h("div", "nf-btn");
      info.append(icon("info"), h("span", "", "Weitere Infos"));
      buttons.append(play, info);
      hero.append(buttons);
      if (billboard.callouts.length) hero.append(h("div", "nf-callout", billboard.callouts[0]));
      dom.heroButtons = [play, info];
      dom.heroButtons.forEach((el, i) => (el.onclick = () => { S.zone = "hero"; S.heroBtn = i; homeKey("ok"); }));
    } else {
      dom.heroButtons = [];
    }
    page.append(hero);

    // Info zur gewählten Karte (wenn man in den Reihen ist)
    const peek = h("div", "nf-peek");
    dom.peekTitle = h("h1", "nf-peek-title");
    dom.peekRow = h("div", "nf-peek-row");
    peek.append(dom.peekTitle, dom.peekRow);
    page.append(peek);

    // Reihen
    const rowsEl = h("div", "nf-rows");
    dom.rows = rows.map((row, r) => {
      const rowEl = h("div", "nf-row");
      rowEl.append(h("h2", "nf-row-title", row.title));
      const track = h("div", "nf-track");
      const cards = row.cards.map((card, i) => {
        const c = h("div", "nf-card");
        c.onclick = () => { S.zone = "rows"; S.row = r; S.cols[r] = i; renderHome(); openCard(card); };
        c.append(img(card.img, "nf-card-img"));
        if (card.progress != null) {
          const bar = h("div", "nf-card-progress");
          const fill = h("div");
          fill.style.width = `${clamp(card.progress, 0, 1) * 100}%`;
          bar.append(fill);
          c.append(bar);
        }
        track.append(c);
        return c;
      });
      rowEl.append(track);
      rowsEl.append(rowEl);
      return { el: rowEl, track, cards };
    });
    page.append(rowsEl);
    dom.rowsEl = rowsEl;
    dom.heroBg = heroBg;
    dom.peekBg = peekBg;
    dom.page = page;

    root.append(page, buildRail(), backButton());
  }

  /** Anklickbarer Zurück-Pfeil oben links (für die Bedienung mit der Maus). */
  function backButton() {
    const b = h("div", "nf-back");
    b.append(icon("back"));
    b.title = "Zurück";
    b.onclick = () => TV.site.key("back");
    return b;
  }

  function buildRail() {
    const rail = h("div", "nf-rail");
    const avatar = $("[data-uia='navigation+profile-menu+trigger'] img");
    if (avatar) rail.append(img(src(avatar), "nf-avatar"));
    dom.nav = NAV.map((item, i) => {
      const el = h("div", "nf-rail-item");
      el.onclick = () => { S.nav = i; navigate(item); renderHome(); };
      el.append(icon(item.icon), h("span", "nf-rail-label", item.label));
      rail.append(el);
      return el;
    });
    dom.rail = rail;
    return rail;
  }

  function renderHome() {
    const { rows, billboard } = S.home;
    const hasHero = !!billboard;
    if (!hasHero && S.zone === "hero") S.zone = rows.length ? "rows" : "nav";
    S.row = clamp(S.row, 0, Math.max(0, rows.length - 1));
    const inRows = S.zone === "rows" || (S.zone === "nav" && S.returnZone === "rows");

    root.classList.toggle("nf-in-rows", inRows || !hasHero);
    dom.rail.classList.toggle("nf-rail-open", S.zone === "nav");
    root.classList.toggle("nf-nav-open", S.zone === "nav");
    const active = activeNav();
    dom.nav.forEach((el, i) => {
      el.classList.toggle("nf-on", S.zone === "nav" && i === S.nav);
      el.classList.toggle("nf-active", i === active);
    });
    dom.heroButtons.forEach((el, i) => el.classList.toggle("nf-on", S.zone === "hero" && i === S.heroBtn));

    // Reihen senkrecht: im Banner-Bereich unten angedockt, sonst gewählte Reihe oben
    const rowH = 32;
    const top = inRows || !hasHero ? 44 : 77;
    const first = inRows || !hasHero ? S.row : 0;
    dom.rowsEl.style.transform = `translateY(calc(var(--u) * ${top - first * rowH}))`;

    dom.rows.forEach((row, r) => {
      row.el.classList.toggle("nf-row-gone", (inRows || !hasHero) && r < S.row);
      const col = clamp(S.cols[r] || 0, 0, row.cards.length - 1);
      S.cols[r] = col;
      // Waagrecht: gewählte Karte bleibt links stehen (wie in der TV-App)
      row.track.style.transform = `translateX(calc(var(--u) * ${-col * CARD_STEP}))`;
      row.cards.forEach((c, i) => {
        c.classList.toggle("nf-on", S.zone === "rows" && r === S.row && i === col);
        c.classList.toggle("nf-past", i < col);
      });
    });

    // Infobereich für die gewählte Karte
    const row = rows[S.row];
    const card = row && row.cards[S.cols[S.row] || 0];
    if (inRows && card) {
      dom.peekTitle.textContent = card.label;
      // Raster (Suche, Meine Liste): Zeilen ohne eigene Überschrift zeigen die der ersten Zeile
      dom.peekRow.textContent = row.title || (rows.slice(0, S.row).reverse().find((r) => r.title) || {}).title || "";
      if (dom.peekBg.dataset.src !== card.img) {
        dom.peekBg.dataset.src = card.img;
        dom.peekBg.src = card.img;
      }
    }
  }

  function homeKey(key) {
    const { rows, billboard } = S.home;
    if (S.zone === "nav") {
      if (key === "up") S.nav = Math.max(0, S.nav - 1);
      else if (key === "down") S.nav = Math.min(NAV.length - 1, S.nav + 1);
      else if (key === "right") S.zone = S.returnZone || (billboard ? "hero" : "rows");
      else if (key === "back") S.zone = S.returnZone || (billboard ? "hero" : "rows");
      else if (key === "ok") navigate(NAV[S.nav]);
    } else if (S.zone === "hero") {
      if (key === "left" && S.heroBtn === 0) openNav("hero");
      else if (key === "left" || key === "right") S.heroBtn = clamp(S.heroBtn + (key === "left" ? -1 : 1), 0, 1);
      else if (key === "down" && rows.length) (S.zone = "rows"), (S.row = 0);
      else if (key === "up") openNav("hero");
      else if (key === "back") (S.api && S.navId !== "home" ? navigate(NAV[1]) : TV.home());
      else if (key === "ok" && S.api) {
        if (S.heroBtn === 0) playVideo(billboard.id, billboard.title);
        else openDetail(billboard.id);
      } else if (key === "ok") {
        const target = $(S.heroBtn === 0 ? "[data-uia='play-video-button']" : "[data-uia='billboard-more-info']");
        if (S.heroBtn === 0) rememberTitle(billboard.title || "");
        if (target) target.click();
      }
    } else if (S.zone === "rows") {
      const row = rows[S.row];
      const col = S.cols[S.row] || 0;
      if (key === "left") {
        if (col === 0) openNav("rows");
        else S.cols[S.row] = col - 1;
      } else if (key === "right") {
        if (col < row.cards.length - 1) S.cols[S.row] = col + 1;
        if (col >= row.cards.length - 3 && !S.api) loadMoreCards(S.row); // Karussell im Hintergrund nachladen
      } else if (key === "up") {
        if (S.row > 0) S.row--;
        else if (billboard) S.zone = "hero";
      } else if (key === "down") {
        if (S.row < rows.length - 1) S.row++;
        if (S.row >= rows.length - 3 && !S.api) window.scrollTo(0, document.documentElement.scrollHeight); // weitere Reihen laden
      } else if (key === "back") {
        if (billboard) (S.zone = "hero"), (S.row = 0);
        else if (S.navId !== "home" || !S.api) navigate(NAV[1]);
        else TV.home();
      } else if (key === "ok") {
        openCard(row.cards[col]);
      }
    }
    renderHome();
  }

  function activeNav() {
    if (S.api) return S.navId === "search" ? 0 : NAV.findIndex((n) => n.id === S.navId);
    return NAV.findIndex((n) => n.path && n.path.test(location.pathname));
  }

  function openNav(from) {
    S.returnZone = from;
    S.zone = "nav";
    const active = activeNav();
    S.nav = active >= 0 ? active : 1;
  }

  function navigate(item) {
    if (item.id === "search") return openSearch();
    if (item.cat !== undefined) {
      // Schnittstelle: versteckte Seite bleibt auf der Startseite
      S.api = true;
      S.navId = item.id;
      S.cat = item.cat;
      S.home = null;
      S.detailId = null;
      S.zone = "hero";
      S.returnZone = null;
      S.row = 0;
      S.cols = [];
      if (!/^\/browse\/?$/.test(location.pathname)) call("nav", { path: "/browse" }).catch(() => {});
      const known = cache[String(item.cat)];
      if (known && Date.now() - known.at < FRESH_MS) S.home = known.home;
      else loadHome(item.cat);
      return;
    }
    S.api = false;
    S.navId = item.id;
    const link = $(`[data-uia='${item.uia}']`);
    S.zone = "hero";
    S.returnZone = null;
    S.row = 0;
    S.cols = [];
    rowCache.clear();
    S.navAt = Date.now();
    S.navTarget = item.path || null;
    if (link) link.click();
    else location.href = "/browse";
  }

  function openSearch() {
    const input = h("input");
    input.type = "search";
    input.className = "nf-search-input";
    root.append(input);
    TV.keyboard(input, (value) => {
      input.remove();
      const term = value.trim();
      if (!term) return;
      if (!S.api) return void (location.href = `/search?q=${encodeURIComponent(term)}`);
      S.navId = "search";
      S.detailId = null;
      S.zone = "rows";
      S.returnZone = null;
      S.row = 0;
      S.cols = [];
      search(term);
    });
  }

  function loadMoreCards(r) {
    const sec = $(`[data-uia='carousel-row-section-${r + 1}']`);
    const next = sec && $("[data-uia='carousel-hawkins-right-button']", sec);
    if (next) next.click();
  }

  function openCard(card) {
    if (!card) return;
    S.returnZone = "rows";
    if (S.api) return openDetail(card.id);
    const el = $$(`a[href]`).find((a) => a.getAttribute("href") === card.href);
    if (el) el.click();
    else location.href = card.href;
  }

  // ---------- Detailseite ----------

  function buildDetail() {
    const d = S.d;
    root.replaceChildren();
    const page = h("div", "nf-detail");
    page.append(img(d.bg, "nf-d-bg"), h("div", "nf-d-shade"));
    // Kleiner Titel oben, solange man in Folgen/ähnlichen Titeln ist
    const mini = h("div", "nf-d-mini");
    mini.append(d.logo ? img(d.logo) : h("h1", "", d.title));
    page.append(mini);

    const info = h("div", "nf-d-info");
    if (d.logo) info.append(img(d.logo, "nf-logo"));
    else info.append(h("h1", "nf-title", d.title));
    if (d.meta.length) info.append(h("div", "nf-attrs", d.meta.join("  •  ")));
    if (d.progressText) {
      const prog = h("div", "nf-d-progress");
      const bar = h("div", "nf-d-bar");
      const fill = h("div");
      const m = d.progressText.match(/(\d+) von (\d+)/);
      fill.style.width = `${m ? (100 * m[1]) / m[2] : 0}%`;
      bar.append(fill);
      prog.append(bar, h("span", "", d.progressText));
      info.append(prog);
    }
    info.append(h("p", "nf-syn", d.synopsis));

    // Knöpfe
    const buttons = h("div", "nf-buttons");
    dom.dButtons = [];
    const addButton = (iconName, label, action, primary) => {
      const b = h("div", "nf-btn" + (primary ? " nf-btn-primary" : ""));
      b.append(icon(iconName), h("span", "", label));
      buttons.append(b);
      b.onclick = () => action();
      dom.dButtons.push({ el: b, action });
    };
    if (d.play) addButton("play", d.play.label, () => d.play.run(), true);
    if (d.season) addButton("down", d.season.label, openPicker);
    if (d.myList) addButton(d.myList.added ? "check" : "mylist", "Meine Liste", () => d.myList.toggle());
    info.append(buttons);
    page.append(info);

    // Reihen: Folgen und ähnliche Titel
    const rowsEl = h("div", "nf-d-rows");
    dom.dRows = [];
    const addRow = (title, items, build, action) => {
      if (!items.length) return;
      const rowEl = h("div", "nf-row");
      rowEl.append(h("h2", "nf-row-title", title));
      const track = h("div", "nf-track");
      const cards = items.map((item) => {
        const c = build(item);
        c.onclick = () => action(item);
        track.append(c);
        return c;
      });
      rowEl.append(track);
      rowsEl.append(rowEl);
      dom.dRows.push({ el: rowEl, track, cards, items, action, step: cards[0] && cards[0].classList.contains("nf-ep") ? EP_STEP : CARD_STEP });
    };
    addRow(d.season || d.seasonLabel ? `Folgen – ${(d.season && d.season.label) || d.seasonLabel}` : "Folgen", d.episodes, (ep) => {
      const c = h("div", "nf-card nf-ep");
      const pic = h("div", "nf-ep-pic");
      pic.append(img(ep.img, "nf-card-img"));
      if (ep.progress) {
        const bar = h("div", "nf-card-progress");
        const fill = h("div");
        fill.style.width = `${clamp(ep.progress, 0, 1) * 100}%`;
        bar.append(fill);
        pic.append(bar);
      }
      c.append(pic, h("div", "nf-ep-title", `${ep.num}. ${ep.label}`), h("div", "nf-ep-sub", ep.duration));
      return c;
    }, (ep) => ep.run());
    addRow("Ähnliche Titel", d.similar, (s) => {
      const c = h("div", "nf-card");
      c.append(img(s.img, "nf-card-img"));
      return c;
    }, (s) => {
      S.dZone = "buttons";
      s.run();
    });
    page.append(rowsEl);
    dom.dRowsEl = rowsEl;
    dom.dInfo = info;

    // Staffelwahl
    dom.picker = h("div", "nf-picker");
    page.append(dom.picker);
    root.append(page, backButton());
  }

  function renderDetail() {
    const inRows = S.dZone === "rows" && dom.dRows.length;
    root.classList.toggle("nf-d-in-rows", !!inRows);
    root.classList.remove("nf-nav-open", "nf-in-rows");
    S.dBtn = clamp(S.dBtn, 0, Math.max(0, dom.dButtons.length - 1));
    dom.dButtons.forEach((b, i) => b.el.classList.toggle("nf-on", !inRows && !S.picker && i === S.dBtn));
    S.dRow = clamp(S.dRow, 0, Math.max(0, dom.dRows.length - 1));
    const top = inRows ? 33 : 74;
    const rowH = 42;
    dom.dRowsEl.style.transform = `translateY(calc(var(--u) * ${top - (inRows ? S.dRow : 0) * rowH}))`;
    dom.dRows.forEach((row, r) => {
      const col = clamp(S.dCols[r] || 0, 0, row.cards.length - 1);
      S.dCols[r] = col;
      row.el.classList.toggle("nf-row-gone", inRows && r < S.dRow);
      row.track.style.transform = `translateX(calc(var(--u) * ${-col * row.step}))`;
      row.cards.forEach((c, i) => {
        c.classList.toggle("nf-on", inRows && !S.picker && r === S.dRow && i === col);
        c.classList.toggle("nf-past", i < col);
      });
    });

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
    if (key === "back") return closeDetail();
    if (S.dZone === "buttons") {
      if (key === "left" || key === "right") S.dBtn += key === "left" ? -1 : 1;
      else if (key === "down" && dom.dRows.length) (S.dZone = "rows"), (S.dRow = 0);
      else if (key === "ok" && dom.dButtons[S.dBtn]) dom.dButtons[S.dBtn].action();
    } else {
      const row = dom.dRows[S.dRow];
      const col = S.dCols[S.dRow] || 0;
      if (key === "left") S.dCols[S.dRow] = Math.max(0, col - 1);
      else if (key === "right") S.dCols[S.dRow] = Math.min(row.cards.length - 1, col + 1);
      else if (key === "up") {
        if (S.dRow > 0) S.dRow--;
        else S.dZone = "buttons";
      } else if (key === "down") S.dRow = Math.min(dom.dRows.length - 1, S.dRow + 1);
      else if (key === "ok") row.action(row.items[col]);
    }
    renderDetail();
  }

  function closeDetail() {
    S.picker = null;
    if (S.api) {
      S.detailId = null;
      S.d = null;
      if (S.home) {
        S.view = "home";
        S.zone = S.returnZone || S.zone;
        buildHome();
        S.builtHome = S.home;
        renderHome();
      }
      return;
    }
    S.closedAt = Date.now();
    if (S.home) {
      S.view = "home";
      S.zone = S.returnZone || S.zone;
      buildHome();
      renderHome();
    }
    if (S.d && S.d.close) S.d.close.click();
    else history.back();
  }

  function openPicker() {
    if (S.d.seasons) {
      const index = Math.max(0, S.d.seasons.findIndex((s) => s.id === S.d.season.id));
      S.picker = { options: S.d.seasons, index };
      return renderDetail();
    }
    const toggle = S.d.season.el;
    toggle.click(); // Netflix-Menü (versteckt) öffnen, um die Staffeln auszulesen
    setTimeout(() => {
      const m = detailEl() || document;
      const options = $$("[role=option], [role=menuitem], [data-uia^='dropdown-menu-item'], li", toggle.parentElement.parentElement || m)
        .filter((o) => shown(o) && /Staffel|Season|Teil|Band/i.test(text(o)))
        .map((o) => ({ label: text(o).replace(/\(\d+ Folgen?\)/, "").trim(), el: o }));
      if (!options.length) return toggle.click();
      const current = options.findIndex((o) => o.label.startsWith(S.d.season.label));
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
      if (S.d.season.el) S.d.season.el.click(); // Netflix-Menü wieder schließen
    } else if (key === "ok" && S.d.seasons) {
      const chosen = p.options[p.index];
      S.picker = null;
      const d = S.d;
      loadSeason(chosen.id, d.title).then((episodes) => {
        if (S.d !== d) return;
        S.d = { ...d, episodes, season: { label: chosen.label, id: chosen.id } };
        S.dZone = "rows";
        S.dRow = 0;
        S.dCols[0] = 0;
      }).catch(() => {});
    } else if (key === "ok") {
      p.options[p.index].el.click();
      S.picker = null;
      S.dZone = "rows";
      S.dRow = 0;
      S.dCols[0] = 0;
    }
    renderDetail();
  }

  // ---------- Abspielen ----------

  function rememberTitle(title) {
    try {
      if (title) sessionStorage.setItem("raspitv-title", title);
      else sessionStorage.removeItem("raspitv-title");
    } catch (error) {}
  }

  function play(el, title) {
    rememberTitle(title);
    el.click();
  }

  // ---------- Steuerung ----------

  TV.site.key = (key) => {
    if (S.view === "home" && S.home) homeKey(key);
    else if (S.view === "detail" && S.d) detailKey(key);
    else if (S.view === "profiles" && S.profiles) profilesKey(key);
    else if (S.view === "pin") pinKey(key);
    else if (S.view === "loading" && (key === "back" || key === "home")) TV.home();
  };

  // ---------- Ladebildschirm ----------

  function buildLoading() {
    root.replaceChildren();
    const page = h("div", "nf-loading");
    const logo = h("div", "nf-n-logo");
    logo.innerHTML = N_LOGO;
    page.append(logo, h("div", "nf-spinner"));
    root.append(page);
  }

  // ---------- Profilauswahl ----------

  function readProfiles() {
    return $$("[data-uia^='profile-selector+tile-']")
      .filter((t) => !t.dataset.uia.endsWith("+lock") && shown(t))
      .map((t) => ({
        el: t,
        name: text(t),
        img: src($("img", t)),
        lock: !!$("[data-uia$='+lock']", t),
      }));
  }

  const LOCK_SVG =
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6' +
    'a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V7a3 3 0 0 0-6 0z"/></svg>';

  function buildProfiles() {
    root.replaceChildren();
    const page = h("div", "nf-profiles");
    const logo = h("div", "nf-profiles-logo");
    logo.innerHTML = N_LOGO;
    page.append(logo, h("h1", "nf-profiles-title", "Wer schaut gerade?"));
    const row = h("div", "nf-profiles-row");
    dom.profiles = S.profiles.map((p, i) => {
      const tile = h("div", "nf-profile");
      const pic = h("div", "nf-profile-pic");
      pic.append(img(p.img));
      if (p.lock) {
        const lock = h("div", "nf-profile-lock");
        lock.innerHTML = LOCK_SVG;
        pic.append(lock);
      }
      tile.append(pic, h("div", "nf-profile-name", p.name));
      tile.onclick = () => { S.profile = i; profilesKey("ok"); };
      row.append(tile);
      return tile;
    });
    page.append(row);
    root.append(page, backButton());
  }

  function renderProfiles() {
    S.profile = clamp(S.profile, 0, S.profiles.length - 1);
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

  // ---------- PIN-Eingabe ----------

  const PIN_BACKSPACE = "\u232B";
  const PIN_CLOSE = "\u2715";
  const PIN_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", PIN_BACKSPACE, "0", PIN_CLOSE];

  function buildPin() {
    root.replaceChildren();
    const page = h("div", "nf-pin");
    const p = S.pinProfile;
    if (p) {
      const pic = h("div", "nf-profile-pic nf-pin-pic");
      pic.append(img(p.img));
      page.append(pic, h("div", "nf-pin-name", p.name));
    }
    page.append(h("h1", "nf-pin-title", "PIN eingeben"));
    dom.pinDots = [0, 1, 2, 3].map(() => h("div", "nf-pin-dot"));
    const dots = h("div", "nf-pin-dots");
    dots.append(...dom.pinDots);
    dom.pinError = h("div", "nf-pin-error");
    page.append(dots, dom.pinError);
    const pad = h("div", "nf-pin-pad");
    dom.pinKeys = PIN_KEYS.map((k, i) => {
      const b = h("div", "nf-pin-key", k);
      b.onclick = () => { S.pinKey = i; pinKey("ok"); };
      pad.append(b);
      return b;
    });
    page.append(pad);
    root.append(page, backButton());
  }

  function renderPin() {
    dom.pinDots.forEach((d, i) => d.classList.toggle("nf-filled", i < S.pin.length));
    dom.pinKeys.forEach((k, i) => k.classList.toggle("nf-on", i === S.pinKey));
    const error = $("[data-uia='profile-gate-pin'] [data-uia*='error'], [data-uia='profile-gate-pin'] [role=alert]");
    dom.pinError.textContent = error ? text(error) : "";
  }

  function setPin(value) {
    S.pin = value;
    const input = $("[data-uia='profile-gate-pin+input']");
    if (input) {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function closePin() {
    const close = $("[data-uia='profile-gate-pin'] [data-uia='icon-button'], [data-uia='profile-gate-pin'] button[aria-label]");
    S.pin = "";
    if (close) close.click();
  }

  function pinKey(key) {
    if (key === "back") return closePin();
    if (key === "left" && S.pinKey % 3 > 0) S.pinKey--;
    else if (key === "right" && S.pinKey % 3 < 2) S.pinKey++;
    else if (key === "up" && S.pinKey >= 3) S.pinKey -= 3;
    else if (key === "down" && S.pinKey < 9) S.pinKey += 3;
    else if (key === "ok") pressPin(PIN_KEYS[S.pinKey]);
    renderPin();
  }

  function pressPin(k) {
    if (k === PIN_CLOSE) return closePin();
    if (k === PIN_BACKSPACE) return setPin(S.pin.slice(0, -1));
    if (S.pin.length < 4) setPin(S.pin + k); // nach der 4. Ziffer prüft Netflix die PIN selbst
  }

  // Zifferntasten der Tastatur bei der PIN-Eingabe
  window.addEventListener("keydown", (e) => {
    if (S.view !== "pin" || !/^[0-9]$/.test(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    pressPin(e.key);
    renderPin();
  }, true);

  /** Regelmäßig: Ansicht bestimmen, Daten neu lesen, bei Änderungen neu aufbauen. */
  function update() {
    const view = computeView();
    document.documentElement.classList.toggle("nftv-on", !!view);
    // Startschutz (boot.js): eigene Oberfläche steht bzw. die Seite selbst ist dran (Player)
    if (view || location.pathname.startsWith("/watch")) window.TVBoot?.release(); else window.TVBoot?.idle(400);
    if (view) {
      // Vorschau-Videos der versteckten Seite stumm und angehalten lassen
      for (const v of $$("video")) {
        v.muted = true;
        if (!v.paused) v.pause();
      }
    }

    // Aus dem Player zurück: Fortschritt neu laden (Weiterschauen, Folgen)
    const watching = location.pathname.startsWith("/watch");
    if (S.watching && !watching && S.api) {
      if (S.detailId) {
        const id = S.detailId;
        loadDetail(id).then((d) => { if (S.detailId === id) S.d = d; }).catch(() => {});
      }
      if (S.navId !== "search") loadHome(S.cat);
    }
    S.watching = watching;

    if (S.api && (view === "home" || view === "loading") && !S.home && !S.homeLoading && S.navId !== "search" &&
        !/^\/(watch|ProfilesGate)/.test(location.pathname)) loadHome(S.cat);

    if (view === "home" && S.api) {
      if (S.view !== "home" || S.builtHome !== S.home) {
        if (S.view === "detail" && S.returnZone) S.zone = S.returnZone;
        if (S.builtHome && S.builtHome !== S.home && S.view === "home") {
          // gleiche Seite neu geladen (z. B. nach dem Player): Position behalten, soweit möglich
        }
        buildHome();
        S.builtHome = S.home;
      }
      S.view = "home";
      renderHome();
    } else if (view === "detail" && S.api) {
      if (S.view !== "detail" || S.builtD !== S.d) {
        if (S.view !== "detail" || (S.builtD && S.builtD.key !== S.d.key)) {
          S.dZone = "buttons";
          S.dBtn = 0;
          S.dRow = 0;
          S.dCols = [0, 0];
        }
        buildDetail();
        S.builtD = S.d;
      }
      S.view = "detail";
      renderDetail();
    } else if (view === "home") {
      const data = readHome();
      const sig = JSON.stringify([data.billboard && data.billboard.bg, data.rows.map((r) => [r.title, r.cards.length, r.cards.map((c) => c.progress)])]);
      if (S.view !== "home" || sig !== S.homeSig) {
        if (S.view === "detail" && S.returnZone) S.zone = S.returnZone; // zurück zur Karte, von der man kam
        S.home = data;
        S.homeSig = sig;
        buildHome();
      }
      S.view = "home";
      renderHome();
    } else if (view === "detail") {
      const m = detailEl();
      const data = readDetail(m);
      const sig = JSON.stringify([data.key, data.bg, data.season && data.season.label, data.episodes.length, data.similar.length, data.myList && data.myList.added, data.play && data.play.label]);
      if (S.view !== "detail" || sig !== S.dSig) {
        if (S.view !== "detail" || (S.d && S.d.key !== data.key)) {
          S.dZone = "buttons";
          S.dBtn = 0;
          S.dRow = 0;
          S.dCols = [0, 0];
        }
        S.d = data;
        S.dSig = sig;
        buildDetail();
        S.builtD = data;
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
      if (S.view !== "pin") buildPin();
      S.view = "pin";
      // Netflix leert das Feld nach einer falschen PIN – mitziehen
      const input = $("[data-uia='profile-gate-pin+input']");
      if (input && input.value.length < S.pin.length) S.pin = input.value;
      renderPin();
    } else if (view === "loading") {
      if (S.view !== "loading") buildLoading();
      S.view = "loading";
    } else {
      if (S.view) root.replaceChildren();
      S.view = null;
    }
  }

  // Zurück-Pfeil im Player für die Maus (die Netflix-eigene Leiste ist ausgeblendet)
  const playerBack = h("div", "nf-back nf-player-back");
  playerBack.append(icon("back"));
  playerBack.title = "Zurück";
  playerBack.onclick = () => history.back();
  document.documentElement.append(playerBack);
  let hideBack = null;
  window.addEventListener("mousemove", () => {
    if (!location.pathname.startsWith("/watch")) return;
    playerBack.classList.add("nf-show");
    clearTimeout(hideBack);
    hideBack = setTimeout(() => playerBack.classList.remove("nf-show"), 3000);
  }, true);

  setInterval(update, 400);
  update();
})();
