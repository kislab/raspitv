// Apple Music: eigene TV-Oberfläche (angemeldet).
//
// Apples Webseite lädt nur noch im Hintergrund (MusicKit spielt die Musik, Daten kommen über dessen
// Schnittstelle – Brücke: applemusic-main.js); gezeichnet wird sie nicht (body: content-visibility hidden).
// Diese Oberfläche ist klein und ruhig – das hält den Pi flüssig. Aussehen wie vorher: Pillen-Leiste
// oben, Reihen mit Karten, Mediathek mit zweiter Reihe, Album-/Playlist-Seiten, Jetzt läuft.
// Gestartet von applemusic-tv.js, sobald MusicKit angemeldet ist; sonst bleibt Apples Seite (einfacher Modus).
(() => {
  if (!window.TV) return;
  const APP = { active: false };
  window.TVAM_APP = APP;

  // ---------- Brücke zu MusicKit (applemusic-main.js) ----------
  let reqId = 0;
  const waiting = new Map();
  let state = null;
  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) return;
    const m = event.data;
    if (m.tvam === "res") {
      const w = waiting.get(m.id);
      if (!w) return;
      waiting.delete(m.id);
      if (m.ok) w.resolve(m.data); else w.reject(new Error(m.error));
    } else if (m.tvam === "state") {
      state = m.state;
      if (APP.active) onState();
    }
  });
  function call(op, args) {
    return new Promise((resolve, reject) => {
      const id = ++reqId;
      waiting.set(id, { resolve, reject });
      window.postMessage({ tvam: "req", id, op, args }, "*");
      setTimeout(() => { if (waiting.delete(id)) reject(new Error("Zeitüberschreitung")); }, 25000);
    });
  }
  APP.call = call;
  let sf = "de";
  const api = (path, params) => call("api", { path: path.replace("{sf}", sf), params });

  // ---------- Hilfen ----------
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
  };
  /** Bild-URL aus Apples Vorlage ({w}x{h}{c}.{f}) */
  function artUrl(artwork, w, h = w) {
    const u = artwork?.url;
    return u ? u.replace("{w}", w).replace("{h}", h).replace("{c}", w === h ? "bb" : "sr").replace("{f}", "jpg") : "";
  }
  const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
  const text = (v) => (typeof v === "string" ? v : v?.stringForDisplay || v?.short || "");

  /** Apple-Ressource → Karte {id, type, title, sub, art, wide, eyebrow, headline} */
  function toItem(r) {
    if (!r) return null;
    if (r.type === "editorial-elements") {
      const inner = r.relationships?.contents?.data?.[0] || r.relationships?.children?.data?.[0];
      const it = inner && inner.type !== "editorial-elements" ? toItem(inner) : null;
      if (!it) return null;
      const a = r.attributes || {};
      it.eyebrow = text(a.designBadge) || text(a.designTag) || "";
      it.headline = text(a.name) || text(a.title) || "";
      it.wide = a.editorialArtwork?.subscriptionHero || a.editorialArtwork?.superHeroWide || a.editorialArtwork?.storeFlowcase ||
        inner.attributes?.editorialArtwork?.subscriptionHero || inner.attributes?.editorialArtwork?.superHeroWide || it.wide;
      return it;
    }
    const a = r.attributes || {};
    const title = text(a.name) || text(a.title);
    if (!title) return null;
    return {
      id: r.id, type: r.type, title,
      sub: a.artistName || a.curatorName || (r.type.includes("playlist") ? text(a.description) : "") || "",
      art: a.artwork, wide: a.editorialArtwork?.subscriptionHero || a.editorialArtwork?.superHeroWide,
      duration: (a.durationInMillis || 0) / 1000, artist: a.artistName || "", album: a.albumName || "",
    };
  }
  const isSong = (it) => it && (it.type === "songs" || it.type === "library-songs" || it.type === "music-videos");

  // ---------- Grundgerüst ----------
  let root, header, pillsBox, subnav, pageBox, scroller, nowPill;
  const PILLS = [["search", "Suchen"], ["home", "Startseite"], ["new", "Neu"], ["radio", "Radio"], ["library", "Mediathek"]];
  const LIBRARY = [["recent", "Zuletzt hinzugefügt"], ["playlists", "Playlists"], ["artists", "Künstler"],
    ["albums", "Alben"], ["songs", "Titel"]];
  let tab = "home", libTab = "recent";
  let stack = [];        // geöffnete Unterseiten (Album, Playlist, Künstler …): [{kind, item, focusKey}]
  let page = null;       // aktuelle Seite: {kind, el, onFocus?, dispose?}

  function build() {
    root = el("div", "tvam");
    header = el("div", "tvam-header");
    const logo = el("div", "tvam-logo");
    const appleLogo = document.querySelector(".navigation .logo svg");
    if (appleLogo) logo.append(appleLogo.cloneNode(true)); else logo.textContent = "Music";
    pillsBox = el("div", "tvam-pills");
    for (const [key, label] of PILLS) {
      const b = el("button", "tvam-pill");
      b.dataset.tab = key;
      if (key === "search") b.append(icon(ICONS.search, "tvam-pill__icon"));
      b.append(document.createTextNode(label));
      b.addEventListener("click", () => openTab(key));
      pillsBox.append(b);
    }
    nowPill = el("button", "tvam-pill tvam-pill--now");
    nowPill.append(el("span", "tvam-dot"), document.createTextNode("Jetzt läuft"));
    nowPill.addEventListener("click", () => openNow());
    nowPill.hidden = true;
    pillsBox.append(nowPill);
    const right = el("div", "tvam-right");
    header.append(logo, pillsBox, right);
    subnav = el("div", "tvam-subnav");
    for (const [key, label] of LIBRARY) {
      const b = el("button", "tvam-sub", label);
      b.dataset.lib = key;
      b.addEventListener("click", () => { libTab = key; openTab("library"); });
      subnav.append(b);
    }
    pageBox = el("div", "tvam-page");
    root.append(header, subnav, pageBox);
    document.documentElement.append(root);
  }

  function markPills() {
    const showing = stack.length ? null : page?.kind;
    for (const b of pillsBox.querySelectorAll(".tvam-pill[data-tab]")) b.classList.toggle("is-selected", b.dataset.tab === tab && showing !== "now");
    nowPill.classList.toggle("is-selected", page?.kind === "now");
    for (const b of subnav.querySelectorAll(".tvam-sub")) b.classList.toggle("is-selected", b.dataset.lib === libTab);
    root.classList.toggle("tvam--lib", tab === "library" && page?.kind !== "now");
  }

  /** Neue Seite zeigen. build(scroller) füllt sie (darf async sein). */
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
        focusFirstIn(scroller);
      }
    });
    return mine;
  }

  function focusFirstIn(box) {
    const target = box.querySelector(".tvam-btn--primary, button");
    if (target) TV.focus(target);
  }

  function openTab(key) {
    tab = key;
    stack = [];
    const fromHeader = TV.current && (header.contains(TV.current) || subnav.contains(TV.current));
    const pages = { home: homePage, new: () => editorialPage("music"), radio: () => editorialPage("radio"), library: libraryPage, search: searchPage };
    show(key, pages[key], !fromHeader); // über die Leiste gewechselt: Fokus bleibt in der Leiste
  }

  // ---------- Collage für Playlists ohne Cover ----------
  // Selbst erstellte Playlists haben bei Apple oft kein Cover; Apple zeigt dann 2×2 Cover der ersten Titel.
  // Nachgebaut: erste Titel holen (nacheinander, nicht alle Playlists gleichzeitig), Ergebnis merken.
  const mosaics = new Map();   // Playlist-ID -> Promise<[Bild-Vorlagen]>
  let mosaicChain = Promise.resolve();
  function mosaicFor(it) {
    if (!mosaics.has(it.id)) {
      const path = it.type === "library-playlists" ? `/v1/me/library/playlists/${it.id}/tracks` : `/v1/catalog/{sf}/playlists/${it.id}/tracks`;
      const job = mosaicChain.then(() => api(path, { limit: 20 })).then((data) => {
        const seen = new Set(), arts = [];
        for (const t of data.data || []) {
          const art = t.attributes?.artwork;
          const key = t.attributes?.albumName || art?.url;
          if (!art?.url || seen.has(key)) continue;
          seen.add(key);
          arts.push(art);
          if (arts.length === 4) break;
        }
        return arts;
      }).catch(() => []);
      mosaicChain = job.then(() => {}, () => {});
      mosaics.set(it.id, job);
    }
    return mosaics.get(it.id);
  }
  /** Leeres Cover-Bild durch Collage (4 Cover) bzw. das erste Song-Cover ersetzen */
  function fillMissingArt(img, it, size) {
    if (!it.type?.includes("playlist")) return;
    mosaicFor(it).then((arts) => {
      if (!arts.length || !img.isConnected) return;
      if (arts.length < 4) {
        img.src = artUrl(arts[0], size);
        img.classList.remove("is-empty");
        return;
      }
      const box = el("div", `${img.className} tvam-mosaic`);
      box.classList.remove("is-empty");
      for (const art of arts) {
        const part = el("img");
        part.decoding = "async";
        part.src = artUrl(art, Math.round(size / 2));
        box.append(part);
      }
      img.replaceWith(box);
    });
  }

  // ---------- Reihen und Karten ----------
  function card(it, kind) {
    const b = el("button", `tvam-card tvam-card--${kind}`);
    b._item = it;
    if (kind === "wide") {
      if (it.eyebrow) b.append(el("div", "tvam-card__eyebrow", it.eyebrow));
      b.append(el("div", "tvam-card__headline", it.headline || it.title));
      if (it.headline && it.title !== it.headline) b.append(el("div", "tvam-card__sub", it.title));
    }
    const img = el("img", "tvam-card__img");
    img.loading = "lazy";
    img.decoding = "async";
    const url = kind === "wide" ? artUrl(it.wide || it.art, 640, 360) : artUrl(it.art, 300);
    if (url) img.src = url; else { img.classList.add("is-empty"); fillMissingArt(img, it, 300); }
    b.append(img);
    if (kind !== "wide") {
      b.append(el("div", "tvam-card__title", it.title));
      if (it.sub) b.append(el("div", "tvam-card__sub", it.sub));
    }
    b.addEventListener("click", () => activate(it, b));
    return b;
  }

  function songTile(it, list, index) {
    const b = el("button", "tvam-song");
    const img = el("img", "tvam-song__img");
    img.loading = "lazy";
    img.decoding = "async";
    const url = artUrl(it.art, 120);
    if (url) img.src = url;
    const t = el("div", "tvam-song__text");
    t.append(el("div", "tvam-song__title", it.title), el("div", "tvam-song__sub", it.artist || it.sub));
    b.append(img, t);
    b.addEventListener("click", () => playSongs(list, index));
    return b;
  }

  /** Reihe mit Überschrift; layout: cards | wide | songs */
  function shelf(box, title, items, layout = "cards") {
    items = items.filter(Boolean);
    if (!items.length) return null;
    const s = el("section", `tvam-shelf tvam-shelf--${layout}`);
    if (title) s.append(el("h2", "tvam-shelf__title", title));
    const clip = el("div", "tvam-clip");
    const row = el("div", "tvam-row");
    row.dataset.x = "0";
    if (layout === "songs") items.forEach((it, i) => row.append(songTile(it, items, i)));
    else items.forEach((it) => row.append(card(it, layout)));
    clip.append(row);
    s.append(clip);
    box.append(s);
    return s;
  }

  function shelfFromElement(box, element) {
    const a = element.attributes || {};
    const kids = element.relationships?.contents?.data || element.relationships?.children?.data || [];
    const items = kids.map(toItem).filter(Boolean);
    if (!items.length) return;
    const title = text(a.name) || text(a.title);
    const layout = items.every(isSong) ? "songs" : items.some((it) => it.eyebrow || it.headline) && items.every((it) => it.wide) ? "wide" : "cards";
    shelf(box, title, items, layout);
  }

  // ---------- Seiten ----------
  async function homePage(box, mine) {
    const [recent, recs] = await Promise.all([
      api("/v1/me/recent/played", { limit: 20 }).catch(() => null),
      api("/v1/me/recommendations", { limit: 12 }).catch(() => null),
    ]);
    if (page !== mine) return;
    if (recent?.data?.length) shelf(box, "Zuletzt gespielt", recent.data.map(toItem));
    for (const rec of recs?.data || []) {
      const items = (rec.relationships?.contents?.data || []).map(toItem);
      shelf(box, text(rec.attributes?.title) || "Für dich", items);
    }
  }

  async function editorialPage(name, box, mine) {
    box = box || scroller;
    mine = mine || page;
    const data = await api("/v1/editorial/{sf}/groupings", {
      platform: "web", name, l: "de-DE", "art[url]": "f", extend: "editorialArtwork,artistUrl",
      "omit[resource:artists]": "relationships", "include[albums]": "artists", "fields[artists]": "name,url",
    });
    if (page !== mine) return;
    const g = data.data?.[0];
    const kids = g?.relationships?.tabs?.data?.[0]?.relationships?.children?.data || g?.relationships?.children?.data || [];
    for (const element of kids) shelfFromElement(box, element);
  }

  // Mediathek: Raster mit Nachladen bzw. Titel-Liste
  const LIB_PATHS = {
    recent: "/v1/me/library/recently-added", playlists: "/v1/me/library/playlists",
    artists: "/v1/me/library/artists", albums: "/v1/me/library/albums", songs: "/v1/me/library/songs",
  };
  async function libraryPage(box, mine) {
    const path = LIB_PATHS[libTab];
    if (libTab === "songs") return void (await trackList(box, mine, { path, params: { limit: 100 } }));
    const grid = el("div", "tvam-grid");
    box.append(grid);
    let next = path, params = { limit: libTab === "recent" ? 25 : 60 }, busy = false;
    async function more() {
      if (busy || !next) return;
      busy = true;
      try {
        const data = await api(next, params);
        if (page !== mine) return;
        params = undefined; // „next“ enthält schon alle Angaben
        next = data.next || null;
        for (const it of (data.data || []).map(toItem).filter(Boolean)) grid.append(card(it, "grid"));
      } finally { busy = false; }
    }
    mine.onFocus = (target) => {
      const cards = grid.children;
      const index = Array.prototype.indexOf.call(cards, target);
      if (index >= 0 && index >= cards.length - 12) more();
    };
    await more();
    if (!grid.children.length) box.append(el("div", "tvam-empty", "Hier ist noch nichts."));
  }

  // Suche: Textfeld (OK = Bildschirmtastatur, oder vom Handy tippen) und Ergebnisse
  let lastTerm = "";
  function searchPage(box, mine) {
    const field = el("div", "tvam-search");
    const input = el("input", "tvam-search__input");
    input.type = "search";
    input.placeholder = "Künstler:innen, Titel, Alben …";
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
      const data = await api("/v1/catalog/{sf}/search", { term, types: "songs,albums,artists,playlists,stations", limit: 15 }).catch(() => null);
      if (page !== mine || input.value.trim() !== term) return;
      const r = data?.results || {};
      shelf(results, "Titel", (r.songs?.data || []).map(toItem), "songs");
      shelf(results, "Alben", (r.albums?.data || []).map(toItem));
      shelf(results, "Künstler:innen", (r.artists?.data || []).map(toItem));
      shelf(results, "Playlists", (r.playlists?.data || []).map(toItem));
      shelf(results, "Sender", (r.stations?.data || []).map(toItem));
      if (!results.children.length) results.append(el("div", "tvam-empty", `Keine Treffer für „${term}“`));
    };
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 700); });
    input.addEventListener("change", () => { clearTimeout(timer); run(); });
    if (lastTerm) run();
    // erstes Element: das Suchfeld
    setTimeout(() => { if (page === mine && !(TV.current && header.contains(TV.current))) TV.focus(input); }, 0);
  }

  // ---------- Album, Playlist, Künstler ----------
  function activate(it, from) {
    if (!it) return;
    const t = it.type;
    if (t === "stations") return play({ station: it.id });
    if (isSong(it)) return play({ song: it.id });
    if (t === "albums" || t === "library-albums" || t === "playlists" || t === "library-playlists" || t === "artists" || t === "library-artists") {
      stack.push({ item: it, focusKey: null });
      return openDetail(it);
    }
    // unbekannte Art: wenn abspielbar, abspielen
    if (it.id) play({ [t.replace(/^library-/, "").replace(/s$/, "")]: it.id });
  }

  function openDetail(it) {
    const kind = it.type.replace(/^library-/, "");
    if (kind === "artists") return show("artist", (box, mine) => artistPage(it, box, mine));
    show("detail", (box, mine) => containerPage(it, box, mine));
  }

  async function containerPage(it, box, mine) {
    const lib = it.type.startsWith("library-");
    const kind = it.type.replace(/^library-/, "");   // albums | playlists
    const base = lib ? `/v1/me/library/${kind}/${it.id}` : `/v1/catalog/{sf}/${kind}/${it.id}`;
    const data = await api(base, lib ? {} : { include: "tracks" });
    if (page !== mine) return;
    const res = data.data?.[0] || {};
    const a = res.attributes || {};
    const head = el("div", "tvam-detail");
    const img = el("img", "tvam-detail__art");
    const url = artUrl(a.artwork || it.art, 400);
    if (url) img.src = url; else { img.classList.add("is-empty"); fillMissingArt(img, it, 400); }
    const info = el("div", "tvam-detail__info");
    info.append(el("div", "tvam-detail__title", text(a.name) || it.title));
    const by = a.artistName || a.curatorName || it.sub;
    if (by) info.append(el("div", "tvam-detail__by", by));
    const meta = [a.genreNames?.[0], a.releaseDate?.slice(0, 4), a.trackCount ? `${a.trackCount} Titel` : ""].filter(Boolean).join(" · ");
    if (meta) info.append(el("div", "tvam-detail__meta", meta));
    const note = text(a.editorialNotes?.short) || text(a.description);
    if (note) info.append(el("div", "tvam-detail__note", note));
    const buttons = el("div", "tvam-detail__buttons");
    // Abgespielt werden die geladenen Titel als Song-Warteschlange: {playlist: id} lädt bei großen
    // Mediathek-Playlists erst alle (Tausende) Einträge – auf dem Pi dauert das ewig.
    let list = null;
    const playBtn = el("button", "tvam-btn tvam-btn--primary");
    playBtn.append(icon(ICONS.play), document.createTextNode("Wiedergabe"));
    playBtn.addEventListener("click", () => list && playSongs(list.tracks, 0));
    const shuffleBtn = el("button", "tvam-btn");
    shuffleBtn.append(icon(ICONS.shuffle), document.createTextNode("Zufällig"));
    shuffleBtn.addEventListener("click", () => list && playSongs(list.tracks, 0, true));
    buttons.append(playBtn, shuffleBtn);
    info.append(buttons);
    head.append(img, info);
    box.append(head);
    const tracksPath = `${base}/tracks`;
    const first = !lib ? res.relationships?.tracks : null;
    list = await trackList(box, mine, { path: tracksPath, params: { limit: 100 }, first, album: kind === "albums" });
  }

  async function artistPage(it, box, mine) {
    if (it.type === "library-artists") {
      const data = await api(`/v1/me/library/artists/${it.id}/albums`, { limit: 100 });
      if (page !== mine) return;
      box.append(el("h1", "tvam-page__title", it.title));
      const grid = el("div", "tvam-grid");
      for (const a of (data.data || []).map(toItem).filter(Boolean)) grid.append(card(a, "grid"));
      box.append(grid);
      return;
    }
    const data = await api(`/v1/catalog/{sf}/artists/${it.id}`, { views: "top-songs,full-albums,singles,playlists,similar-artists", extend: "editorialArtwork" });
    if (page !== mine) return;
    const res = data.data?.[0];
    box.append(el("h1", "tvam-page__title", text(res?.attributes?.name) || it.title));
    const views = res?.views || {};
    shelf(box, "Top-Titel", (views["top-songs"]?.data || []).map(toItem), "songs");
    shelf(box, "Alben", (views["full-albums"]?.data || []).map(toItem));
    shelf(box, "Singles & EPs", (views.singles?.data || []).map(toItem));
    shelf(box, "Playlists", (views.playlists?.data || []).map(toItem));
    shelf(box, "Ähnliche Künstler:innen", (views["similar-artists"]?.data || []).map(toItem));
  }

  // Titel-Liste: zeigt 8 Zeilen, beim Herunterblättern kurz vor dem Ende die nächsten 8 (lädt bei Bedarf nach)
  const STEP = 8;
  async function trackList(box, mine, { path, params, first, album }) {
    const list = el("div", "tvam-tracks");
    box.append(list);
    const tracks = [];
    let next = path, nextParams = params, busy = false;
    if (first?.data) {
      tracks.push(...first.data.map(toItem).filter(Boolean));
      next = first.next || null;
      nextParams = undefined;
    }
    async function load() {
      if (busy || !next) return;
      busy = true;
      try {
        const data = await api(next, nextParams);
        nextParams = undefined;
        next = data.next || null;
        tracks.push(...(data.data || []).map(toItem).filter(Boolean));
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
          const url = artUrl(t.art, 100);
          if (url) img.src = url;
          row.append(img);
        }
        const txt = el("span", "tvam-track__text");
        txt.append(el("span", "tvam-track__title", t.title));
        if (!album || (t.artist && t.artist !== tracks[0]?.artist)) txt.append(el("span", "tvam-track__sub", t.artist));
        row.append(txt, el("span", "tvam-track__time", t.duration ? fmt(t.duration) : ""));
        row.addEventListener("click", () => playSongs(tracks, i));
        list.append(row);
      }
    }
    if (!tracks.length) await load();
    if (page !== mine) return { tracks };
    render(STEP);
    if (!tracks.length) list.append(el("div", "tvam-empty", "Keine Titel"));
    const prevFocus = mine.onFocus;
    mine.onFocus = async (target) => {
      prevFocus?.(target);
      const index = Array.prototype.indexOf.call(list.children, target);
      if (index < 0 || index < list.children.length - 3) return;
      if (tracks.length < list.children.length + STEP && next) await load();
      if (page === mine) render(list.children.length + STEP);
    };
    return { tracks };
  }

  // ---------- Wiedergabe ----------
  /** Abspielen und gleich „Jetzt läuft“ zeigen (Zurück führt wieder zur vorigen Seite) */
  function play(queue, startWith = 0, shuffle = false) {
    call("play", { queue, startWith, shuffle }).catch((e) => TV.toast?.(`Abspielen ging nicht: ${e.message}`));
    if (page?.kind !== "now") openNow();
  }
  /** Titel-Liste ab index abspielen (höchstens 200 Titel ab dort, damit es schnell startet) */
  function playSongs(list, index, shuffle = false) {
    const songs = list.filter(isSong);
    const start = Math.max(0, songs.indexOf(list[index]));
    const from = Math.max(0, start - 50);
    const ids = songs.slice(from, from + 200).map((s) => s.id);
    play({ songs: ids }, start - from, shuffle);
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
      const title = el("div", "tvam-now__title"), artist = el("div", "tvam-now__artist"), albumEl = el("div", "tvam-now__album");
      const bar = el("div", "tvam-now__bar"), fill = el("div", "tvam-now__fill"), times = el("div", "tvam-now__times");
      bar.append(fill);
      const buttons = el("div", "tvam-now__buttons");
      const btn = (which, action) => {
        const b = el("button", `tvam-now__btn tvam-now__${which}`);
        b.append(icon(ICONS[which]));
        b.addEventListener("click", () => call("control", { action }).catch(() => {}));
        buttons.append(b);
        return b;
      };
      btn("prev", "prev");
      const playB = btn("play", "toggle");
      btn("next", "next");
      info.append(el("div", "tvam-now__label", "Jetzt läuft"), title, artist, albumEl, bar, times, buttons);
      mainRow.append(cover, info);
      const queueBox = el("div", "tvam-shelf tvam-now__queue");
      queueBox.hidden = true; // erst zeigen, wenn die Warteschlange Titel hat
      queueBox.append(el("h2", "tvam-shelf__title", "Als Nächstes"));
      const clip = el("div", "tvam-clip");
      const row = el("div", "tvam-row");
      row.dataset.x = "0";
      clip.append(row);
      queueBox.append(clip);
      v.append(bg, mainRow, queueBox);
      box.append(v);
      nowEls = { cover, bg, title, artist, albumEl, fill, times, playB, row, queueBox, art: "", qkey: "" };
      updateNow();
      refreshQueue();
      const timer = setInterval(refreshQueue, 3000);
      page.dispose = () => { clearInterval(timer); nowEls = null; };
      setTimeout(() => TV.focus(playB), 0);
    }, false);
  }

  function updateNow() {
    const n = nowEls;
    const s = state;
    if (!n || !s?.item) return;
    if (s.item.art !== n.art) {
      n.art = s.item.art;
      n.cover.src = s.item.art;
      n.bg.style.backgroundImage = `url("${s.item.art}")`;
    }
    n.title.textContent = s.item.title;
    n.artist.textContent = s.item.artist;
    n.albumEl.textContent = s.item.album;
    n.fill.style.width = s.dur ? `${Math.min(100, (100 * s.pos) / s.dur)}%` : "0";
    n.times.textContent = s.dur ? `${fmt(s.pos)} / ${fmt(s.dur)}` : "";
    const want = s.playing ? "pause" : "play";
    if (n.playB.dataset.icon !== want) {
      n.playB.dataset.icon = want;
      n.playB.replaceChildren(icon(ICONS[want]));
    }
  }

  async function refreshQueue() {
    const n = nowEls;
    if (!n) return;
    const q = await call("queue").catch(() => null);
    if (!q || nowEls !== n) return;
    const key = q.items.map((i) => `${i.index}:${i.title}`).join("|");
    if (key === n.qkey) return;
    n.qkey = key;
    const hadFocus = TV.current && n.row.contains(TV.current);
    n.row.replaceChildren(...q.items.map((it) => {
      const b = el("button", "tvam-card tvam-card--queue");
      const img = el("img", "tvam-card__img");
      img.src = it.art;
      img.loading = "lazy";
      b.append(img, el("div", "tvam-card__title", it.title), el("div", "tvam-card__sub", it.artist));
      b.addEventListener("click", () => {
        call("control", { action: "jump", value: it.index }).catch(() => {});
        setTimeout(() => nowEls && TV.focus(nowEls.playB), 300);
      });
      return b;
    }));
    n.row.dataset.x = "0";
    n.row.style.transform = "";
    n.queueBox.hidden = !q.items.length;
    if (hadFocus) TV.focus(n.row.firstElementChild || n.playB);
  }

  function onState() {
    const has = !!state?.item;
    if (nowPill.hidden === has) nowPill.hidden = !has;
    updateNow();
  }

  // ---------- Bewegen, Scrollen, Zurück ----------
  /** Gewähltes Element sichtbar halten: Reihe seitlich verschieben, Seite senkrecht (per transform, kein Scrollen) */
  function reveal(target) {
    document.documentElement.classList.toggle("tv-am-noring", !!target.closest(".tvam-pill, .tvam-sub, .tvam-btn, .tvam-track, .tvam-now__btn, .tvam-song, .tvam-search__input"));
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
      const anchor = target.closest(".tvam-shelf") && !target.closest(".tvam-shelf--songs") ? target.closest(".tvam-shelf") : target;
      const r = anchor.getBoundingClientRect();
      let y = Number(scroller.dataset.y);
      const top = r.top - box.top, bottom = r.bottom - box.top;
      if (top < 16) y += top - 16;
      else if (bottom > box.height - 24) y += bottom - (box.height - 24);
      if (target === scroller.querySelector("button, input")) y = 0;
      y = Math.max(0, y);
      if (y !== Number(scroller.dataset.y)) {
        scroller.dataset.y = y;
        scroller.style.transform = `translateY(${-y}px)`;
      }
    }
    page?.onFocus?.(target);
  }

  /** Rand einer Reihe: nächste Karte (liegt evtl. noch rechts außerhalb des Bildes) */
  function move(dir, from) {
    if (dir !== "left" && dir !== "right") return false;
    const row = from.closest(".tvam-row");
    if (!row) return false;
    const next = dir === "right" ? from.nextElementSibling : from.previousElementSibling;
    if (!next) return true; // Ende der Reihe: stehen bleiben
    reveal(next);
    TV.focus(next);
    return true;
  }

  // ▼ aus der Leiste: in die Mediathek-Reihe bzw. auf den Inhalt; ▲ aus dem Inhalt oben: in die Leiste
  function moveFirst(dir, from) {
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
    // ▲ aus der obersten Inhaltsreihe: auf die gewählte Pille (bzw. den gewählten Mediathek-Bereich), nicht
    // auf die zufällig darüberliegende
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

  // ---------- Start ----------
  APP.start = async (info) => {
    if (APP.active) return;
    APP.active = true;
    sf = info?.storefront || "de";
    document.documentElement.classList.add("tvam-app");
    build();
    Object.assign(TV.site, {
      scope: () => root,
      skip: () => false,
      exclude: "",
      nativeFocus: false,
      scrollFocus: false,
      initial: () => scroller?.querySelector(".tvam-btn--primary, button, input") || pillsBox.querySelector(".is-selected"),
      reveal,
      move,
      moveFirst,
      back,
      playPause: () => (call("control", { action: "toggle" }).catch(() => {}), true),
      inPlayer: () => false,
    });
    state = await call("state").catch(() => state);
    onState();
    openTab("home");
  };
})();
