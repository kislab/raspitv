// Baukasten für eigene TV-Oberflächen von Mediatheken (ARD, ZDF, …): Leiste oben, großer Bereich mit dem
// gewählten Titel, Reihen mit Karten, Detailseite, Suche und ein eigener Player (MP4 direkt, HLS über hls.js).
//
// Jede Mediathek liefert nur einen „Adapter“ (z. B. ard-app.js) und ruft MediaApp.start(adapter) auf:
//   name, logo (SVG-Text oder Name), accent (Farbe)
//   tabs: [{key, label, icon}]               Bereiche oben; icon: Schlüssel aus ICONS
//   load(tab) → {sections}                     Inhalte eines Bereichs
//   search(term) → {sections}
//   open(item) → {title, sub, meta[], desc, img, play?: item, sections}   Detailseite
//   stream(item) → {url, type: "mp4"|"hls", live?, subtitles?}            zum Abspielen
// Abschnitt: {title, layout: "wide"|"poster"|"live", items, more?: async () => items}
// Eintrag:   {id, kind: "video"|"live"|"show"|"page", title, sub, meta, img, poster, duration, desc, play?}
//            play: true → OK spielt sofort ab, sonst öffnet OK die Detailseite
// Gesehene Videos merkt sich der Baukasten selbst (Weiterschauen, Position) im localStorage.
(() => {
  if (!window.TV) return;

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
    home: "M12 3 2.5 11.2V21h7v-6h5v6h7v-9.8z",
    live: "M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM6.3 6.3l1.4 1.4a6 6 0 0 0 0 8.6l-1.4 1.4a8 8 0 0 1 0-11.4zm11.4 0a8 8 0 0 1 0 11.4l-1.4-1.4a6 6 0 0 0 0-8.6zM3.5 3.5l1.4 1.4a10 10 0 0 0 0 14.2l-1.4 1.4a12 12 0 0 1 0-17zm17 0a12 12 0 0 1 0 17l-1.4-1.4a10 10 0 0 0 0-14.2z",
    movie: "M4 4h16v16H4zM6 6v2h2V6zm10 0v2h2V6zM6 11v2h2v-2zm10 0v2h2v-2zM6 16v2h2v-2zm10 0v2h2v-2z",
    series: "M3 5h18v12H3zM8 19h8v2H8z",
    doc: "M5 3h10l4 4v14H5zM8 11h8v2H8zm0 4h8v2H8z",
    grid: "M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z",
    search: "M10 3a7 7 0 0 1 5.6 11.2l4.6 4.6-1.4 1.4-4.6-4.6A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z",
    play: "M7 4.5v15L19.5 12z",
    pause: "M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z",
    restart: "M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z",
    sport: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2.2 2.6 1.9-1 3.1h-3.2l-1-3.1zM5 8.6l2.5.2 1 3-2.6 1.9-1.9-1.4A8 8 0 0 1 5 8.6zm14 0a8 8 0 0 1 1 3.7l-1.9 1.4-2.6-1.9 1-3zM9.4 14h5.2l1.4 2.5-1.4 2.9a8 8 0 0 1-5.2 0L8 16.5z",
    kids: "M12 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM6 22v-5a6 6 0 0 1 12 0v5z",
  };
  const clock = (sec) => {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  };
  const minutes = (sec) => (sec ? (sec >= 3600 ? `${Math.floor(sec / 3600)} Std. ${Math.round((sec % 3600) / 60)} Min.` : `${Math.max(1, Math.round(sec / 60))} Min.`) : "");
  function img(src, cls) {
    const i = el("img", cls);
    i.loading = "lazy";
    i.decoding = "async";
    if (src) i.src = src; else i.classList.add("is-empty");
    return i;
  }

  let A = null;           // Adapter
  let store = null;       // Schlüssel-Präfix im localStorage
  // ---------- Gesehenes (Weiterschauen) ----------
  function history() {
    try { return JSON.parse(localStorage.getItem(`${store}:history`) || "[]"); } catch (e) { return []; }
  }
  function remember(item, position, duration) {
    if (!item || item.kind === "live" || !item.id) return;
    let list = history().filter((h) => h.item.id !== item.id);
    const done = duration && position > duration - 60;
    if (!done && position > 20) list.unshift({ item: { ...item, play: true }, position, duration, at: Date.now() });
    list = list.slice(0, 30);
    try { localStorage.setItem(`${store}:history`, JSON.stringify(list)); } catch (e) { /* voll */ }
  }
  const progressOf = (item) => {
    const h = history().find((x) => x.item.id === item.id);
    return h && h.duration ? h.position / h.duration : null;
  };
  const positionOf = (item) => history().find((x) => x.item.id === item.id)?.position || 0;

  // ---------- Grundgerüst ----------
  let root, header, pillsBox, pageBox, scroller, bg;
  let tab = null, page = null, stack = [];
  let heroEls = null;

  function build() {
    root = el("div", "tvm");
    root.style.setProperty("--accent", A.accent || "#2b6fd6");
    bg = el("div", "tvm-bg");
    header = el("div", "tvm-header");
    const logo = el("div", "tvm-logo");
    if (/^<svg/.test(A.logo || "")) logo.innerHTML = A.logo; else logo.textContent = A.logo || A.name;
    pillsBox = el("div", "tvm-pills");
    for (const t of A.tabs) {
      const b = el("button", "tvm-pill");
      b.dataset.tab = t.key;
      b.append(icon(ICONS[t.icon] || ICONS.grid, "tvm-pill__icon"), document.createTextNode(t.label));
      b.addEventListener("click", () => openTab(t.key));
      pillsBox.append(b);
    }
    header.append(logo, pillsBox, el("div", "tvm-right"));
    pageBox = el("div", "tvm-page");
    root.append(bg, header, pageBox);
    document.body.append(root);
  }

  function markPills() {
    for (const b of pillsBox.querySelectorAll(".tvm-pill")) b.classList.toggle("is-selected", b.dataset.tab === tab);
  }

  function show(kind, buildFn) {
    if (page) page.heroEls = heroEls; // für Zurück: großer Bereich der vorherigen Seite
    page?.dispose?.();
    pageBox.replaceChildren();
    scroller = el("div", "tvm-scroll");
    scroller.dataset.y = "0";
    pageBox.append(scroller);
    page = { kind, el: scroller };
    heroEls = null;
    root.classList.toggle("tvm--detail", kind === "detail");
    markPills();
    const mine = page;
    const loading = el("div", "tvm-loading");
    loading.append(el("div", "tvm-spinner"));
    pageBox.append(loading);
    Promise.resolve(buildFn(scroller, mine)).catch((error) => {
      if (page !== mine) return;
      scroller.append(el("div", "tvm-error", `Konnte nicht geladen werden (${error.message})`));
    }).finally(() => {
      loading.remove();
      if (page !== mine) return;
      if (!(TV.current && root.contains(TV.current) && !header.contains(TV.current) && TV.current.isConnected)) {
        const target = scroller.querySelector(".tvm-btn--primary, button, input");
        if (target) { reveal(target); TV.focus(target); }
      }
    });
    return mine;
  }

  function openTab(key) {
    tab = key;
    stack = [];
    show("tab", (box, mine) => tabPage(key, box, mine));
  }

  // ---------- Karten und Reihen ----------
  function card(it, layout) {
    const b = el("button", `tvm-card tvm-card--${layout}`);
    b._item = it;
    const pic = el("div", "tvm-card__pic");
    pic.append(img(layout === "poster" ? it.poster || it.img : it.img, "tvm-card__img"));
    if (it.kind === "live") pic.append(el("span", "tvm-badge tvm-badge--live", "LIVE"));
    else if (it.duration) pic.append(el("span", "tvm-badge tvm-badge--time", minutes(it.duration)));
    const p = progressOf(it);
    if (p) {
      const bar = el("div", "tvm-card__bar");
      const fill = el("div");
      fill.style.width = `${Math.min(100, p * 100)}%`;
      bar.append(fill);
      pic.append(bar);
    }
    b.append(pic);
    if (layout !== "poster") {
      b.append(el("div", "tvm-card__title", it.title));
      if (it.sub) b.append(el("div", "tvm-card__sub", it.sub));
    }
    b.addEventListener("click", () => activate(it));
    return b;
  }

  function shelf(box, sec) {
    const items = (sec.items || []).filter(Boolean);
    if (!items.length) return null;
    const layout = sec.layout || "wide";
    const s = el("section", `tvm-shelf tvm-shelf--${layout}`);
    if (sec.title) s.append(el("h2", "tvm-shelf__title", sec.title));
    const clip = el("div", "tvm-clip");
    const row = el("div", "tvm-row");
    row.dataset.x = "0";
    for (const it of items) row.append(card(it, layout));
    clip.append(row);
    s.append(clip);
    box.append(s);
    if (sec.more) {
      let busy = false, done = false;
      row._more = async () => {
        if (busy || done) return;
        busy = true;
        const next = await sec.more().catch(() => []);
        busy = false;
        if (!next || !next.length) { done = true; return; }
        for (const it of next) row.append(card(it, layout));
      };
    }
    return s;
  }

  function grid(box, sec) {
    const layout = sec.layout || "wide";
    const g = el("div", `tvm-grid tvm-grid--${layout}`);
    for (const it of (sec.items || []).filter(Boolean)) g.append(card(it, layout));
    if (sec.title) box.append(el("h2", "tvm-shelf__title", sec.title));
    box.append(g);
    return g;
  }

  // großer Bereich oben: folgt dem gewählten Eintrag
  function hero(box) {
    const h = el("div", "tvm-hero");
    const title = el("div", "tvm-hero__title");
    const meta = el("div", "tvm-hero__meta");
    const desc = el("div", "tvm-hero__desc");
    h.append(title, meta, desc);
    box.append(h);
    heroEls = { title, meta, desc, item: null };
  }
  function setHero(it) {
    if (!it) return;
    if (heroEls && heroEls.item !== it) {
      heroEls.item = it;
      heroEls.title.textContent = it.title || "";
      heroEls.meta.textContent = [it.kind === "live" ? "Live" : "", it.sub, it.meta, it.duration ? minutes(it.duration) : ""].filter(Boolean).join("  ·  ");
      heroEls.desc.textContent = it.desc || "";
    }
    const url = it.img || it.poster;
    if (url && bg.dataset.src !== url) {
      bg.dataset.src = url;
      bg.style.backgroundImage = `url("${url}")`;
    }
  }

  async function tabPage(key, box, mine) {
    const t = A.tabs.find((x) => x.key === key);
    if (t && t.search) return searchPage(box, mine);
    const data = await A.load(key);
    if (page !== mine) return;
    hero(box);
    // Weiterschauen (eigene Liste) auf der ersten Seite
    if (key === A.tabs[0].key) {
      const cont = history().map((h) => h.item);
      if (cont.length) shelf(box, { title: "Weiterschauen", items: cont });
    }
    for (const sec of data.sections || []) shelf(box, sec);
    const first = box.querySelector(".tvm-card");
    if (first) setHero(first._item);
    if (!box.querySelector(".tvm-card")) box.append(el("div", "tvm-empty", "Hier gibt es gerade nichts."));
  }

  // ---------- Suche ----------
  let lastTerm = "";
  function searchPage(box, mine) {
    const field = el("div", "tvm-search");
    const input = el("input", "tvm-search__input");
    input.type = "search";
    input.placeholder = "Sendungen, Filme, Themen …";
    input.value = lastTerm;
    field.append(icon(ICONS.search, "tvm-search__icon"), input);
    const results = el("div", "tvm-results");
    box.append(field, results);
    let timer = null;
    const run = async () => {
      const term = input.value.trim();
      lastTerm = term;
      results.replaceChildren();
      if (!term) return;
      const spin = el("div", "tvm-spinner tvm-spinner--small");
      results.append(spin);
      const data = await A.search(term).catch(() => null);
      spin.remove();
      if (page !== mine || input.value.trim() !== term) return;
      for (const sec of data?.sections || []) shelf(results, sec);
      if (!results.children.length) results.append(el("div", "tvm-empty", `Keine Treffer für „${term}“`));
    };
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 800); });
    input.addEventListener("change", () => { clearTimeout(timer); run(); });
    if (lastTerm) run();
    setTimeout(() => { if (page === mine && !(TV.current && header.contains(TV.current))) TV.focus(input); }, 0);
  }

  // ---------- Detailseite ----------
  function activate(it) {
    if (!it) return;
    if (it.play || it.kind === "live" || (it.kind === "video" && !A.openVideos)) return play(it);
    if (page) page.restore = TV.current;
    stack.push({ from: page });
    show("detail", (box, mine) => detailPage(it, box, mine));
  }

  async function detailPage(it, box, mine) {
    const d = await A.open(it);
    if (page !== mine) return;
    const head = el("div", "tvm-detail");
    head.append(el("h1", "tvm-detail__title", d.title || it.title));
    const meta = [d.sub, ...(d.meta || [])].filter(Boolean).join("  ·  ");
    if (meta) head.append(el("div", "tvm-detail__meta", meta));
    if (d.desc) head.append(el("div", "tvm-detail__desc", d.desc));
    const actions = el("div", "tvm-actions");
    const target = d.play || (it.kind === "video" ? it : null);
    if (target) {
      const pos = positionOf(target);
      const b = el("button", "tvm-btn tvm-btn--primary");
      b.append(icon(ICONS.play, "tvm-btn__icon"), document.createTextNode(pos > 20 ? `Weiterschauen (${clock(pos)})` : "Abspielen"));
      b.addEventListener("click", () => play(target));
      actions.append(b);
      if (pos > 20) {
        const r = el("button", "tvm-btn");
        r.append(icon(ICONS.restart, "tvm-btn__icon"), document.createTextNode("Von vorn"));
        r.addEventListener("click", () => play(target, 0));
        actions.append(r);
      }
    }
    if (actions.children.length) head.append(actions);
    box.append(head);
    const url = d.img || it.img;
    if (url) { bg.dataset.src = url; bg.style.backgroundImage = `url("${url}")`; }
    for (const sec of d.sections || []) {
      if (sec.grid) grid(box, sec); else shelf(box, sec);
    }
  }

  // ---------- Player ----------
  let watching = null; // {item, video, hls, bar}
  let barUntil = 0, tick = null;

  async function play(it, from) {
    if (watching) stopPlayer();
    if (page) page.restore = TV.current && root.contains(TV.current) ? TV.current : page.restore;
    const box = el("div", "tvm-player");
    const video = el("video", "tvm-video");
    video.autoplay = true;
    video.playsInline = true;
    const wait = el("div", "tvm-wait");
    wait.append(el("div", "tvm-spinner"));
    const bar = el("div", "tvm-bar");
    bar.innerHTML = `<div class="tvm-bar__title"></div><div class="tvm-bar__sub"></div>
      <div class="tvm-bar__row"><div class="tvm-bar__state"></div><div class="tvm-bar__time"></div>
      <div class="tvm-bar__track"><div class="tvm-bar__fill"></div></div><div class="tvm-bar__time tvm-bar__end"></div></div>
      <div class="tvm-bar__hint"></div>`;
    // Das Video direkt ins Dokument (nicht in einen festen Kasten): sonst kann Chromium es auf dem Pi nicht als
    // eigene Ebene ausgeben und verwirft gemessen 60–80 % der Bilder. Leiste und Ladekreis liegen darüber.
    box.append(wait, bar);
    document.body.append(video, box);
    root.classList.add("tvm--hidden");
    watching = { item: it, video, bar, wait, hls: null, box };
    bar.querySelector(".tvm-bar__title").textContent = it.title || "";
    bar.querySelector(".tvm-bar__sub").textContent = [it.sub, it.kind === "live" ? "Live" : ""].filter(Boolean).join("  ·  ");
    showBar(5000);
    let s;
    try {
      s = await A.stream(it);
    } catch (error) {
      if (watching?.video !== video) return;
      wait.replaceChildren(el("div", "tvm-error", `Abspielen ging nicht (${error.message})`));
      return;
    }
    if (watching?.video !== video) return;
    if (s.title) bar.querySelector(".tvm-bar__title").textContent = s.title;
    watching.live = !!(s.live || it.kind === "live");
    const start = from != null ? from : watching.live ? 0 : positionOf(it);
    // HLS immer über hls.js: Chromiums eigene HLS-Wiedergabe bleibt auf dem Pi in niedriger Qualität hängen
    if (s.type === "hls" && window.Hls && Hls.isSupported()) {
      const hls = new Hls({ capLevelToPlayerSize: true, maxBufferLength: 30, startPosition: start > 0 ? start : -1 });
      watching.hls = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        // Pi 4: höchstens 1080p (darüber schafft der Decoder es nicht flüssig)
        const levels = data.levels || [];
        let cap = -1;
        levels.forEach((l, i) => { if ((l.height || 0) <= 1080 && (cap < 0 || l.bitrate > levels[cap].bitrate)) cap = i; });
        if (cap >= 0) hls.autoLevelCapping = cap;
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (event, data) => {
        (watching.log = watching.log || []).push(`${data.type}/${data.details}${data.fatal ? " fatal" : ""}`);
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else wait.replaceChildren(el("div", "tvm-error", "Abspielen ging nicht"));
      });
      hls.loadSource(s.url);
      hls.attachMedia(video);
    } else {
      video.src = s.url;
      if (start > 0) video.addEventListener("loadedmetadata", () => { video.currentTime = start; }, { once: true });
      video.addEventListener("canplay", () => { if (!watching?.userPaused) video.play().catch(() => {}); }, { once: true });
      video.play().catch(() => {});
    }
    if (s.subtitles) {
      const track = el("track");
      track.kind = "subtitles";
      track.srclang = "de";
      track.src = s.subtitles;
      video.append(track);
    }
    video.addEventListener("ended", () => { remember(it, 0, 0); stopPlayer(); });
    let saved = 0;
    tick = setInterval(() => {
      if (!watching) return;
      const v = watching.video;
      wait.classList.toggle("is-on", v.readyState < 3 && !v.paused);
      // nach dem Springen an die gemerkte Stelle bleibt das Video manchmal stehen
      if (v.paused && !watching.userPaused && !v.ended && v.readyState >= 3) v.play().catch(() => {});
      if (!watching.live && v.currentTime && Date.now() - saved > 10000) {
        saved = Date.now();
        remember(it, v.currentTime, v.duration);
      }
      if (bar.classList.contains("is-on")) {
        if (Date.now() > barUntil && !v.paused) bar.classList.remove("is-on");
        else updateBar();
      }
    }, 500);
  }

  function updateBar() {
    if (!watching) return;
    const { video: v, bar, live } = watching;
    bar.querySelector(".tvm-bar__state").replaceChildren(icon(v.paused ? ICONS.play : ICONS.pause));
    bar.querySelector(".tvm-bar__row").classList.toggle("is-live", live);
    if (live) {
      bar.querySelector(".tvm-bar__time").textContent = "LIVE";
    } else {
      const dur = isFinite(v.duration) ? v.duration : 0;
      bar.querySelector(".tvm-bar__time").textContent = clock(v.currentTime);
      bar.querySelector(".tvm-bar__end").textContent = dur ? `-${clock(dur - v.currentTime)}` : "";
      bar.querySelector(".tvm-bar__fill").style.width = `${dur ? Math.min(100, (v.currentTime / dur) * 100) : 0}%`;
    }
    bar.querySelector(".tvm-bar__hint").textContent = live ? "OK Pause  ·  Zurück: Übersicht"
      : "OK Pause  ·  ◀ ▶ 10 Sekunden  ·  ▲ ▼ 1 Minute  ·  Zurück: Übersicht";
  }
  function showBar(ms = 4000) {
    if (!watching) return;
    barUntil = Date.now() + ms;
    updateBar();
    watching.bar.classList.add("is-on");
  }

  function stopPlayer() {
    if (!watching) return;
    const w = watching;
    watching = null;
    clearInterval(tick);
    if (!w.live && w.video.currentTime) remember(w.item, w.video.currentTime, w.video.duration);
    try { w.hls?.destroy(); } catch (e) { /* egal */ }
    w.video.pause();
    w.video.removeAttribute("src");
    w.video.load();
    w.video.remove();
    w.box.remove();
    root.classList.remove("tvm--hidden");
    const back = page?.restore;
    if (back && back.isConnected) { reveal(back); TV.focus(back); }
  }

  function playerKey(key) {
    if (!watching) return false;
    const v = watching.video;
    if (key === "back") return stopPlayer(), true;
    if (key === "ok") {
      watching.userPaused = !v.paused;
      if (v.paused) v.play().catch(() => {}); else v.pause();
    } else if (!watching.live && (key === "left" || key === "right" || key === "up" || key === "down")) {
      const step = key === "left" ? -10 : key === "right" ? 10 : key === "up" ? 60 : -60;
      v.currentTime = Math.max(0, Math.min((v.duration || 1e9) - 1, v.currentTime + step));
    }
    showBar();
    return true;
  }

  // ---------- Bewegen, Scrollen, Zurück ----------
  function reveal(target) {
    if (target._item && page?.kind === "tab") setHero(target._item);
    const row = target.closest(".tvm-row");
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
      if (row._more && target.parentElement === row && [...row.children].indexOf(target) > row.children.length - 5) row._more();
    }
    if (scroller && scroller.contains(target)) {
      const box = pageBox.getBoundingClientRect();
      const anchor = target.closest(".tvm-shelf") || target;
      const r = anchor.getBoundingClientRect();
      let y = Number(scroller.dataset.y);
      const top = r.top - box.top, bottom = r.bottom - box.top;
      if (top < 16) y += top - 16;
      else if (bottom > box.height - 24) y += bottom - (box.height - 24);
      if (anchor === scroller.querySelector(".tvm-shelf") || target === scroller.querySelector("button, input")) y = 0;
      y = Math.max(0, y);
      if (y !== Number(scroller.dataset.y)) {
        scroller.dataset.y = y;
        scroller.style.transform = `translateY(${-y}px)`;
      }
    }
  }

  function move(dir, from) {
    if (dir !== "left" && dir !== "right") return false;
    const row = from.closest(".tvm-row");
    if (!row) return false;
    const next = dir === "right" ? from.nextElementSibling : from.previousElementSibling;
    if (!next) return true;
    reveal(next);
    TV.focus(next);
    return true;
  }

  function moveFirst(dir, from) {
    if (dir === "down" && header.contains(from)) {
      const target = scroller?.querySelector(".tvm-btn--primary, button, input");
      if (target) { reveal(target); TV.focus(target); }
      return true;
    }
    if (dir === "up" && pageBox.contains(from)) {
      const top = from.getBoundingClientRect().top;
      const above = [...pageBox.querySelectorAll("button, input")].some((b) => {
        const r = b.getBoundingClientRect();
        return r.height > 0 && r.bottom <= top + 2;
      });
      if (!above) {
        TV.focus(pillsBox.querySelector(".is-selected") || pillsBox.querySelector(".tvm-pill"));
        return true;
      }
    }
    return false;
  }

  function back() {
    if (stack.length) {
      const { from } = stack.pop();
      page?.dispose?.();
      page = from;
      scroller = from.el;
      pageBox.replaceChildren(scroller);
      root.classList.toggle("tvm--detail", false);
      heroEls = from.heroEls || null;
      markPills();
      const target = from.restore?.isConnected ? from.restore : scroller.querySelector("button, input");
      if (target) { reveal(target); TV.focus(target); }
      return true;
    }
    if (TV.current && !header.contains(TV.current)) {
      const pill = pillsBox.querySelector(".is-selected");
      if (pill) { TV.focus(pill); return true; }
    }
    if (tab !== A.tabs[0].key) { openTab(A.tabs[0].key); return true; }
    TV.home();
    return true;
  }

  window.MediaApp = {
    start(adapter) {
      A = adapter;
      store = `tvm:${adapter.id}`;
      document.title = adapter.name;
      document.documentElement.classList.add("tvm-app");
      const go = () => {
        build();
        Object.assign(TV.site, {
          scope: () => (watching ? null : root),
          skip: () => false,
          exclude: "",
          nativeFocus: false,
          scrollFocus: false,
          initial: () => scroller?.querySelector(".tvm-btn--primary, button, input") || pillsBox.querySelector(".is-selected"),
          reveal, move, moveFirst, back,
          inPlayer: () => !!watching,
          playerKey,
          playPause: () => (watching ? (playerKey("ok"), true) : false),
        });
        openTab(adapter.tabs[0].key);
      };
      if (document.body) go(); else document.addEventListener("DOMContentLoaded", go, { once: true });
    },
    minutes,
    debug: () => watching && { log: watching.log, levels: watching.hls?.levels?.map((l) => `${l.height}p${l.frameRate || ""}`),
      level: watching.hls?.currentLevel, cap: watching.hls?.autoLevelCapping },
  };
})();
