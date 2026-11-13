// Spotify: eigene TV-Oberfläche (angemeldet) – Aussehen und Bedienung wie bei Apple Music (applemusic-app.css).
//
// Spotifys Webseite lädt nur noch im Hintergrund und wird nicht gezeichnet (html.tvam-app body: content-visibility
// hidden). Daten kommen über dieselben GraphQL-Abfragen wie im Web-Player, abgespielt wird per „play“-Befehl an
// den Web-Player selbst (Brücke: spotify-main.js). Pause/Vor/Zurück drücken die (unsichtbaren) Knöpfe des
// Web-Players; Titel, Cover und Fortschritt kommen aus dessen Anzeige.
(() => {
  if (!window.TV) return;

  // ---------- Brücke (spotify-main.js) ----------
  let seq = 0;
  const waiting = new Map();
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.tvsp !== "res") return;
    const w = waiting.get(event.data.id);
    if (!w) return;
    waiting.delete(event.data.id);
    if (event.data.ok) w.resolve(event.data.data); else w.reject(new Error(event.data.error));
  });
  function call(op, args) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      waiting.set(id, { resolve, reject });
      window.postMessage({ tvsp: "req", id, op, args }, "*");
      setTimeout(() => { if (waiting.delete(id)) reject(new Error("Zeitüberschreitung")); }, 25000);
    });
  }
  const gql = (name, variables) => call("gql", { name, variables }).then((r) => r?.data || {});

  // ---------- Hilfen ----------
  const $ = (sel) => document.querySelector(sel);
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const SVG = "http://www.w3.org/2000/svg";
  function icon(d, cls) {
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    if (cls) svg.setAttribute("class", cls);
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "currentColor");
    svg.append(path);
    return svg;
  }
  const ICONS = {
    prev: "M6 5h2v14H6zM9.5 12 19 5v14z",
    next: "M16 5h2v14h-2zM5 5l9.5 7L5 19z",
    play: "M7 4.5v15L19.5 12z",
    pause: "M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z",
    shuffle: "M16 4h4v4l-1.5-1.5-3.6 3.6-1.4-1.4 3.6-3.6zM4 17.6 15.1 6.5l1.4 1.4L5.4 19zM14.5 13.1l1.4-1.4 2.6 2.6L20 12.8V18h-5.2l1.5-1.5zM4 6.4 5.4 5l4.3 4.3-1.4 1.4z",
    search: "M10 3a7 7 0 0 1 5.6 11.2l4.6 4.6-1.4 1.4-4.6-4.6A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z",
    home: "M12 3 2.5 11.2V21h7v-6h5v6h7v-9.8z",
    library: "M4 3h2v18H4zM9 3h2v18H9zM14.3 3.6l1.9-.6 5.4 17.2-1.9.6z",
    heart: "M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.4h2c.7-1.2 2.2-2.4 4.3-2.4 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z",
  };
  const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
  /** Passendste Bildgröße aus Spotifys Quellen ([{url, width}]) */
  function pick(sources, size) {
    const list = (sources || []).filter((s) => s && s.url);
    if (!list.length) return "";
    const sized = list.filter((s) => s.width).sort((a, b) => a.width - b.width);
    return (sized.find((s) => s.width >= size) || sized[sized.length - 1] || list[0]).url;
  }
  const names = (artists) => (artists?.items || []).map((a) => a.profile?.name).filter(Boolean).join(", ");

  /** Spotify-Eintrag (GraphQL) → Karte {kind, uri, title, sub, img, …} */
  function toItem(d) {
    if (!d) return null;
    if (/ResponseWrapper$/.test(d.__typename || "") || (!d.__typename && d.data)) d = d.data;
    if (!d || !d.__typename) return null;
    switch (d.__typename) {
      case "Playlist":
        return { kind: "playlist", uri: d.uri, title: d.name, sub: d.ownerV2?.data?.name || "", img: d.images?.items?.[0]?.sources };
      case "PseudoPlaylist":
        return { kind: "liked", uri: d.uri, title: d.name || "Lieblingssongs", sub: d.count ? `${d.count} Titel` : "", img: d.image?.sources };
      case "Album":
        return { kind: "album", uri: d.uri || (d.id && `spotify:album:${d.id}`), title: d.name, sub: names(d.artists), img: d.coverArt?.sources };
      case "Artist":
        return { kind: "artist", uri: d.uri, title: d.profile?.name || "", sub: "Künstler:in", img: d.visuals?.avatarImage?.sources, round: true };
      case "Track":
        return {
          kind: "track", uri: d.uri || (d.id && `spotify:track:${d.id}`), title: d.name, artist: names(d.artists), sub: names(d.artists),
          album: d.albumOfTrack?.uri || "", img: d.albumOfTrack?.coverArt?.sources,
          duration: ((d.trackDuration || d.duration)?.totalMilliseconds || 0) / 1000,
        };
      case "Podcast": case "Audiobook":
        return { kind: "show", uri: d.uri, title: d.name, sub: d.publisher?.name || "", img: d.coverArt?.sources };
      case "Episode":
        return { kind: "episode", uri: d.uri, title: d.name, sub: d.podcastV2?.data?.name || "", img: d.coverArt?.sources };
      default:
        return d.name && d.uri ? { kind: "other", uri: d.uri, title: d.name, sub: "", img: d.coverArt?.sources || d.images?.items?.[0]?.sources } : null;
    }
  }

  // ---------- Grundgerüst ----------
  let root, header, pillsBox, subnav, pageBox, scroller, nowPill;
  const PILLS = [["home", "Startseite"], ["search", "Suchen"], ["library", "Bibliothek"]];
  const LIBRARY = [["playlists", "Playlists"], ["albums", "Alben"], ["artists", "Künstler:innen"], ["liked", "Lieblingssongs"]];
  let tab = "home", libTab = "playlists";
  let stack = [];        // geöffnete Unterseiten (Playlist, Album, Künstler)
  let page = null;
  let username = "";

  let mini, profileBox, bgLayer, heroEls = null;
  function build() {
    root = el("div", "tvam tvsp");
    bgLayer = el("div", "tvsp-bg");
    header = el("div", "tvam-header");
    // links: was gerade läuft (OK öffnet „Jetzt läuft“)
    mini = el("button", "tvsp-mini");
    mini.append(el("img", "tvsp-mini__img"), el("div", "tvsp-mini__text"));
    mini.lastChild.append(el("div", "tvsp-mini__title"), el("div", "tvsp-mini__sub"));
    mini.append(icon(ICONS.play, "tvsp-mini__icon"));
    mini.addEventListener("click", () => openNow());
    mini.hidden = true;
    nowPill = mini;
    pillsBox = el("div", "tvam-pills");
    const pillIcons = { home: ICONS.home, search: ICONS.search, library: ICONS.library };
    for (const [key, label] of PILLS) {
      const b = el("button", "tvam-pill");
      b.dataset.tab = key;
      b.append(icon(pillIcons[key], "tvam-pill__icon"), document.createTextNode(label));
      b.addEventListener("click", () => openTab(key));
      pillsBox.append(b);
    }
    profileBox = el("div", "tvsp-profile");
    profileBox.append(el("img", "tvsp-profile__img"), el("div", "tvsp-profile__name", ""));
    const left = el("div", "tvsp-left");
    left.append(mini);
    header.append(left, pillsBox, profileBox);
    subnav = el("div", "tvam-subnav");
    for (const [key, label] of LIBRARY) {
      const b = el("button", "tvam-sub", label);
      b.dataset.lib = key;
      b.addEventListener("click", () => { libTab = key; openTab("library"); });
      subnav.append(b);
    }
    pageBox = el("div", "tvam-page");
    root.append(bgLayer, header, subnav, pageBox);
    document.documentElement.append(root);
  }

  function markPills() {
    for (const b of pillsBox.querySelectorAll(".tvam-pill[data-tab]")) b.classList.toggle("is-selected", b.dataset.tab === tab && page?.kind !== "now");
    nowPill.classList.toggle("is-selected", page?.kind === "now");
    for (const b of subnav.querySelectorAll(".tvam-sub")) b.classList.toggle("is-selected", b.dataset.lib === libTab);
    root.classList.toggle("tvam--lib", tab === "library" && page?.kind !== "now");
    root.classList.toggle("tvsp--home", page?.kind === "home");
  }

  function show(kind, buildFn, focusFirst = true) {
    page?.dispose?.();
    pageBox.replaceChildren();
    scroller = el("div", "tvam-scroll");
    scroller.dataset.y = "0";
    pageBox.append(scroller);
    page = { kind, el: scroller };
    scroller.classList.toggle("tvam-scroll--full", kind === "now");
    markPills();
    const mine = page;
    const loading = el("div", "tvam-loading", "Lädt …");
    scroller.append(loading);
    Promise.resolve(buildFn(scroller, mine)).catch((error) => {
      if (page !== mine) return;
      scroller.append(el("div", "tvam-error", `Konnte nicht geladen werden (${error.message})`));
    }).finally(() => {
      loading.remove();
      if (page !== mine) return;
      if (focusFirst && !(TV.current && root.contains(TV.current) && !header.contains(TV.current) && !subnav.contains(TV.current))) {
        const target = scroller.querySelector(".tvam-btn--primary, button, input");
        if (target) TV.focus(target);
      }
    });
    return mine;
  }

  function openTab(key) {
    tab = key;
    stack = [];
    const fromHeader = TV.current && (header.contains(TV.current) || subnav.contains(TV.current));
    const pages = { home: homePage, library: libraryPage, search: searchPage };
    show(key, pages[key], !fromHeader);
  }

  // ---------- Reihen und Karten ----------
  function card(it, kind) {
    const b = el("button", `tvam-card tvam-card--${kind}${it.round ? " tvsp-round" : ""}`);
    b._item = it;
    const img = el("img", "tvam-card__img");
    img.loading = "lazy";
    img.decoding = "async";
    const url = pick(it.img, 300);
    if (url) img.src = url; else img.classList.add("is-empty");
    b.append(img, el("div", "tvam-card__title", it.title));
    if (it.sub) b.append(el("div", "tvam-card__sub", it.sub));
    b.addEventListener("click", () => activate(it));
    return b;
  }

  function songTile(it, list, index, context) {
    const b = el("button", "tvam-song");
    const img = el("img", "tvam-song__img");
    img.loading = "lazy";
    const url = pick(it.img, 120);
    if (url) img.src = url;
    const t = el("div", "tvam-song__text");
    t.append(el("div", "tvam-song__title", it.title), el("div", "tvam-song__sub", it.artist || it.sub));
    b.append(img, t);
    b.addEventListener("click", () => playTrack(list, index, context));
    return b;
  }

  function shelf(box, title, items, layout = "cards", context) {
    items = (items || []).filter(Boolean);
    if (!items.length) return null;
    const s = el("section", `tvam-shelf tvam-shelf--${layout}`);
    if (title) s.append(el("h2", "tvam-shelf__title", title));
    const clip = el("div", "tvam-clip");
    const row = el("div", "tvam-row");
    row.dataset.x = "0";
    if (layout === "songs") items.forEach((it, i) => row.append(songTile(it, items, i, context)));
    else items.forEach((it) => row.append(card(it, layout)));
    clip.append(row);
    s.append(clip);
    box.append(s);
    return s;
  }

  // ---------- Seiten ----------
  const KIND_LABEL = { album: "Album", playlist: "Playlist", artist: "Künstler:in", track: "Titel", liked: "Playlist",
    show: "Podcast", episode: "Folge" };
  function heroMeta(it) {
    return [it.kind === "artist" ? "" : it.sub || it.artist, KIND_LABEL[it.kind]].filter(Boolean).join("  •  ");
  }
  /** Großen Bereich oben und Hintergrund auf das gewählte Element setzen */
  function setHero(it) {
    if (!it || !heroEls) return;
    heroEls.title.textContent = it.title;
    heroEls.meta.textContent = heroMeta(it);
    const url = pick(it.img, 640);
    if (url && bgLayer.dataset.src !== url) {
      bgLayer.dataset.src = url;
      bgLayer.style.backgroundImage = `url("${url}")`;
      // Collagen-Cover (4 Alben) wirken groß unruhig: weichzeichnen
      bgLayer.classList.toggle("tvsp-bg--soft", /mosaic\.scdn\.co/.test(url));
    }
  }

  function shortcut(it) {
    const b = el("button", "tvsp-short");
    b._item = it;
    const img = el("img", "tvsp-short__img");
    const url = pick(it.img, 160);
    if (url) img.src = url; else img.classList.add("is-empty");
    if (it.kind === "liked" && !url) { img.classList.add("tvsp-liked"); }
    b.append(img, el("div", "tvsp-short__title", it.title));
    b.addEventListener("click", () => activate(it));
    return b;
  }

  async function homePage(box, mine) {
    // Variablen wie der Web-Player (falls dessen eigene Abfrage noch nicht gelaufen ist)
    const data = await gql("home", {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin", sp_t: "", facet: "",
      sectionItemsLimit: 10, includeHomeChapterVideoCards: false, homeEndUserIntegration: "INTEGRATION_WEB_PLAYER",
      includeEpisodeContentRatingsV2: true,
    });
    if (page !== mine) return;
    box.classList.add("tvsp-home");
    const hero = el("div", "tvsp-hero");
    heroEls = { title: el("h1", "tvsp-hero__title"), meta: el("div", "tvsp-hero__meta") };
    hero.append(heroEls.title, heroEls.meta);
    box.append(hero);
    const sections = data?.home?.sectionContainer?.sections?.items || [];
    // Schnellzugriff (Spotifys „Shortcuts“): 2 Reihen à 4 Kacheln
    const shortSec = sections.find((sec) => /Shorts/.test(sec.data?.__typename || ""));
    const shorts = (shortSec?.sectionItems?.items || []).map((x) => toItem(x.content)).filter(Boolean).slice(0, 8);
    if (shorts.length) {
      const grid = el("div", "tvsp-shorts");
      for (let r = 0; r < shorts.length; r += 4) {
        const row = el("div", "tvsp-shorts__row");
        shorts.slice(r, r + 4).forEach((it) => row.append(shortcut(it)));
        grid.append(row);
      }
      box.append(grid);
    }
    for (const sec of sections) {
      if (sec === shortSec) continue;
      const items = (sec.sectionItems?.items || []).map((x) => toItem(x.content)).filter(Boolean);
      const title = sec.data?.title?.transformedLabel || sec.data?.title?.text || "";
      const s = shelf(box, title, items, items.every((x) => x.kind === "track") ? "songs" : "cards");
      if (s) s.querySelectorAll(".tvam-card").forEach((c, i) => (c._item = items[i]));
    }
    setHero(shorts[0] || toItem(sections[0]?.sectionItems?.items?.[0]?.content));
    if (!box.querySelector(".tvam-shelf, .tvsp-short")) box.append(el("div", "tvam-empty", "Keine Inhalte"));
  }

  const LIB_FILTERS = { playlists: ["Playlists"], albums: ["Albums"], artists: ["Artists"] };
  async function libraryPage(box, mine) {
    if (libTab === "liked") return void (await likedPage(box, mine, true));
    const grid = el("div", "tvam-grid");
    box.append(grid);
    let offset = 0, total = Infinity, busy = false;
    async function more() {
      if (busy || offset >= total) return;
      busy = true;
      try {
        const data = await gql("libraryV3", { filters: LIB_FILTERS[libTab], limit: 50, offset });
        if (page !== mine) return;
        const lib = data?.me?.libraryV3 || {};
        total = lib.totalCount ?? 0;
        const items = lib.items || [];
        offset += items.length || 50;
        if (!items.length) total = 0;
        for (const it of items.map((x) => toItem(x.item)).filter(Boolean)) grid.append(card(it, "grid"));
      } finally { busy = false; }
    }
    mine.onFocus = (target) => {
      const index = Array.prototype.indexOf.call(grid.children, target);
      if (index >= 0 && index >= grid.children.length - 12) more();
    };
    await more();
    if (!grid.children.length) box.append(el("div", "tvam-empty", "Hier ist noch nichts."));
  }

  let lastTerm = "";
  function searchPage(box, mine) {
    const field = el("div", "tvam-search");
    const input = el("input", "tvam-search__input");
    input.type = "search";
    input.placeholder = "Was möchtest du hören?";
    input.value = lastTerm;
    field.append(icon(ICONS.search, "tvam-search__icon"), input);
    const results = el("div", "tvam-results");
    box.append(field, results);
    let timer = null;
    const run = async () => {
      const term = input.value.trim();
      lastTerm = term;
      results.replaceChildren();
      if (!term) return;
      const data = await gql("searchDesktop", {
        searchTerm: term, offset: 0, limit: 15, numberOfTopResults: 5, includeAudiobooks: false,
        includeArtistHasConcertsField: false, includePreReleases: false, includeLocalConcertsField: false, includeAuthors: false,
      }).catch(() => null);
      if (page !== mine || input.value.trim() !== term) return;
      const r = data?.searchV2 || {};
      shelf(results, "Titel", (r.tracksV2?.items || []).map((x) => toItem(x.item)), "songs");
      shelf(results, "Künstler:innen", (r.artists?.items || []).map(toItem));
      shelf(results, "Alben", (r.albumsV2?.items || []).map(toItem));
      shelf(results, "Playlists", (r.playlists?.items || []).map(toItem));
      shelf(results, "Podcasts", (r.podcasts?.items || []).map(toItem));
      if (!results.children.length) results.append(el("div", "tvam-empty", `Keine Treffer für „${term}“`));
    };
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 700); });
    input.addEventListener("change", () => { clearTimeout(timer); run(); });
    if (lastTerm) run();
    setTimeout(() => { if (page === mine && !(TV.current && header.contains(TV.current))) TV.focus(input); }, 0);
  }

  // ---------- Playlist, Album, Künstler ----------
  function activate(it) {
    if (!it) return;
    if (it.kind === "track") return playTrack([it], 0, it.album || null);
    if (it.kind === "episode") return play({ context: it.uri });
    if (["playlist", "album", "artist", "liked", "show"].includes(it.kind)) {
      stack.push({ item: it });
      return openDetail(it);
    }
    if (it.uri) play({ context: it.uri });
  }

  function openDetail(it) {
    if (it.kind === "artist") return show("artist", (box, mine) => artistPage(it, box, mine));
    if (it.kind === "liked") return show("detail", (box, mine) => likedPage(box, mine, false));
    show("detail", (box, mine) => containerPage(it, box, mine));
  }

  function detailHead(box, { img, title, by, meta, note, context, tracksRef }) {
    const head = el("div", "tvam-detail");
    const pic = el("img", "tvam-detail__art");
    if (img) pic.src = img; else pic.classList.add("is-empty");
    const info = el("div", "tvam-detail__info");
    info.append(el("div", "tvam-detail__title", title));
    if (by) info.append(el("div", "tvam-detail__by", by));
    if (meta) info.append(el("div", "tvam-detail__meta", meta));
    if (note) info.append(el("div", "tvam-detail__note", note));
    const buttons = el("div", "tvam-detail__buttons");
    const playBtn = el("button", "tvam-btn tvam-btn--primary");
    playBtn.append(icon(ICONS.play), document.createTextNode("Wiedergabe"));
    playBtn.addEventListener("click", () => play({ context, list: tracksRef(), index: 0 }));
    const shuffleBtn = el("button", "tvam-btn");
    shuffleBtn.append(icon(ICONS.shuffle), document.createTextNode("Zufällig"));
    shuffleBtn.addEventListener("click", () => play({ context, list: tracksRef(), index: 0, shuffle: true }));
    buttons.append(playBtn, shuffleBtn);
    info.append(buttons);
    head.append(pic, info);
    box.append(head);
  }

  const stripTags = (s) => (s || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'");

  async function containerPage(it, box, mine) {
    if (it.kind === "album") {
      const data = await gql("getAlbum", { uri: it.uri, locale: "", offset: 0, limit: 50 });
      if (page !== mine) return;
      const a = data?.albumUnion || {};
      const year = (a.date?.isoString || "").slice(0, 4);
      const total = a.tracksV2?.totalCount || 0;
      let list = null;
      detailHead(box, { img: pick(a.coverArt?.sources, 400) || pick(it.img, 400), title: a.name || it.title, by: names(a.artists) || it.sub,
        meta: [year, total ? `${total} Titel` : ""].filter(Boolean).join(" · "), context: it.uri, tracksRef: () => list?.tracks || [] });
      const first = (a.tracksV2?.items || []).map((x) => toItem({ ...x.track, __typename: "Track", albumOfTrack: { uri: it.uri, coverArt: a.coverArt } }));
      list = await trackList(box, mine, {
        context: it.uri, album: true, first, total,
        load: async (offset) => {
          const d = await gql("getAlbum", { uri: it.uri, locale: "", offset, limit: 50 });
          return (d?.albumUnion?.tracksV2?.items || []).map((x) => toItem({ ...x.track, __typename: "Track", albumOfTrack: { uri: it.uri, coverArt: a.coverArt } }));
        },
      });
      return;
    }
    if (it.kind === "show") {
      box.append(el("div", "tvam-empty", "Podcasts: bitte über die Suche eine Folge wählen"));
      return;
    }
    // Playlist
    const data = await gql("fetchPlaylist", { uri: it.uri, offset: 0, limit: 50, enableWatchFeedEntrypoint: false });
    if (page !== mine) return;
    const p = data?.playlistV2 || {};
    const total = p.content?.totalCount || 0;
    let list = null;
    detailHead(box, { img: pick(p.images?.items?.[0]?.sources, 400) || pick(it.img, 400), title: p.name || it.title,
      by: p.ownerV2?.data?.name || it.sub, meta: total ? `${total} Titel` : "", note: stripTags(p.description),
      context: it.uri, tracksRef: () => list?.tracks || [] });
    const map = (items) => (items || []).map((x) => toItem(x.itemV2)).filter(Boolean);
    list = await trackList(box, mine, {
      context: it.uri, first: map(p.content?.items), total,
      load: async (offset) => map((await gql("fetchPlaylist", { uri: it.uri, offset, limit: 50, enableWatchFeedEntrypoint: false }))?.playlistV2?.content?.items),
    });
  }

  async function likedPage(box, mine, inLibrary) {
    const data = await gql("fetchLibraryTracks", { offset: 0, limit: 50 });
    if (page !== mine) return;
    const t = data?.me?.library?.tracks || {};
    const context = username ? `spotify:user:${username}:collection` : "";
    const map = (items) => (items || []).map((x) => toItem(x.track || x.item || x)).filter(Boolean);
    let list = null;
    if (!inLibrary) {
      detailHead(box, { img: "", title: "Lieblingssongs", meta: t.totalCount ? `${t.totalCount} Titel` : "", context, tracksRef: () => list?.tracks || [] });
    }
    list = await trackList(box, mine, {
      context, first: map(t.items), total: t.totalCount || 0,
      load: async (offset) => map((await gql("fetchLibraryTracks", { offset, limit: 50 }))?.me?.library?.tracks?.items),
    });
  }

  async function artistPage(it, box, mine) {
    const data = await gql("queryArtistOverview", { uri: it.uri, locale: "", includePrerelease: false });
    if (page !== mine) return;
    const a = data?.artistUnion || {};
    box.append(el("h1", "tvam-page__title", a.profile?.name || it.title));
    const d = a.discography || {};
    const release = (x) => toItem({ ...(x.releases?.items?.[0] || {}), __typename: "Album" });
    shelf(box, "Beliebt", (d.topTracks?.items || []).map((x) => toItem({ ...x.track, __typename: "Track" })), "songs", it.uri);
    shelf(box, "Alben", (d.albums?.items || []).map(release));
    shelf(box, "Singles und EPs", (d.singles?.items || []).map(release));
    shelf(box, "Fans mögen auch", (a.relatedContent?.relatedArtists?.items || []).map((x) => toItem({ ...x, __typename: "Artist" })));
  }

  // Titel-Liste: 8 Zeilen, beim Herunterblättern kurz vor dem Ende die nächsten 8 (lädt bei Bedarf nach)
  const STEP = 8;
  async function trackList(box, mine, { context, album, first, total, load }) {
    const list = el("div", "tvam-tracks");
    box.append(list);
    const tracks = [...(first || [])];
    let busy = false;
    async function fetchMore() {
      if (busy || tracks.length >= total) return;
      busy = true;
      try {
        const more = await load(tracks.length);
        if (!more.length) total = tracks.length;
        tracks.push(...more);
      } finally { busy = false; }
    }
    function render(count) {
      for (let i = list.children.length; i < Math.min(count, tracks.length); i++) {
        const t = tracks[i];
        const row = el("button", "tvam-track");
        row.append(el("span", "tvam-track__no", album ? String(i + 1) : ""));
        if (!album) {
          const img = el("img", "tvam-track__img");
          img.loading = "lazy";
          const url = pick(t.img, 100);
          if (url) img.src = url;
          row.append(img);
        }
        const txt = el("span", "tvam-track__text");
        txt.append(el("span", "tvam-track__title", t.title));
        if (t.artist) txt.append(el("span", "tvam-track__sub", t.artist));
        row.append(txt, el("span", "tvam-track__time", t.duration ? fmt(t.duration) : ""));
        row.addEventListener("click", () => playTrack(tracks, i, context));
        list.append(row);
      }
    }
    if (!tracks.length) await fetchMore();
    if (page !== mine) return { tracks };
    render(STEP);
    if (!tracks.length) list.append(el("div", "tvam-empty", "Keine Titel"));
    const prevFocus = mine.onFocus;
    mine.onFocus = async (target) => {
      prevFocus?.(target);
      const index = Array.prototype.indexOf.call(list.children, target);
      if (index < 0 || index < list.children.length - 3) return;
      if (tracks.length < list.children.length + STEP) await fetchMore();
      if (page === mine) render(list.children.length + STEP);
    };
    return { tracks };
  }

  // ---------- Wiedergabe ----------
  let playing = null;   // {list, context} – was zuletzt aus der Oberfläche gestartet wurde (für „Als Nächstes“)
  function play({ context, list, index = 0, shuffle = false, trackUri }) {
    const track = list && Number.isInteger(index) ? list[index] : null;
    call("play", { context, trackUri: trackUri || track?.uri, index: Number.isInteger(index) ? index : undefined })
      .then(() => shuffle && setTimeout(() => setShuffle(true), 1200))
      .catch((e) => TV.toast?.(`Abspielen ging nicht: ${e.message}`));
    playing = list ? { list, context } : null;
    if (page?.kind !== "now") openNow();
  }
  /** Titel aus einer Liste abspielen; ohne Kontext (z. B. Suche) im Album des Titels */
  function playTrack(list, index, context) {
    const t = list[index];
    if (!t) return;
    const ctx = context || t.album;
    if (!ctx) return;
    // Kontext Album/Künstler: Position in der Liste stimmt nicht mit der im Kontext überein → nur über den Titel
    const sameList = context && (context.includes(":playlist:") || context.includes(":collection") || context.includes(":album:"));
    play({ context: ctx, list, index: sameList ? index : null, trackUri: t.uri });
  }
  function setShuffle(on) {
    const b = $("[data-testid=control-button-shuffle]");
    if (b && (b.getAttribute("aria-checked") === "true") !== on) b.click();
  }
  const press = (id) => $(`[data-testid=${id}]`)?.click();

  /** Was läuft gerade? Aus der (unsichtbaren) Anzeige des Web-Players */
  function nowState() {
    const title = $("[data-testid=context-item-link]")?.textContent?.trim();
    if (!title) return null;
    const artists = [...document.querySelectorAll("[data-testid=context-item-info-artist]")].map((a) => a.textContent.trim());
    const small = $("[data-testid=now-playing-widget] img")?.src || "";
    const parse = (t) => (t || "").split(":").reduce((acc, v) => acc * 60 + Number(v || 0), 0);
    const pos = parse($("[data-testid=playback-position]")?.textContent);
    const dur = parse($("[data-testid=playback-duration]")?.textContent);
    return {
      title, artist: [...new Set(artists)].join(", "),
      // größere Fassung desselben Covers (Spotify: ab67616d + Größencode 00004851/000011eb/00001e02 → 0000b273 = 640 px)
      art: small.replace(/ab67616d(00004851|000011eb|00001e02)/, "ab67616d0000b273"),
      playing: $("[data-testid=control-button-playpause]")?.getAttribute("aria-label") === "Pause",
      pos, dur: dur > 1000 ? 0 : dur,
    };
  }

  // ---------- Jetzt läuft ----------
  let nowEls = null;
  function openNow() {
    show("now", (box) => {
      const v = el("div", "tvam-now");
      const bg = el("div", "tvam-now__bg");
      const mainRow = el("div", "tvam-now__main");
      const cover = el("img", "tvam-now__cover");
      const info = el("div", "tvam-now__info");
      const title = el("div", "tvam-now__title"), artist = el("div", "tvam-now__artist");
      const bar = el("div", "tvam-now__bar"), fill = el("div", "tvam-now__fill"), times = el("div", "tvam-now__times");
      bar.append(fill);
      const buttons = el("div", "tvam-now__buttons");
      const btn = (which, testid) => {
        const b = el("button", `tvam-now__btn tvam-now__${which}`);
        b.append(icon(ICONS[which]));
        b.addEventListener("click", () => { press(testid); setTimeout(updateNow, 300); });
        buttons.append(b);
        return b;
      };
      btn("prev", "control-button-skip-back");
      const playB = btn("play", "control-button-playpause");
      btn("next", "control-button-skip-forward");
      info.append(el("div", "tvam-now__label", "Jetzt läuft"), title, artist, bar, times, buttons);
      mainRow.append(cover, info);
      const queueBox = el("div", "tvam-shelf tvam-now__queue");
      queueBox.hidden = true;
      queueBox.append(el("h2", "tvam-shelf__title", "Als Nächstes"));
      const clip = el("div", "tvam-clip");
      const row = el("div", "tvam-row");
      row.dataset.x = "0";
      clip.append(row);
      queueBox.append(clip);
      v.append(bg, mainRow, queueBox);
      box.append(v);
      nowEls = { cover, bg, title, artist, fill, times, playB, row, queueBox, art: "", qkey: "" };
      updateNow();
      page.dispose = () => { nowEls = null; };
      setTimeout(() => TV.focus(playB), 0);
    }, false);
  }

  function updateNow() {
    const s = nowState();
    if (nowPill.hidden === !!s) nowPill.hidden = !s;
    if (s) {
      const img = mini.querySelector(".tvsp-mini__img");
      if (s.art && img.dataset.src !== s.art) { img.dataset.src = s.art; img.src = s.art; }
      mini.querySelector(".tvsp-mini__title").textContent = s.title;
      mini.querySelector(".tvsp-mini__sub").textContent = s.artist;
      const want = s.playing ? "pause" : "play";
      if (mini.dataset.icon !== want) {
        mini.dataset.icon = want;
        mini.lastChild.replaceWith(icon(ICONS[want], "tvsp-mini__icon"));
      }
    }
    const n = nowEls;
    if (!n || !s) return;
    if (s.art && s.art !== n.art) {
      n.art = s.art;
      n.cover.src = s.art;
      n.bg.style.backgroundImage = `url("${s.art}")`;
    }
    n.title.textContent = s.title;
    n.artist.textContent = s.artist;
    n.fill.style.width = s.dur ? `${Math.min(100, (100 * s.pos) / s.dur)}%` : "0";
    n.times.textContent = s.dur ? `${fmt(s.pos)} / ${fmt(s.dur)}` : "";
    const want = s.playing ? "pause" : "play";
    if (n.playB.dataset.icon !== want) {
      n.playB.dataset.icon = want;
      n.playB.replaceChildren(icon(ICONS[want]));
    }
    // Als Nächstes: die folgenden Titel der zuletzt gestarteten Liste
    const list = playing?.list || [];
    const at = list.findIndex((t) => t.title === s.title);
    const upcoming = at >= 0 ? list.slice(at + 1, at + 31) : [];
    const key = upcoming.map((t) => t.uri).join("|");
    if (key !== n.qkey) {
      n.qkey = key;
      const hadFocus = TV.current && n.row.contains(TV.current);
      n.row.replaceChildren(...upcoming.map((t, i) => {
        const b = el("button", "tvam-card tvam-card--queue");
        const img = el("img", "tvam-card__img");
        img.src = pick(t.img, 200);
        img.loading = "lazy";
        b.append(img, el("div", "tvam-card__title", t.title), el("div", "tvam-card__sub", t.artist || ""));
        b.addEventListener("click", () => {
          playTrack(list, at + 1 + i, playing.context);
          setTimeout(() => nowEls && TV.focus(nowEls.playB), 300);
        });
        return b;
      }));
      n.row.dataset.x = "0";
      n.row.style.transform = "";
      n.queueBox.hidden = !upcoming.length;
      if (hadFocus) TV.focus(n.row.firstElementChild || n.playB);
    }
  }

  // ---------- Bewegen, Scrollen, Zurück (wie Apple Music) ----------
  function reveal(target) {
    document.documentElement.classList.toggle("tv-am-noring", !!target.closest(".tvam-pill, .tvam-sub, .tvam-btn, .tvam-track, .tvam-now__btn, .tvam-song, .tvam-search__input, .tvsp-mini"));
    if (target._item && page?.kind === "home") setHero(target._item);
    const row = target.closest(".tvam-row");
    if (row) {
      const clip = row.parentElement.getBoundingClientRect();
      let x = Number(row.dataset.x);
      const left = target.offsetLeft, right = left + target.offsetWidth;
      if (left - x < 0) x = left;
      else if (right - x > clip.width) x = right - clip.width;
      if (x !== Number(row.dataset.x)) {
        row.dataset.x = x;
        row.style.transform = `translateX(${-x}px)`;
      }
    }
    if (scroller && scroller.contains(target) && page?.kind !== "now") {
      const box = pageBox.getBoundingClientRect();
      const anchor = target.closest(".tvsp-short") ? scroller.querySelector(".tvsp-hero") || target
        : target.closest(".tvam-shelf") && !target.closest(".tvam-shelf--songs") ? target.closest(".tvam-shelf") : target;
      const r = anchor.getBoundingClientRect();
      let y = Number(scroller.dataset.y);
      const top = r.top - box.top, bottom = r.bottom - box.top;
      if (top < 16) y += top - 16;
      else if (bottom > box.height - 24) y += bottom - (box.height - 24);
      if (target === scroller.querySelector("button, input") || target.closest(".tvsp-short")) y = 0;
      y = Math.max(0, y);
      if (y !== Number(scroller.dataset.y)) {
        scroller.dataset.y = y;
        scroller.style.transform = `translateY(${-y}px)`;
      }
    }
    page?.onFocus?.(target);
  }

  function move(dir, from) {
    if (dir !== "left" && dir !== "right") return false;
    const row = from.closest(".tvam-row");
    if (!row) return false;
    const next = dir === "right" ? from.nextElementSibling : from.previousElementSibling;
    if (!next) return true;
    reveal(next);
    TV.focus(next);
    return true;
  }

  function moveFirst(dir, from) {
    if (dir === "up" && from.closest(".tvsp-short") && !from.closest(".tvsp-shorts__row")?.previousElementSibling) {
      const target = pillsBox.querySelector(".tvam-pill.is-selected") || pillsBox.querySelector(".tvam-pill");
      return TV.focus(target), true;
    }
    if (dir === "down" && header.contains(from)) {
      const target = tab === "library" && page?.kind !== "now" && !stack.length
        ? subnav.querySelector(".is-selected") : scroller?.querySelector(".tvam-btn--primary, button, input");
      if (target) return TV.focus(target), true;
    }
    if (dir === "down" && subnav.contains(from)) {
      const target = scroller?.querySelector("button, input");
      if (target) return TV.focus(target), true;
      return true;
    }
    if (dir === "up" && subnav.contains(from)) {
      const target = pillsBox.querySelector(".tvam-pill.is-selected") || pillsBox.querySelector(".tvam-pill");
      return TV.focus(target), true;
    }
    if (dir === "up" && pageBox.contains(from)) {
      const top = from.getBoundingClientRect().top;
      const above = [...pageBox.querySelectorAll("button, input")].some((b) => {
        const r = b.getBoundingClientRect();
        return r.height > 0 && r.bottom <= top + 2 && r.bottom > pageBox.getBoundingClientRect().top - 2000;
      });
      if (!above) {
        const target = (root.classList.contains("tvam--lib") && subnav.querySelector(".is-selected")) ||
          pillsBox.querySelector(".tvam-pill.is-selected") || pillsBox.querySelector(".tvam-pill");
        return TV.focus(target), true;
      }
    }
    return false;
  }

  function back() {
    if (page?.kind === "now") {
      if (stack.length) openDetail(stack[stack.length - 1].item);
      else openTab(tab);
      return true;
    }
    if (stack.length) {
      stack.pop();
      if (stack.length) openDetail(stack[stack.length - 1].item);
      else openTab(tab);
      return true;
    }
    if (TV.current && !header.contains(TV.current)) {
      const pill = pillsBox.querySelector(".tvam-pill.is-selected");
      if (pill) { TV.focus(pill); return true; }
    }
    if (tab !== "home") { openTab("home"); return true; }
    TV.home();
    return true;
  }

  // ---------- Start: sobald der Web-Player angemeldet und bereit ist ----------
  let active = false;
  async function start() {
    if (active) return;
    active = true;
    document.documentElement.classList.add("tvam-app", "tvsp-app");
    build();
    Object.assign(TV.site, {
      scope: () => root,
      skip: () => false,
      exclude: "",
      nativeFocus: false,
      scrollFocus: false,
      initial: () => scroller?.querySelector(".tvam-btn--primary, button, input") || pillsBox.querySelector(".is-selected"),
      reveal, move, moveFirst, back,
      playPause: () => (press("control-button-playpause"), setTimeout(updateNow, 300), true),
      inPlayer: () => false,
    });
    gql("profileAttributes", {}).then((d) => {
      const prof = d?.me?.profile || {};
      username = prof.username || "";
      profileBox.querySelector(".tvsp-profile__name").textContent = prof.name ? `Hallo ${prof.name.split(" ")[0]}` : "";
      const av = pick(prof.avatar?.sources, 120);
      if (av) profileBox.querySelector(".tvsp-profile__img").src = av;
      else profileBox.querySelector(".tvsp-profile__img").hidden = true;
    }).catch(() => {});
    setInterval(updateNow, 1000);
    openTab("home");
  }

  // Bis der Web-Player bereit ist: Ladebildschirm statt Spotifys Seite (die wäre sonst kurz zu sehen)
  const boot = el("div", "tvsp-boot");
  boot.append(el("div", "tvsp-boot__mark"), el("div", "tvsp-boot__spin"));
  document.documentElement.classList.add("tvam-app", "tvsp-app");
  document.documentElement.append(boot);
  function giveUp() { // nicht angemeldet o. Ä.: Spotifys Seite zeigen (mit tv.js bedienbar)
    boot.remove();
    document.documentElement.classList.remove("tvam-app", "tvsp-app");
  }
  let tries = 0;
  (function wait() {
    const loggedOut = !!$("[data-testid=login-button]");
    if (loggedOut && ++tries > 5) return giveUp();
    call("ready").then((r) => {
      if (r.ready && r.player && !loggedOut) { boot.remove(); start(); }
      else if (++tries < 60) setTimeout(wait, 1000);
      else giveUp();
    }).catch(() => { if (++tries < 60) setTimeout(wait, 1000); else giveUp(); });
  })();
})();
