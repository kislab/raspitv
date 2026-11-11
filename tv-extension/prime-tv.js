// Prime Video im Stil der Prime-Video-TV-App: eine eigene Oberfläche über primevideo.com.
//
// Wie bei Netflix und Disney+ läuft die Webseite unsichtbar darunter weiter, liefert die Daten
// (Banner, Reihen, Folgen …) und bekommt Klicks weitergereicht. Gemeinsame Bausteine kommen aus
// netflix-tv.css, das Prime-Aussehen aus prime-tv.css. Anders als dort lädt Prime bei jedem
// Seitenwechsel neu – die Position auf der Startseite wird deshalb in sessionStorage gemerkt.
// Im Player bleibt die Prime-eigene Bedienleiste sichtbar; die Fernbedienung steuert sie.
(() => {
  if (!window.TV) return;
  document.documentElement.classList.add("tv-prime");

  // ---------- Hilfsfunktionen ----------

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const shown = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 8 && r.height > 8;
  };
  const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const tid = (id) => `[data-testid='${id}']`;
  const aid = (id) => `[data-automation-id='${id}']`;

  /** Bild in passender Breite: aus srcset (<source>/<img>) den kleinsten Eintrag >= width wählen. */
  function pick(el, width) {
    if (!el) return "";
    const pic = el.tagName === "IMG" ? el.closest("picture") || el : el;
    const sets = $$("source", pic).map((s) => s.getAttribute("srcset")).concat([(pic.tagName === "IMG" ? pic : $("img", pic) || {}).getAttribute?.("srcset")]);
    const list = sets.filter(Boolean)[0];
    if (list) {
      const entries = list.split(/,\s*(?=https?:)/).map((e) => {
        const [url, w] = e.trim().split(/\s+/);
        return { url, w: parseInt(w, 10) || 0 };
      }).sort((a, b) => a.w - b.w);
      const hit = entries.find((e) => e.w >= width) || entries[entries.length - 1];
      if (hit) return hit.url;
    }
    const im = el.tagName === "IMG" ? el : $("img", el);
    return im ? im.currentSrc || im.src || "" : "";
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
  function progressBar(value, cls = "nf-card-progress") {
    const bar = h("div", cls);
    const fill = h("div");
    fill.style.width = `${clamp(value, 0, 1) * 100}%`;
    bar.append(fill);
    return bar;
  }
  /** Fortschritt aus Prime-Balken (aria-valuenow in Prozent). */
  function progressOf(el) {
    const bar = el && $(`${tid("progress-bar")}[aria-valuenow], [role=progressbar][aria-valuenow]`, el);
    if (!bar) return null;
    const max = parseFloat(bar.getAttribute("aria-valuemax")) || 100;
    return parseFloat(bar.getAttribute("aria-valuenow")) / max;
  }

  const ICONS = {
    back: '<path d="M15 5l-7 7 7 7"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    trailer: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z" fill="currentColor"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    store: '<path d="M6 8h12l-1 12H7z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  };

  // "prime video"-Schriftzug mit Lächeln (eigene Zeichnung)
  const PV_LOGO =
    '<svg viewBox="0 0 120 34" fill="#fff"><text x="0" y="20" font-family="Amazon Ember, Helvetica Neue, Arial, sans-serif" ' +
    'font-size="21" font-weight="700" letter-spacing="-0.5">prime video</text>' +
    '<path d="M2 25 q 26 10 52 0" stroke="#1a98ff" stroke-width="2.6" fill="none" stroke-linecap="round"/>' +
    '<path d="M49 22.5 l6 2 -3.6 5" stroke="#1a98ff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // Obere Leiste wie in der Prime-TV-App (Ziele über die versteckte Navigation der Seite)
  const NAV = [
    { id: "search", label: "Suche", icon: "search" },
    { id: "home", label: "Startseite", testid: "pv-nav-home", path: /\/storefront\/?$|^\/(-\/[a-z]{2}\/?)?$/ },
    { id: "movies", label: "Filme", testid: "pv-nav-home-movies", path: /\/movie\/?$/ },
    { id: "tv", label: "Serien", testid: "pv-nav-home-tv-shows", path: /\/tv\/?$/ },
    { id: "sports", label: "Sport", testid: "pv-nav-home-sports", path: /\/sports\/?$/ },
    { id: "live", label: "Live-TV", testid: "pv-nav-live-tv", path: /\/livetv\/?$/ },
    { id: "watchlist", label: "Meine Watchlist", href: "/-/de/mystuff/watchlist", path: /\/mystuff/ },
    { id: "store", label: "Shop", icon: "store", testid: "pv-nav-store", path: /\/store\/?$/ },
  ];

  /** Läuft gerade der Prime-Player (Video im Vollbild über der Seite)? */
  function isPlayer() {
    const p = $("#dv-web-player");
    if (!p || !shown(p) || p.getBoundingClientRect().height < innerHeight * 0.6) return false;
    return getComputedStyle(p).visibility !== "hidden" && !!$("video", p);
  }
  const isDetail = () => /\/detail\//.test(location.pathname);
  const isSearch = () => /\/search/.test(location.pathname);

  // ---------- Daten aus der Prime-Seite ----------

  const rowCache = new Map(); // Reihen-Überschrift -> { title, cards }

  // Kartendaten je Element merken: nach dem Vorladen hat die Seite ~2000 Karten, die sonst alle
  // 400 ms komplett neu ausgelesen würden (blockierte die Seite, auch die Lautstärke-Anzeige).
  const cardCache = new WeakMap();
  function cardData(k) {
    const a = k.querySelector("a[href]");
    const im = k.querySelector("img");
    const key = (a ? a.getAttribute("href") : "") + "|" + (im ? im.getAttribute("srcset") || im.getAttribute("src") : "") +
      "|" + (k.dataset.cardTitle || "") + "|" + (im ? im.complete : "");
    const hit = cardCache.get(k);
    if (hit && hit.key === key && Date.now() - hit.at < 30000) return hit.data;
    const data = readCard(k);
    cardCache.set(k, { key, data, at: Date.now() });
    return data;
  }

  function readCard(k) {
    const a = $("a[href]", k);
    const super_ = k.matches(tid("super-carousel-card"));
    const pics = $$(`img${tid("base-image")}, img`, k);
    // Große "Originals"-Reihe: Prime liefert dort zusätzlich ein Hochkant-Poster
    const poster = super_ && pics.find((i) => i.naturalHeight > i.naturalWidth * 1.2);
    const wide = pics.find((i) => i !== poster) || pics[0];
    const button = $(`button[aria-label]`, k);
    const label = k.dataset.cardTitle || (poster && poster.alt) || (button && button.getAttribute("aria-label")) || text($("p", k));
    return {
      href: a ? a.getAttribute("href") : "",
      id: (a && a.getAttribute("href").split("?")[0]) || "live:" + label,
      label: label.replace(/\s+Live ansehen$/, ""),
      badge: text($(`${tid("status-badge")}, ${tid("metadata-badge")}`, k)),
      img: poster ? pick(poster, 480) : pick(wide, 640),
      wide: pick(wide, 1280),
      tall: !!poster,
      live: !a,
      entitled: k.dataset.cardEntitlement ? k.dataset.cardEntitlement === "Entitled" : null,
      type: k.dataset.cardEntityType === "Movie" ? "Film" : k.dataset.cardEntityType === "TV Show" ? "Serie" : "",
      progress: progressOf(k),
    };
  }

  /** Karte auf der (unsichtbaren) Seite wiederfinden – Prime baut Reihen beim Scrollen neu auf. */
  function findCard(card) {
    if (card.href) {
      const link = $$("a[href]").find((a) => a.getAttribute("href") === card.href);
      if (link) return link;
    }
    const art = $$(`${tid("card")}, ${tid("super-carousel-card")}`).find((k) => cardData(k).id === card.id);
    return art && ($(`${tid("invisible-play")}, button`, art) || art);
  }

  function readHome() {
    const slides = $$(tid("top-hero-card")).map((c) => {
      const art = $(`${tid("title-art")} img`, c);
      const link = $("a[href*='/detail/']", c);
      return {
        href: link ? link.getAttribute("href") : "",
        bg: pick($("[data-animate-hero-background] picture, picture", c), 1920),
        logo: art ? art.currentSrc || art.src : "",
        title: (art && art.alt) || text($("h1, h2", c)),
        syn: text($(tid("hero-synopsis"), c)),
        msg: text($(tid("high-value-msg-text"), c)),
        entitlement: text($(tid("entitlement-message"), c)),
      };
    }).filter((s) => s.bg && s.href);

    for (const t of $$(tid("carousel-title"))) {
      let wrap = t;
      while (wrap && !$(`${tid("card")}, ${tid("super-carousel-card")}`, wrap)) wrap = wrap.parentElement;
      if (!wrap) continue;
      const title = text($("h2, h3, span", t)) || text(t);
      const cards = $$(`${tid("card")}, ${tid("super-carousel-card")}`, wrap).map(cardData).filter((c) => c.img);
      if (!cards.length) continue;
      const known = rowCache.get(title);
      // Karten zusammenführen: Prime hält nur einen Teil der Reihe im Speicher
      if (!known) rowCache.set(title, { title, cards, wrap });
      else {
        const ids = new Set(known.cards.map((c) => c.id));
        for (const c of cards) if (!ids.has(c.id)) known.cards.push(c);
        known.wrap = wrap;
      }
    }
    const rows = [...rowCache.values()];

    // Suche und Raster ohne Reihen-Überschrift: alle Karten zeilenweise
    if (!rows.length) {
      const items = $$(tid("card")).filter((k) => shown(k));
      const lines = new Map();
      for (const k of items) {
        const top = Math.round(k.getBoundingClientRect().top / 40);
        if (!lines.has(top)) lines.set(top, []);
        lines.get(top).push(k);
      }
      const heading = text($("main h1, h1"));
      [...lines.values()].forEach((line, i) => rows.push({ title: i === 0 ? heading : "", cards: line.map(cardData) }));
    }
    return { slides, rows };
  }

  /** "Staffel 1 kaufen HD14,99 € 4,99 €Nur für kurze Zeit" -> "Staffel 1 kaufen · 4,99 €" */
  function shortLabel(label) {
    const prices = label.match(/\d+,\d\d\s*€/g);
    if (prices) {
      const what = label.split(/\s*(?:in\s*)?(?:UHD|HD|SD)?\s*\d+,\d\d/)[0].trim();
      return `${what} · ${prices[prices.length - 1].replace(/\s*€/, " €")}`;
    }
    if (/^Weitere Möglichkeiten/i.test(label)) return "Weitere Optionen";
    return label;
  }

  function readDetail() {
    const h1 = $("h1");
    const logo = h1 && $("img", h1);
    const tabs = ["btf-episodes-tab", "btf-related-tab", "btf-details-tab", "btf-explore-tab"].map((id) => $(aid(id))).filter(Boolean);
    // Gewählter Reiter: hat eine zusätzliche Klasse (Unterstrich) bzw. aria-selected
    const classCount = (t) => (t.getAttribute("aria-selected") === "true" ? 99 : t.classList.length);
    const most = Math.max(...tabs.map(classCount), 0);
    const tabsTop = tabs.length ? tabs[0].getBoundingClientRect().top + scrollY : Infinity;
    const header = $("header, #pv-nav-container, [data-testid='pv-nav-branding']");
    const headerBottom = header ? header.closest("nav, header, div").getBoundingClientRect().bottom + scrollY : 80;
    const inHeader = (e) => !!e.closest("nav, header, [data-testid^='pv-nav']");

    // Große Aktionsknöpfe oben (Abspielen, Weiterschauen, Folge 1, Kaufen, Gratis testen …)
    const seen = new Set();
    const actions = $$("a, button").filter((e) => {
      const r = e.getBoundingClientRect();
      const top = r.top + scrollY;
      if (r.width < 140 || r.height < 30 || top > tabsTop || top < headerBottom || inHeader(e)) return false;
      if (e.closest(tid("dp-season-selector")) || e.closest(tid("episode-list-item"))) return false;
      const label = text(e) || e.getAttribute("aria-label") || "";
      if (!label || seen.has(label) || label.length > 60) return false;
      seen.add(label);
      return true;
    }).map((e) => ({ el: e, label: shortLabel(text(e) || e.getAttribute("aria-label")) }));

    const clickable = (label) => label && ($("button, input, a", label) || label);
    const trailer = $(aid("trailer-button"));
    const watchAdd = $(aid("watchlist-button-add"));
    const watchRemove = $(aid("watchlist-button-remove"));

    const age = $(aid("maturity-rating"));
    const year = $(aid("release-year-badge"));
    const star = $(aid("star-rating-badge"));
    const extra = year ? [...year.parentElement.children].map(text).filter((t) => /Staffel|Std\.|Min\.|^\d+\s*(h|min)/.test(t)) : [];
    const genres = $$(tid("genre-texts")).map(text).filter(Boolean);

    const active = tabs.find((t) => classCount(t) === most && most > Math.min(...tabs.map(classCount))) || tabs[0];
    const activeId = active ? active.dataset.automationId : "";

    let items = [];
    let details = "";
    if (activeId === "btf-episodes-tab" || !tabs.length) {
      items = $$(tid("episode-list-item")).map((li) => {
        const title = text($("h3", li));
        const pic = $(`${tid("episode-packshot")} img, img`, li);
        const playEl = $("a[href*='autoplay'], a[data-testid*='play' i], button[data-testid*='play' i], a[aria-label*='abspielen' i], button[aria-label*='abspielen' i], a[aria-label*='ansehen' i]", li);
        return {
          el: playEl || $(tid("episode-packshot"), li) || li,
          id: li.id,
          title,
          desc: text($("[data-automation-id^='synopsis']", li)),
          meta: [text($(tid("episode-release-date"), li)), text($(tid("episode-runtime"), li))].filter(Boolean).join("  •  "),
          img: pick(pic, 640),
          progress: progressOf(li),
          episode: true,
          playable: !!playEl,
        };
      });
    } else if (activeId === "btf-details-tab") {
      details = $$(tid("metadata-row")).map((dl) => [...dl.children].map(text).join(": ")).join("\n").slice(0, 1200);
    }
    if (!items.length && activeId !== "btf-details-tab") {
      // Ähnliches / Entdecken: Karten unterhalb der Reiter
      items = $$(`${tid("card")}`).filter((k) => k.getBoundingClientRect().top + scrollY > tabsTop).slice(0, 30).map((k) => {
        const c = cardData(k);
        return { ...c, title: c.label, desc: "", meta: c.badge, el: null, episode: false };
      });
    }

    const seasonBox = $(tid("dp-season-selector"));
    const season = seasonBox && {
      label: text($("label", seasonBox)) || text(seasonBox).split(/Staffel \d+/)[0],
      options: $$("ul a[href]", seasonBox).map((a) => ({ label: text(a).replace(/^.*?(?=Staffel|Season|Teil)/, ""), href: a.getAttribute("href") })),
    };
    if (season) {
      const m = text($("label", seasonBox)).match(/Staffel \d+/);
      season.label = m ? m[0] : season.label;
    }

    return {
      key: location.pathname,
      title: (logo && logo.alt) || text(h1) || document.title.replace(/^Prime Video:\s*/, ""),
      bg: pick($(`${aid("hero-background")} picture, ${aid("hero-background")}`), 1920),
      logo: logo ? pick(logo, 900) : "",
      msg: text($(aid("high-value-msg-text"))),
      badge: text($(`${aid("status-badge")}`)),
      synopsis: text($(".dv-dp-node-synopsis")),
      meta: [...new Set([age && `ab ${text(age)}`, ...genres, star && "★ " + text(star).replace(/^Star Filled/, ""), year && text(year), ...extra].filter(Boolean))],
      entitlement: text($(aid("entitlement-message"))),
      actions,
      trailer: trailer && clickable(trailer),
      watch: (watchAdd || watchRemove) && { el: clickable(watchAdd || watchRemove), added: !!watchRemove },
      tabs: tabs.map((t) => ({ el: t, label: text(t), active: t === active })),
      season: season && season.options.length > 0 ? season : season && { ...season, options: [] },
      items,
      details,
    };
  }

  // ---------- Zustand ----------

  const S = {
    view: null,       // "home" | "detail" | "profiles" | "loading" | null
    zone: "hero",     // Startseite: "nav" | "hero" | "rows"
    nav: 1,
    slide: 0,
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
    leaving: false,   // Seitenwechsel läuft (Prime lädt neu)
  };
  TV.prime = S; // Zustand für Tests (dev/cdp.py --ext 'TV.prime')

  // Position auf Start-/Übersichtsseiten über das Neuladen hinweg merken
  const SAVE_KEY = "raspitv-prime-pos";
  function savePos() {
    try {
      sessionStorage.setItem(SAVE_KEY, JSON.stringify({ path: location.pathname, zone: S.zone === "nav" ? "hero" : S.zone, row: S.row, cols: S.cols, slide: S.slide, rowTitle: S.home && S.home.rows[S.row] && S.home.rows[S.row].title }));
    } catch (e) { /* ohne Speicher eben von vorn */ }
  }
  function restorePos() {
    try {
      const p = JSON.parse(sessionStorage.getItem(SAVE_KEY) || "null");
      if (!p || p.path !== location.pathname) return null;
      return p;
    } catch (e) {
      return null;
    }
  }

  const root = h("div");
  root.id = "nftv";
  document.documentElement.append(root);
  let dom = {};

  function computeView() {
    if (isPlayer()) return null;
    if (S.leaving) return "loading";
    if (/\/(ap\/|signin|signup|register)/.test(location.pathname) || $("input[type=password], input[type=email]:not([hidden])")) return null;
    if (/\/profiles|whos-watching|\/pv-profile/.test(location.pathname)) return readProfiles().length ? "profiles" : "loading";
    if (isDetail()) return $("h1") && ($(aid("btf-episodes-tab")) || $(aid("btf-related-tab")) || $(aid("hero-background"))) ? "detail" : "loading";
    if ($(`${tid("top-hero-card")}, ${tid("card")}`)) return "home";
    if (isSearch()) return null; // leere Suche / keine Treffer: Seite selbst zeigen
    return document.readyState === "complete" ? null : "loading";
  }

  TV.site.takeover = () => !!S.view;

  /** Seitenwechsel: sofort Ladebildschirm zeigen, Prime lädt die neue Seite komplett. */
  function leave(go) {
    S.leaving = true;
    buildLoading();
    S.view = "loading";
    document.documentElement.classList.add("nftv-on");
    setTimeout(() => (S.leaving = false), 9000); // falls Prime ohne Neuladen umschaltet
    go();
  }

  // ---------- Obere Leiste ----------

  function buildTopNav() {
    const bar = h("div", "pv-topnav");
    const logo = h("div", "pv-logo");
    logo.innerHTML = PV_LOGO;
    bar.append(logo);
    const items = h("div", "pv-nav-items");
    dom.nav = NAV.map((item, i) => {
      const el = h("div", "pv-nav-item" + (item.icon ? " pv-nav-icon" : ""));
      if (item.icon) el.append(icon(item.icon));
      else el.textContent = item.label;
      el.title = item.label;
      el.onclick = () => { S.nav = i; navigate(item); };
      items.append(el);
      return el;
    });
    bar.append(items);
    const avatar = $(`${tid("pv-nav-account-and-profiles-dropdown-trigger")} img`);
    const av = h("div", "pv-avatar");
    if (avatar && (avatar.currentSrc || avatar.src)) av.append(img(avatar.currentSrc || avatar.src));
    else av.innerHTML = '<svg viewBox="0 0 24 24" fill="#fff"><circle cx="12" cy="8.5" r="4.2"/><path d="M3.8 21a8.2 8.2 0 0 1 16.4 0z"/></svg>';
    av.title = "Profile";
    av.onclick = () => navigate({ id: "profiles" });
    bar.append(av);
    dom.avatar = av;
    dom.topnav = bar;
    return bar;
  }

  function renderTopNav(focused) {
    const active = NAV.findIndex((n) => n.path && n.path.test(location.pathname));
    dom.nav.forEach((el, i) => {
      el.classList.toggle("nf-on", focused && i === S.nav);
      el.classList.toggle("pv-active", i === active);
    });
    dom.avatar.classList.toggle("nf-on", focused && S.nav === NAV.length);
  }

  function navKey(key, back) {
    if (key === "left") S.nav = Math.max(0, S.nav - 1);
    else if (key === "right") S.nav = Math.min(NAV.length, S.nav + 1);
    else if (key === "down" || key === "back") back();
    else if (key === "ok") return navigate(S.nav === NAV.length ? { id: "profiles" } : NAV[S.nav]), true;
    return false;
  }

  function navigate(item) {
    try { sessionStorage.removeItem(SAVE_KEY); } catch (e) { /* egal */ }
    if (item.id === "search") return openSearch();
    if (item.id === "profiles") {
      const link = $$("a[href*='profiles'], a[href*='whos-watching']")[0];
      return leave(() => (link ? link.click() : (location.href = "/-/de/profiles")));
    }
    const link = item.testid && ($$(`a${tid(item.testid)}`).find(shown) || $(`a${tid(item.testid)}`));
    leave(() => (link ? (location.href = link.href) : (location.href = item.href || "/-/de/storefront")));
  }

  /** Suche: Bildschirmtastatur auf ein eigenes Feld; danach Prime-Suchseite mit dem Begriff öffnen. */
  function openSearch() {
    const input = h("input");
    input.type = "search";
    input.className = "nf-search-input";
    root.append(input);
    TV.keyboard(input, (value) => {
      input.remove();
      const q = (value || input.value || "").trim();
      if (q) leave(() => (location.href = `/-/de/search/ref=atv_nb_sug?ie=UTF8&phrase=${encodeURIComponent(q)}`));
    });
  }

  // ---------- Startseite ----------

  function buildHome() {
    const { slides, rows } = S.home;
    root.replaceChildren();
    const page = h("div", "nf-home pv-home");
    dom.heroBg = img("", "nf-hero-bg pv-hero-bg");
    dom.peekBg = img("", "nf-peek-bg");
    page.append(dom.heroBg, dom.peekBg, h("div", "nf-shade"));

    const hero = h("div", "nf-hero pv-hero");
    dom.heroMsg = h("div", "pv-msg");
    dom.heroLogo = img("", "nf-logo");
    dom.heroTitle = h("h1", "nf-title");
    dom.heroSyn = h("p", "nf-syn");
    dom.heroEnt = h("div", "pv-entitled");
    const buttons = h("div", "nf-buttons");
    dom.heroBtn = h("div", "nf-btn nf-btn-primary");
    dom.heroBtn.append(icon("info"), h("span", "", "Details"));
    dom.heroBtn.onclick = () => { S.zone = "hero"; homeKey("ok"); };
    buttons.append(dom.heroBtn);
    dom.dots = h("div", "pv-dots");
    dom.dotEls = slides.map((s, i) => {
      const dot = h("div", "pv-dot");
      dot.onclick = () => { S.zone = "hero"; S.slide = i; renderHome(); };
      dom.dots.append(dot);
      return dot;
    });
    hero.append(dom.heroLogo, dom.heroTitle, dom.heroMsg, dom.heroSyn, dom.heroEnt, buttons, dom.dots);
    page.append(hero);

    const peek = h("div", "nf-peek");
    dom.peekTitle = h("h1", "nf-peek-title");
    dom.peekRow = h("div", "nf-peek-row");
    peek.append(dom.peekTitle, dom.peekRow);
    page.append(peek);

    dom.rowsEl = h("div", "nf-rows");
    dom.rows = [];
    rows.forEach((row) => appendRow(row));
    page.append(dom.rowsEl);
    root.append(page, buildTopNav(), backButton());
  }

  function appendRow(row) {
    const rowEl = h("div", "nf-row");
    rowEl.append(h("h2", "nf-row-title", row.title));
    const track = h("div", "nf-track");
    rowEl.append(track);
    dom.rowsEl.append(rowEl);
    dom.rows.push({ el: rowEl, track, cards: [] });
    appendCards(dom.rows.length - 1, row.cards);
  }

  function appendCards(r, cards) {
    const entry = dom.rows[r];
    for (const card of cards) {
      const i = entry.cards.length;
      const c = h("div", "nf-card" + (card.tall ? " pv-tall" : ""));
      c.onclick = () => { S.zone = "rows"; S.row = r; S.cols[r] = i; renderHome(); openCard(card); };
      c.append(img(card.img, "nf-card-img"));
      if (card.badge) c.append(h("div", "pv-badge" + (card.live ? " pv-badge-live" : ""), card.badge));
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

  const preloaded = new Set();
  function setImg(el, url, keep) {
    if (el.dataset.src === url) return;
    el.dataset.src = url || "";
    if (!keep) el.classList.remove("nf-loaded");
    if (url) el.src = url;
    else el.removeAttribute("src");
  }

  function renderHome() {
    const { slides, rows } = S.home;
    const hasHero = slides.length > 0;
    if (!hasHero && S.zone === "hero") S.zone = rows.length ? "rows" : "nav";
    S.row = clamp(S.row, 0, Math.max(0, rows.length - 1));
    const inRows = S.zone === "rows";

    root.classList.toggle("nf-in-rows", inRows || !hasHero);
    root.classList.toggle("pv-nav-focus", S.zone === "nav");
    root.classList.toggle("pv-hide-nav", inRows && S.row > 0);
    root.classList.remove("nf-d-in-rows");
    renderTopNav(S.zone === "nav");

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
      dom.heroMsg.textContent = s.msg;
      dom.heroMsg.style.display = s.msg ? "" : "none";
      dom.heroSyn.textContent = s.syn;
      dom.heroEnt.textContent = s.entitlement;
      dom.heroEnt.style.display = s.entitlement ? "" : "none";
      dom.dotEls.forEach((d, i) => d.classList.toggle("pv-on", i === S.slide));
    }
    dom.heroBtn.classList.toggle("nf-on", S.zone === "hero");

    const top = inRows || !hasHero ? 46 : 74;
    const first = inRows || !hasHero ? S.row : 0;
    const offset = dom.rows[first] ? dom.rows[first].el.offsetTop : 0;
    dom.rowsEl.style.transform = `translateY(calc(var(--u) * ${top} - ${offset}px))`;
    dom.rows.forEach((row, r) => {
      row.el.classList.toggle("nf-row-gone", (inRows || !hasHero) && r < S.row);
      const col = clamp(S.cols[r] || 0, 0, Math.max(0, row.cards.length - 1));
      S.cols[r] = col;
      row.track.style.transform = `translateX(${-(row.cards[col] ? row.cards[col].offsetLeft : 0)}px)`;
      row.cards.forEach((c, i) => {
        c.classList.toggle("nf-on", S.zone === "rows" && r === S.row && i === col);
        c.classList.toggle("nf-past", i < col);
      });
    });

    const row = rows[S.row];
    const card = row && row.cards[S.cols[S.row] || 0];
    if ((inRows || !hasHero) && card) {
      dom.peekTitle.textContent = card.label;
      const extra = card.entitled === true ? "Mit Prime" : card.entitled === false ? "Kauf, Leihe oder Abo" : "";
      dom.peekRow.textContent = [card.badge, card.type, extra, row.title].filter(Boolean).join("  •  ");
      dom.peekRow.classList.toggle("pv-peek-prime", card.entitled === true);
      setImg(dom.peekBg, card.wide || card.img, true);
    }
  }

  function homeKey(key) {
    const { slides, rows } = S.home;
    if (S.zone === "nav") {
      if (navKey(key, () => (S.zone = slides.length ? "hero" : "rows"))) return;
    } else if (S.zone === "hero") {
      if (key === "left") S.slide--;
      else if (key === "right") S.slide++;
      else if (key === "down" && rows.length) (S.zone = "rows"), (S.row = 0);
      else if (key === "up") openNav();
      else if (key === "back") TV.home();
      else if (key === "ok") return openCard(slides[S.slide]);
    } else if (S.zone === "rows") {
      const row = rows[S.row];
      const col = S.cols[S.row] || 0;
      if (key === "left") S.cols[S.row] = Math.max(0, col - 1);
      else if (key === "right") {
        if (col < row.cards.length - 1) S.cols[S.row] = col + 1;
        if (col >= row.cards.length - 4) loadMoreCards(row);
      } else if (key === "up") {
        if (S.row > 0) S.row--;
        else if (slides.length) S.zone = "hero";
        else openNav();
      } else if (key === "down") {
        if (S.row < rows.length - 1) S.row++;
      } else if (key === "back") {
        if (slides.length) (S.zone = "hero"), (S.row = 0);
        else openNav();
      } else if (key === "ok") {
        return openCard(row.cards[col]);
      }
    }
    renderHome();
  }

  function openNav() {
    S.zone = "nav";
    const active = NAV.findIndex((n) => n.path && n.path.test(location.pathname));
    S.nav = active >= 0 ? active : 1;
  }

  /** Weitere Karten einer Reihe: Prime-Pfeil "weiter" in der versteckten Reihe drücken. */
  function loadMoreCards(row) {
    const next = row.wrap && $(tid("right-arrow"), row.wrap);
    if (next && !next.disabled) next.click();
  }

  function openCard(card) {
    if (!card) return;
    savePos();
    const el = findCard(card);
    if (card.live && el) return el.click(); // Live-Sender: Prime startet den Player direkt
    leave(() => {
      if (card.href) location.href = new URL(card.href, location.origin).href;
      else if (el) el.click();
    });
  }

  // ---------- Detailseite ----------

  function buildDetail() {
    const d = S.d;
    root.replaceChildren();
    const page = h("div", "nf-detail pv-detail");
    page.append(img(d.bg, "nf-d-bg"), h("div", "nf-d-shade"));
    const mini = h("div", "nf-d-mini");
    mini.append(d.logo ? img(d.logo) : h("h1", "", d.title));
    page.append(mini);

    const info = h("div", "nf-d-info");
    info.append(d.logo ? img(d.logo, "nf-logo") : h("h1", "nf-title", d.title));
    if (d.msg || d.badge) {
      const line = h("div", "pv-msg-line");
      if (d.badge) line.append(h("span", "pv-badge pv-badge-inline", d.badge));
      if (d.msg) line.append(h("span", "pv-msg", d.msg));
      info.append(line);
    }
    if (d.meta.length) info.append(h("div", "nf-attrs", d.meta.join("  •  ")));
    if (d.synopsis) info.append(h("p", "nf-syn", d.synopsis));

    const buttons = h("div", "nf-buttons");
    dom.dButtons = [];
    const addButton = (iconName, label, action, primary, round) => {
      const b = h("div", "nf-btn" + (primary ? " nf-btn-primary" : "") + (round ? " pv-round" : ""));
      b.append(icon(iconName));
      if (!round) b.append(h("span", "", label));
      b.title = label;
      b.onclick = () => action();
      buttons.append(b);
      dom.dButtons.push({ el: b, action, label });
    };
    d.actions.forEach((a, i) => addButton(/kauf|leih|abo|testen|gratis|prime/i.test(a.label) && !/abspielen|ansehen|weiter|fortsetzen/i.test(a.label) ? "store" : "play", a.label, () => clickAction(a.el), i === 0));
    if (d.trailer) addButton("trailer", "Trailer", () => d.trailer.click(), false, true);
    if (d.watch) addButton(d.watch.added ? "check" : "plus", d.watch.added ? "Aus Watchlist entfernen" : "Zur Watchlist", () => d.watch.el.click(), false, true);
    info.append(buttons);
    if (d.entitlement) info.append(h("div", "pv-entitled", d.entitlement));
    page.append(info);

    // Reiter (Folgen / Ähnliches / Details / Entdecken), Staffelwahl, Inhalt
    const lower = h("div", "dp-lower pv-lower");
    const tabs = h("div", "dp-tabs");
    if (d.season) {
      dom.seasonChip = h("div", "dp-tab dp-season pv-season");
      dom.seasonChip.append(h("span", "", d.season.label), icon("down"));
      dom.seasonChip.onclick = () => { S.dZone = "tabs"; S.dTab = 0; openPicker(); };
      tabs.append(dom.seasonChip);
    } else dom.seasonChip = null;
    dom.tabs = d.tabs.map((t, i) => {
      const el = h("div", "dp-tab" + (t.active ? " dp-tab-active" : ""), t.label);
      el.onclick = () => { S.dZone = "tabs"; S.dTab = i + (dom.seasonChip ? 1 : 0); selectTab(); };
      tabs.append(el);
      return el;
    });
    lower.append(tabs);

    const track = h("div", "nf-track dp-items");
    dom.items = d.items.map((it, i) => {
      const c = h("div", "nf-card nf-ep" + (it.tall ? " pv-ep-tall" : ""));
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
    dom.epDesc = h("p", "pv-ep-desc");
    lower.append(dom.epDesc);
    if (d.details) lower.append(h("p", "dp-details pv-details", d.details));
    dom.itemsTrack = track;
    page.append(lower);
    dom.lower = lower;

    dom.picker = h("div", "nf-picker");
    page.append(dom.picker);
    root.append(page, backButton());
  }

  /** Fokusbare Einträge der Reiter-Zeile: ggf. Staffelwahl, dann die Reiter. */
  const tabCount = () => dom.tabs.length + (dom.seasonChip ? 1 : 0);

  function renderDetail() {
    const z = S.dZone;
    root.classList.toggle("nf-d-in-rows", z !== "buttons");
    root.classList.remove("nf-nav-open", "nf-in-rows", "pv-nav-focus", "pv-hide-nav");
    S.dBtn = clamp(S.dBtn, 0, Math.max(0, dom.dButtons.length - 1));
    dom.dButtons.forEach((b, i) => b.el.classList.toggle("nf-on", z === "buttons" && !S.picker && i === S.dBtn));
    S.dTab = clamp(S.dTab, 0, Math.max(0, tabCount() - 1));
    const off = dom.seasonChip ? 1 : 0;
    if (dom.seasonChip) dom.seasonChip.classList.toggle("nf-on", z === "tabs" && !S.picker && S.dTab === 0);
    dom.tabs.forEach((t, i) => t.classList.toggle("nf-on", z === "tabs" && !S.picker && i + off === S.dTab));
    S.dCol = clamp(S.dCol, 0, Math.max(0, dom.items.length - 1));
    dom.items.forEach((c, i) => {
      c.classList.toggle("nf-on", z === "items" && !S.picker && i === S.dCol);
      c.classList.toggle("nf-past", z === "items" && i < S.dCol);
    });
    const cur = dom.items[S.dCol];
    dom.itemsTrack.style.transform = `translateX(${-(z === "items" && cur ? cur.offsetLeft : 0)}px)`;
    const it = S.d.items[S.dCol];
    dom.epDesc.textContent = z === "items" && it && it.desc ? it.desc : "";
    dom.lower.style.transform = `translateY(calc(var(--u) * ${z === "buttons" ? 78 : 30}))`;

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
    if (key === "back") return leave(() => history.back());
    const z = S.dZone;
    if (z === "buttons") {
      if (key === "left") S.dBtn--;
      else if (key === "right") S.dBtn++;
      else if (key === "down" && tabCount()) S.dZone = "tabs";
      else if (key === "ok" && dom.dButtons[S.dBtn]) return dom.dButtons[S.dBtn].action();
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
      else if (key === "ok" && S.d.items[S.dCol]) return openItem(S.d.items[S.dCol]);
    }
    renderDetail();
  }

  function selectTab() {
    if (dom.seasonChip && S.dTab === 0) return openPicker();
    const tab = S.d.tabs[S.dTab - (dom.seasonChip ? 1 : 0)];
    if (tab) tab.el.click(); // neuer Inhalt kommt beim nächsten Lesen der Seite
    renderDetail();
  }

  function clickAction(el) {
    const href = el.getAttribute("href") || "";
    // Abspielen bleibt auf der Seite (Player legt sich darüber); andere Ziele laden neu
    if (!href || /autoplay|play/i.test(href) || href.startsWith("#")) el.click();
    else leave(() => el.click());
  }

  function openItem(it) {
    if (it.episode) return it.el && it.el.click();
    openCard(it);
  }

  function openPicker() {
    const s = S.d.season;
    if (!s || !s.options.length) return;
    const current = s.options.findIndex((o) => o.label === s.label);
    S.picker = { options: s.options, index: Math.max(0, current) };
    renderDetail();
  }

  function pickerKey(key) {
    const p = S.picker;
    if (key === "up") p.index = Math.max(0, p.index - 1);
    else if (key === "down") p.index = Math.min(p.options.length - 1, p.index + 1);
    else if (key === "back") S.picker = null;
    else if (key === "ok") {
      const o = p.options[p.index];
      S.picker = null;
      if (o.label !== S.d.season.label) return leave(() => (location.href = new URL(o.href, location.origin).href));
    }
    renderDetail();
  }

  // ---------- Profilauswahl ("Wer schaut gerade?") ----------

  function readProfiles() {
    const tiles = $$("[data-testid*='profile' i] a, a[href*='switchProfile'], a[href*='profileId'], button[data-testid*='profile' i], li[data-testid*='profile' i]")
      .filter((e) => shown(e) && !e.closest("[data-testid^='pv-nav']"));
    const seen = new Set();
    return tiles.map((t) => {
      const pic = $("img", t);
      const name = text(t) || (pic && pic.alt) || t.getAttribute("aria-label") || "";
      return { el: t, name, img: pic ? pic.currentSrc || pic.src : "" };
    }).filter((p) => p.name && !seen.has(p.name) && seen.add(p.name));
  }

  function buildProfiles() {
    root.replaceChildren();
    const page = h("div", "nf-profiles pv-profiles");
    const logo = h("div", "pv-logo pv-logo-top");
    logo.innerHTML = PV_LOGO;
    page.append(logo, h("h1", "nf-profiles-title", "Wer schaut gerade?"));
    const row = h("div", "nf-profiles-row");
    dom.profiles = S.profiles.map((p, i) => {
      const tile = h("div", "nf-profile");
      const pic = h("div", "nf-profile-pic");
      if (p.img) pic.append(img(p.img));
      else pic.append(h("span", "pv-initial", p.name.charAt(0).toUpperCase()));
      tile.append(pic, h("div", "nf-profile-name", p.name));
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
      return leave(() => p.el.click());
    }
    renderProfiles();
  }

  // ---------- Player: Prime-eigene Leiste über die Fernbedienung steuern ----------

  const player = () => $("#dv-web-player");
  const playingVideo = () => $$("video", player() || document).find((v) => v.videoWidth > 0) || null;

  function wakeControls() {
    const p = player();
    if (!p) return;
    const r = p.getBoundingClientRect();
    const target = $(".atvwebplayersdk-overlays-container", p) || p;
    target.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: r.left + r.width / 2 + Math.random(), clientY: r.top + r.height / 2 }));
  }

  /** Knopf im Player nach Klasse oder Beschriftung suchen. */
  function playerButton(classPart, label) {
    const p = player();
    if (!p) return null;
    return $$("button, [role=button]", p).find((b) => shown(b) && ((classPart && (b.className + " " + (b.parentElement || {}).className).includes(classPart)) || (label && label.test(b.getAttribute("aria-label") || text(b)))));
  }

  /** "Intro überspringen" / "Zusammenfassung überspringen" / "Nächste Folge", falls angeboten. */
  const skipButton = () => playerButton("skipelement", /überspringen|skip/i) || playerButton("nextupcard-button", null);

  function sendKey(key, code, keyCode) {
    const target = $(".atvwebplayersdk-overlays-container", player()) || player() || document.body;
    for (const type of ["keydown", "keyup"]) {
      target.dispatchEvent(new KeyboardEvent(type, { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true }));
    }
  }

  function closePlayer() {
    const close = playerButton("closebutton", /schließen|zurück|close|back/i);
    if (close) close.click();
    else sendKey("Escape", "Escape", 27);
  }

  Object.assign(TV.site, {
    inPlayer: isPlayer,
    playerKey(key) {
      wakeControls(); // Prime-Leiste einblenden, damit man sieht, was passiert
      if (key === "back") {
        closePlayer();
        return true;
      }
      const v = playingVideo();
      if (key === "ok") {
        const skip = skipButton();
        if (skip) skip.click();
        else {
          const pp = playerButton("playpause", /wiedergabe|pause|abspielen|play/i);
          if (pp) pp.click();
          else if (v) v.paused ? v.play() : v.pause();
        }
      } else if (key === "left" || key === "right") {
        const fwd = key === "right";
        const btn = playerButton(fwd ? "fastseekforward" : "fastseekback", fwd ? /vorwärts|vorspulen|forward/i : /rückwärts|zurückspulen|back 10|rewind/i);
        if (btn) btn.click();
        else sendKey(fwd ? "ArrowRight" : "ArrowLeft", fwd ? "ArrowRight" : "ArrowLeft", fwd ? 39 : 37);
      } else if (key === "up" || key === "down") {
        return true;
      }
      return true;
    },
  });

  // ---------- Steuerung ----------

  TV.site.key = (key) => {
    if (S.view === "home" && S.home) homeKey(key);
    else if (S.view === "detail" && S.d) detailKey(key);
    else if (S.view === "profiles" && S.profiles) profilesKey(key);
    else if (S.view === "loading" && (key === "back" || key === "home")) {
      S.leaving = false;
      if (key === "home") TV.home();
      else history.back();
    }
  };

  function buildLoading() {
    root.replaceChildren();
    const page = h("div", "nf-loading pv-loading");
    const logo = h("div", "pv-logo pv-logo-big");
    logo.innerHTML = PV_LOGO;
    page.append(logo, h("div", "nf-spinner"));
    root.append(page);
  }

  function update() {
    const view = computeView();
    document.documentElement.classList.toggle("nftv-on", !!view);
    if (view) {
      // Vorschau-Videos (Banner-Trailer) der versteckten Seite anhalten – nie den Player
      for (const v of $$("video")) {
        if (v.closest("#dv-web-player")) continue;
        v.muted = true;
        if (!v.paused) v.pause();
      }
    }

    if (view === "home") {
      preload();
      const data = readHome();
      const sig = JSON.stringify([location.pathname + location.search, data.slides.map((s) => s.href)]);
      const fresh = S.view !== "home" || sig !== S.homeSig || !S.home;
      const stable = !fresh && S.home.rows.every((old, r) => data.rows[r] && data.rows[r].title === old.title &&
        old.cards.every((c, i) => data.rows[r].cards[i] && data.rows[r].cards[i].id === c.id));
      if (fresh || !stable) {
        S.rebuilds = (S.rebuilds || []).slice(-9).concat(fresh ? "neu" : "Reihen");
        S.home = data;
        S.homeSig = sig;
        if (fresh && S.view !== "home") {
          const pos = restorePos();
          if (pos) {
            S.zone = pos.zone;
            S.slide = pos.slide || 0;
            S.cols = pos.cols || [];
            const r = data.rows.findIndex((row) => row.title === pos.rowTitle);
            S.row = r >= 0 ? r : pos.row || 0;
            S.pendingRow = r >= 0 ? null : pos.rowTitle; // Reihe noch nicht geladen: später springen
          }
        }
        buildHome();
      } else {
        data.rows.forEach((row, r) => {
          if (r >= dom.rows.length) appendRow(row);
          else if (row.cards.length > dom.rows[r].cards.length) appendCards(r, row.cards.slice(dom.rows[r].cards.length));
        });
        S.home = data;
      }
      if (S.pendingRow) {
        const r = data.rows.findIndex((row) => row.title === S.pendingRow);
        if (r >= 0) (S.row = r), (S.pendingRow = null);
      }
      S.view = "home";
      renderHome();
    } else if (view === "detail") {
      const data = readDetail();
      const sig = JSON.stringify([data.key, data.bg, data.logo, data.season && data.season.label, data.tabs.map((t) => t.active), data.items.map((i) => i.id + i.title), data.watch && data.watch.added, data.actions.map((a) => a.label), data.details.length]);
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
      const sig = JSON.stringify(profiles.map((p) => [p.name, p.img]));
      if (S.view !== "profiles" || sig !== S.profilesSig) {
        S.profiles = profiles;
        S.profilesSig = sig;
        buildProfiles();
      }
      S.view = "profiles";
      renderProfiles();
    } else if (view === "loading") {
      if (S.view !== "loading") buildLoading();
      S.view = "loading";
    } else {
      if (S.view) root.replaceChildren();
      S.view = null;
    }
  }

  /** Unsichtbare Seite schrittweise nach unten scrollen, damit Prime weitere Reihen lädt. */
  function preload() {
    const scroller = document.scrollingElement || document.documentElement;
    if (S.preloadDone || Date.now() - (S.preloadAt || 0) < 450) return;
    S.preloadAt = Date.now();
    const before = scroller.scrollTop;
    scroller.scrollTop = before + 1200;
    S.preloadIdle = scroller.scrollTop === before ? (S.preloadIdle || 0) + 1 : 0;
    S.preloadSteps = (S.preloadSteps || 0) + 1;
    if (S.preloadIdle >= 5 || S.preloadSteps > 60) {
      S.preloadDone = true;
      scroller.scrollTop = 0;
    }
  }

  // Prime lädt Seiten teils ohne Neuladen um (z. B. Reiter, Staffel): Ladeschirm dann beenden
  window.addEventListener("pageshow", () => { S.leaving = false; });
  let lastPath = location.pathname + location.search;
  setInterval(() => {
    const now = location.pathname + location.search;
    if (now !== lastPath) {
      lastPath = now;
      S.leaving = false;
      rowCache.clear();
      S.preloadDone = false;
      S.preloadSteps = 0;
      S.preloadIdle = 0;
    }
    update();
  }, 400);
  update();
})();
