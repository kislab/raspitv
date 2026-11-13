// Twitch: eigene TV-Oberfläche.
//
// Twitchs Webseite läuft nur im Hintergrund und wird nicht gezeichnet (html.tvtw-app body: content-visibility
// hidden). Die Inhalte kommen direkt aus Twitchs öffentlicher GraphQL-Schnittstelle (dieselbe wie die Webseite).
// Zum Ansehen wechselt die Twitch-Seite ohne Neuladen zum Kanal (bzw. Video); gezeigt wird dann nur ihr Video,
// bildschirmfüllend, mit eigener Info-Leiste. Zurück: Seite wechselt auf eine ruhige Seite ohne Video.
(() => {
  if (!window.TV) return;

  // ---------- Schnittstelle ----------
  const CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"; // öffentliche Kennung der Twitch-Webseite
  const authToken = () => (document.cookie.match(/(?:^|;\s*)auth-token=([^;]+)/) || [])[1] || "";
  async function gql(query, variables) {
    const headers = { "Client-ID": CLIENT_ID, "Content-Type": "text/plain;charset=UTF-8" };
    const token = authToken();
    if (token) headers.Authorization = `OAuth ${token}`;
    const r = await fetch("https://gql.twitch.tv/gql", { method: "POST", headers, body: JSON.stringify({ query, variables }) });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data) throw new Error(`HTTP ${r.status}`);
    if (!data.data && data.errors) throw new Error(data.errors[0]?.message || "Fehler");
    return data.data;
  }
  const STREAM = `id title viewersCount createdAt previewImageURL(width:640,height:360)
    broadcaster { id login displayName profileImageURL(width:70) }
    game { id name displayName boxArtURL(width:144,height:192) }`;
  const GAME = `id name displayName viewersCount boxArtURL(width:285,height:380)`;
  const VIDEO = `id title lengthSeconds publishedAt viewCount previewThumbnailURL(width:640,height:360)
    game { displayName } owner { login displayName profileImageURL(width:70) }`;

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
    browse: "M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z",
    search: "M10 3a7 7 0 0 1 5.6 11.2l4.6 4.6-1.4 1.4-4.6-4.6A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z",
    heart: "M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.4h2c.7-1.2 2.2-2.4 4.3-2.4 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z",
    play: "M7 4.5v15L19.5 12z",
    pause: "M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z",
    user: "M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0 2c-4.4 0-8 2.2-8 5v2h16v-2c0-2.8-3.6-5-8-5z",
  };
  // Twitch-Logo (Sprechblase)
  const LOGO = "M4.3 2 2.5 6.6v16.1h5.6V26h3.1l3.1-3.3h4.6l6.2-6.5V2zm19 13.2-3.6 3.8h-5.6L11 22.3V19H6.4V4.2h16.9zM19.4 7.6v6.6h-2.2V7.6zm-6 0v6.6h-2.2V7.6z";
  const de = (n) => Number(n || 0).toLocaleString("de-DE");
  function viewers(n) {
    n = Number(n || 0);
    if (n >= 1000) return `${(n / 1000).toLocaleString("de-DE", { maximumFractionDigits: n >= 10000 ? 0 : 1 })} Tsd. Zuschauer`;
    return `${n} Zuschauer`;
  }
  const clock = (sec) => {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  };
  function ago(iso) {
    const d = (Date.now() - new Date(iso)) / 1000;
    if (!(d > 0)) return "";
    if (d < 3600) return `vor ${Math.max(1, Math.round(d / 60))} Min.`;
    if (d < 86400) return `vor ${Math.round(d / 3600)} Std.`;
    const days = Math.round(d / 86400);
    return days === 1 ? "gestern" : days < 31 ? `vor ${days} Tagen` : new Date(iso).toLocaleDateString("de-DE");
  }
  // Vorschaubilder der Live-Streams ändern sich ständig, der Browser hält sie aber lange vor: pro Minute neu
  const fresh = (url) => (url ? `${url}${url.includes("?") ? "&" : "?"}t=${Math.floor(Date.now() / 60000)}` : "");
  const img = (src, cls) => {
    const i = el("img", cls);
    i.loading = "lazy";
    i.decoding = "async";
    if (src) i.src = src; else i.classList.add("is-empty");
    return i;
  };

  // ---------- Grundgerüst ----------
  let root, header, pillsBox, profileBox, pageBox, scroller;
  let tab = "home";
  let stack = [];        // geöffnete Unterseiten (Kategorie, Kanal)
  let page = null;
  let me = null;         // angemeldetes Konto (oder null)

  function build() {
    root = el("div", "tvtw");
    header = el("div", "tvtw-header");
    const logo = el("div", "tvtw-logo");
    const svg = icon(LOGO, "tvtw-logo__mark");
    svg.setAttribute("viewBox", "0 0 28 28");
    logo.append(svg);
    pillsBox = el("div", "tvtw-pills");
    profileBox = el("div", "tvtw-profile");
    header.append(logo, pillsBox, profileBox);
    pageBox = el("div", "tvtw-page");
    root.append(header, pageBox);
    document.documentElement.append(root);
    renderPills();
  }

  function renderPills() {
    const pills = [["home", "Startseite", ICONS.home], ["browse", "Kategorien", ICONS.browse], ["search", "Suchen", ICONS.search]];
    if (me) pills.splice(1, 0, ["following", "Gefolgt", ICONS.heart]);
    pillsBox.replaceChildren(...pills.map(([key, label, d]) => {
      const b = el("button", "tvtw-pill");
      b.dataset.tab = key;
      b.append(icon(d, "tvtw-pill__icon"), document.createTextNode(label));
      b.addEventListener("click", () => openTab(key));
      return b;
    }));
    profileBox.replaceChildren();
    if (me) {
      const av = img(me.profileImageURL, "tvtw-profile__img");
      profileBox.append(av, el("div", "tvtw-profile__name", me.displayName));
    } else {
      const b = el("button", "tvtw-login");
      b.append(icon(ICONS.user, "tvtw-login__icon"), document.createTextNode("Anmelden"));
      b.addEventListener("click", login);
      profileBox.append(b);
    }
    markPills();
  }

  function markPills() {
    for (const b of pillsBox.querySelectorAll(".tvtw-pill")) b.classList.toggle("is-selected", b.dataset.tab === tab);
  }

  function show(kind, buildFn, focusFirst = true) {
    page?.dispose?.();
    pageBox.replaceChildren();
    scroller = el("div", "tvtw-scroll");
    scroller.dataset.y = "0";
    pageBox.append(scroller);
    page = { kind, el: scroller };
    root.classList.toggle("tvtw--sub", stack.length > 0);
    markPills();
    const mine = page;
    const loading = el("div", "tvtw-loading");
    loading.append(el("div", "tvtw-spinner"));
    scroller.append(loading);
    Promise.resolve(buildFn(scroller, mine)).catch((error) => {
      if (page !== mine) return;
      scroller.append(el("div", "tvtw-error", `Konnte nicht geladen werden (${error.message})`));
    }).finally(() => {
      loading.remove();
      if (page !== mine) return;
      if (mine.restore && mine.restore.isConnected) return void (reveal(mine.restore), TV.focus(mine.restore));
      if (focusFirst && !(TV.current && root.contains(TV.current) && !header.contains(TV.current))) {
        const target = scroller.querySelector(".tvtw-btn--primary, button, input");
        if (target) { reveal(target); TV.focus(target); }
      }
    });
    return mine;
  }

  const PAGES = { home: homePage, following: followingPage, browse: browsePage, search: searchPage };
  function openTab(key) {
    tab = key;
    stack = [];
    const fromHeader = TV.current && header.contains(TV.current);
    show(key, PAGES[key], !fromHeader);
  }

  // ---------- Karten und Reihen ----------
  function streamItem(s) {
    if (!s || !s.broadcaster) return null;
    return { kind: "stream", login: s.broadcaster.login, name: s.broadcaster.displayName || s.broadcaster.login,
      avatar: s.broadcaster.profileImageURL, title: s.title || "", game: s.game?.displayName || "", gameName: s.game?.name || "",
      viewers: s.viewersCount, since: s.createdAt, preview: s.previewImageURL };
  }
  function videoItem(v) {
    if (!v) return null;
    return { kind: "video", id: v.id, login: v.owner?.login, name: v.owner?.displayName || "", avatar: v.owner?.profileImageURL,
      title: v.title || "", game: v.game?.displayName || "", length: v.lengthSeconds, when: v.publishedAt, views: v.viewCount,
      // noch nicht verarbeitete Videos haben ein Platzhalterbild
      preview: /404_processing/.test(v.previewThumbnailURL || "") ? "" : v.previewThumbnailURL };
  }
  function gameItem(g) {
    return g && { kind: "game", name: g.name, title: g.displayName || g.name, viewers: g.viewersCount, box: g.boxArtURL };
  }
  function channelItem(c) {
    return c && { kind: "channel", login: c.login, name: c.displayName || c.login, avatar: c.profileImageURL,
      live: !!c.stream, viewers: c.stream?.viewersCount, game: c.stream?.game?.displayName || "" };
  }

  function card(it) {
    const b = el("button", `tvtw-card tvtw-card--${it.kind}`);
    b._item = it;
    if (it.kind === "game") {
      b.append(img(it.box, "tvtw-card__box"), el("div", "tvtw-card__title", it.title));
      if (it.viewers != null) b.append(el("div", "tvtw-card__sub", viewers(it.viewers)));
    } else if (it.kind === "channel") {
      const a = img(it.avatar, "tvtw-card__avatar");
      const wrap = el("div", "tvtw-card__avwrap");
      wrap.append(a);
      if (it.live) wrap.append(el("span", "tvtw-badge tvtw-badge--live", "LIVE"));
      b.append(wrap, el("div", "tvtw-card__title", it.name));
      b.append(el("div", "tvtw-card__sub", it.live ? [it.game, viewers(it.viewers)].filter(Boolean).join(" · ") : "Offline"));
    } else {
      const thumb = el("div", "tvtw-card__thumb");
      thumb.append(img(it.kind === "stream" ? fresh(it.preview) : it.preview, "tvtw-card__img"));
      if (it.kind === "stream") {
        thumb.append(el("span", "tvtw-badge tvtw-badge--live", "LIVE"), el("span", "tvtw-badge tvtw-badge--count", viewers(it.viewers)));
      } else {
        thumb.append(el("span", "tvtw-badge tvtw-badge--count", clock(it.length)), el("span", "tvtw-badge tvtw-badge--when", ago(it.when)));
      }
      const meta = el("div", "tvtw-card__meta");
      meta.append(img(it.avatar, "tvtw-card__av"));
      const text = el("div", "tvtw-card__text");
      text.append(el("div", "tvtw-card__title", it.title || it.name),
        el("div", "tvtw-card__sub", it.name), el("div", "tvtw-card__sub tvtw-card__game", it.game));
      meta.append(text);
      b.append(thumb, meta);
    }
    b.addEventListener("click", () => activate(it));
    return b;
  }

  function shelf(box, title, items) {
    items = (items || []).filter(Boolean);
    if (!items.length) return null;
    const s = el("section", "tvtw-shelf");
    if (title) s.append(el("h2", "tvtw-shelf__title", title));
    const clip = el("div", "tvtw-clip");
    const row = el("div", "tvtw-row");
    row.dataset.x = "0";
    for (const it of items) row.append(card(it));
    clip.append(row);
    s.append(clip);
    box.append(s);
    return s;
  }

  function grid(box, items) {
    const g = el("div", "tvtw-grid");
    for (const it of items.filter(Boolean)) g.append(card(it));
    box.append(g);
    return g;
  }

  // ---------- Startseite ----------
  let heroEls = null;
  function setHero(it) {
    if (!heroEls || !it || it.kind !== "stream" || heroEls.item === it) return;
    heroEls.item = it;
    heroEls.av.src = it.avatar || "";
    heroEls.name.textContent = it.name;
    heroEls.title.textContent = it.title;
    heroEls.meta.textContent = [it.game, viewers(it.viewers)].filter(Boolean).join("  ·  ");
    heroEls.pic.src = fresh(it.preview);
  }

  async function homePage(box, mine) {
    const q = `{ de: streams(first: 24, options: {languages: [DE]}) { edges { node { ${STREAM} } } }
      all: streams(first: 24) { edges { node { ${STREAM} } } }
      games(first: 24) { edges { node { ${GAME} } } } }`;
    const [d, follow] = await Promise.all([gql(q), me ? followedLive().catch(() => []) : []]);
    if (page !== mine) return;
    const german = (d.de?.edges || []).map((e) => streamItem(e.node)).filter(Boolean);
    const world = (d.all?.edges || []).map((e) => streamItem(e.node)).filter(Boolean);
    const top = follow[0] || german[0] || world[0];
    if (top) {
      const hero = el("div", "tvtw-hero");
      const text = el("div", "tvtw-hero__text");
      const who = el("div", "tvtw-hero__who");
      const av = img(top.avatar, "tvtw-hero__av");
      const name = el("div", "tvtw-hero__name");
      who.append(av, name, el("span", "tvtw-badge tvtw-badge--live", "LIVE"));
      const title = el("div", "tvtw-hero__title");
      const meta = el("div", "tvtw-hero__meta");
      text.append(who, title, meta);
      const pic = el("img", "tvtw-hero__pic");
      hero.append(text, pic);
      box.append(hero);
      heroEls = { av, name, title, meta, pic, item: null };
      setHero(top);
    }
    if (follow.length) shelf(box, "Gefolgte Kanäle – live", follow);
    shelf(box, "Live auf Deutsch", german);
    shelf(box, "Beliebte Kategorien", (d.games?.edges || []).map((e) => gameItem(e.node)));
    // die meistgeschauten Kategorien der deutschen Streams als eigene Reihen
    const cats = [];
    for (const s of german) if (s.gameName && !cats.includes(s.gameName)) cats.push(s.gameName);
    shelf(box, "Weltweit beliebt", world);
    const extra = await Promise.all(cats.slice(0, 3).map((name) => gql(`query($n: String) { game(name: $n) { displayName
        streams(first: 16, options: {languages: ["DE"]}) { edges { node { ${STREAM} } } } } }`, { n: name }).catch(() => null)));
    if (page !== mine) return;
    for (const r of extra) {
      const g = r?.game;
      const items = (g?.streams?.edges || []).map((e) => streamItem(e.node)).filter(Boolean);
      if (items.length > 2) shelf(box, `${g.displayName} auf Deutsch`, items);
    }
  }

  async function followedLive() {
    const d = await gql(`{ currentUser { followedLiveUsers(first: 40) { edges { node { stream { ${STREAM} } } } } } }`);
    return (d.currentUser?.followedLiveUsers?.edges || []).map((e) => streamItem(e.node?.stream)).filter(Boolean)
      .sort((a, b) => b.viewers - a.viewers);
  }

  async function followingPage(box, mine) {
    const [live, d] = await Promise.all([followedLive().catch(() => []),
      gql(`{ currentUser { follows(first: 100) { edges { node { login displayName profileImageURL(width:150)
        stream { viewersCount game { displayName } } } } } } }`).catch(() => null)]);
    if (page !== mine) return;
    if (live.length) {
      box.append(el("h2", "tvtw-shelf__title", "Jetzt live"));
      grid(box, live);
    }
    const offline = (d?.currentUser?.follows?.edges || []).map((e) => channelItem(e.node)).filter((c) => c && !c.live);
    if (offline.length) shelf(box, "Offline", offline);
    if (!live.length && !offline.length) box.append(el("div", "tvtw-empty", "Du folgst noch keinen Kanälen."));
  }

  // ---------- Kategorien ----------
  async function browsePage(box, mine) {
    box.append(el("h1", "tvtw-page__title", "Kategorien"));
    const g = el("div", "tvtw-grid tvtw-grid--games");
    box.append(g);
    let cursor = null, done = false, busy = false;
    const more = async () => {
      if (busy || done) return;
      busy = true;
      const d = await gql(`query($c: Cursor) { games(first: 42, after: $c) { edges { cursor node { ${GAME} } } pageInfo { hasNextPage } } }`,
        { c: cursor }).catch(() => null);
      busy = false;
      if (page !== mine || !d) return;
      const edges = d.games?.edges || [];
      for (const e of edges) g.append(card(gameItem(e.node)));
      cursor = edges[edges.length - 1]?.cursor;
      done = !d.games?.pageInfo?.hasNextPage || !cursor;
    };
    mine.onFocus = (t) => { if (g.contains(t) && [...g.children].indexOf(t) > g.children.length - 14) more(); };
    await more();
  }

  let german = true;
  async function gamePage(it, box, mine) {
    const head = el("div", "tvtw-gamehead");
    head.append(img(it.box, "tvtw-gamehead__box"));
    const t = el("div", "tvtw-gamehead__text");
    t.append(el("h1", "tvtw-page__title", it.title));
    if (it.viewers != null) t.append(el("div", "tvtw-gamehead__sub", viewers(it.viewers)));
    const lang = el("button", "tvtw-btn", "");
    const label = () => { lang.textContent = german ? "Sprache: Deutsch" : "Sprache: Alle"; };
    label();
    lang.addEventListener("click", () => { german = !german; openDetail(it); });
    t.append(lang);
    head.append(t);
    box.append(head);
    const g = el("div", "tvtw-grid");
    box.append(g);
    let cursor = null, done = false, busy = false;
    const more = async () => {
      if (busy || done) return;
      busy = true;
      const d = await gql(`query($n: String, $c: Cursor) { game(name: $n) { viewersCount
          streams(first: 24, after: $c${german ? ', options: {languages: ["DE"]}' : ""}) { edges { cursor node { ${STREAM} } } pageInfo { hasNextPage } } } }`,
        { n: it.name, c: cursor }).catch((e) => { if (!g.children.length) g.append(el("div", "tvtw-error", `Konnte nicht geladen werden (${e.message})`)); return null; });
      busy = false;
      if (page !== mine || !d) return;
      const edges = d.game?.streams?.edges || [];
      for (const e of edges) { const s = streamItem(e.node); if (s) g.append(card(s)); }
      cursor = edges[edges.length - 1]?.cursor;
      done = !d.game?.streams?.pageInfo?.hasNextPage || !cursor;
      if (!g.children.length) g.append(el("div", "tvtw-empty", german ? "Gerade niemand live auf Deutsch." : "Gerade niemand live."));
    };
    mine.onFocus = (target) => { if (g.contains(target) && [...g.children].indexOf(target) > g.children.length - 9) more(); };
    await more();
  }

  // ---------- Kanal ----------
  async function channelPage(it, box, mine) {
    const d = await gql(`query($l: String) { user(login: $l) { login displayName description profileImageURL(width:150) bannerImageURL
        followers { totalCount } stream { ${STREAM} }
        videos(first: 24, sort: TIME) { edges { node { ${VIDEO} } } } } }`, { l: it.login });
    if (page !== mine) return;
    const u = d.user;
    if (!u) throw new Error("Kanal nicht gefunden");
    const head = el("div", "tvtw-channel");
    if (u.bannerImageURL) {
      const banner = el("div", "tvtw-channel__banner");
      banner.style.backgroundImage = `url("${u.bannerImageURL}")`;
      head.append(banner);
    }
    const row = el("div", "tvtw-channel__row");
    row.append(img(u.profileImageURL, "tvtw-channel__av"));
    const t = el("div", "tvtw-channel__text");
    const live = streamItem(u.stream);
    t.append(el("h1", "tvtw-channel__name", u.displayName));
    t.append(el("div", "tvtw-channel__sub", [`${de(u.followers?.totalCount)} Follower`, live ? viewers(live.viewers) : "Offline"].join("  ·  ")));
    if (live) t.append(el("div", "tvtw-channel__live", live.title));
    else if (u.description) t.append(el("div", "tvtw-channel__desc", u.description));
    const actions = el("div", "tvtw-actions");
    if (live) {
      const b = el("button", "tvtw-btn tvtw-btn--primary");
      b.append(icon(ICONS.play, "tvtw-btn__icon"), document.createTextNode("Live ansehen"));
      b.addEventListener("click", () => watch(live));
      actions.append(b);
    }
    t.append(actions);
    row.append(t);
    head.append(row);
    box.append(head);
    const vids = (u.videos?.edges || []).map((e) => videoItem(e.node)).filter(Boolean);
    shelf(box, "Letzte Videos", vids);
    if (!live && !vids.length) box.append(el("div", "tvtw-empty", "Gerade offline, keine Videos."));
  }

  // ---------- Suche ----------
  let lastTerm = "";
  function searchPage(box, mine) {
    const field = el("div", "tvtw-search");
    const input = el("input", "tvtw-search__input");
    input.type = "search";
    input.placeholder = "Kanäle und Kategorien suchen";
    input.value = lastTerm;
    field.append(icon(ICONS.search, "tvtw-search__icon"), input);
    const results = el("div", "tvtw-results");
    box.append(field, results);
    let timer = null;
    const run = async () => {
      const term = input.value.trim();
      lastTerm = term;
      results.replaceChildren();
      if (!term) return;
      const d = await gql(`query($q: String!) { searchFor(userQuery: $q, platform: "web") {
          channels { items { login displayName profileImageURL(width:150) stream { viewersCount game { displayName } } } }
          games { items { ${GAME} } } } }`, { q: term }).catch(() => null);
      if (page !== mine || input.value.trim() !== term) return;
      const r = d?.searchFor || {};
      const chans = (r.channels?.items || []).map(channelItem).filter(Boolean);
      shelf(results, "Kanäle", chans);
      shelf(results, "Kategorien", (r.games?.items || []).map(gameItem));
      if (!results.children.length) results.append(el("div", "tvtw-empty", `Keine Treffer für „${term}“`));
    };
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 700); });
    input.addEventListener("change", () => { clearTimeout(timer); run(); });
    if (lastTerm) run();
    setTimeout(() => { if (page === mine && !(TV.current && header.contains(TV.current))) TV.focus(input); }, 0);
  }

  // ---------- Öffnen ----------
  function activate(it) {
    if (!it) return;
    if (it.kind === "stream" || it.kind === "video") return watch(it);
    if (page) page.restore = TV.current;
    stack.push({ item: it, from: page });
    openDetail(it);
  }
  function openDetail(it) {
    const fn = it.kind === "game" ? gamePage : channelPage;
    show(it.kind, (box, mine) => fn(it, box, mine), true);
  }

  // ---------- Ansehen ----------
  let watching = null;   // {item, since}
  let bar = null, barUntil = 0, waitTimer = null;
  function navigate(path) {
    if (location.pathname === path) return;
    history.pushState({}, "", path);
    dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  }
  const video = () => [...document.querySelectorAll(".persistent-player video, video")].find((v) => v.isConnected) || null;

  function buildBar() {
    bar = el("div", "tvtw-bar");
    const top = el("div", "tvtw-bar__top");
    top.append(img("", "tvtw-bar__av"));
    const t = el("div", "tvtw-bar__text");
    t.append(el("div", "tvtw-bar__name"), el("div", "tvtw-bar__title"), el("div", "tvtw-bar__meta"));
    top.append(t, icon(ICONS.pause, "tvtw-bar__state"));
    const prog = el("div", "tvtw-bar__prog");
    const track = el("div", "tvtw-bar__track");
    track.append(el("div", "tvtw-bar__fill"));
    prog.append(el("div", "tvtw-bar__time"), track, el("div", "tvtw-bar__time tvtw-bar__end"));
    bar.append(top, prog, el("div", "tvtw-bar__hint"));
    const wait = el("div", "tvtw-wait");
    wait.append(el("div", "tvtw-spinner"));
    bar._wait = wait;
    document.documentElement.append(bar, wait);
  }

  function updateBar() {
    if (!watching || !bar) return;
    const it = watching.item, v = video();
    const live = it.kind === "stream";
    bar.querySelector(".tvtw-bar__av").src = it.avatar || "";
    bar.querySelector(".tvtw-bar__name").textContent = it.name;
    bar.querySelector(".tvtw-bar__title").textContent = it.title;
    const meta = live ? [it.game, viewers(it.viewers), it.since ? `seit ${clock((Date.now() - new Date(it.since)) / 1000)}` : ""]
      : [it.game, ago(it.when)];
    bar.querySelector(".tvtw-bar__meta").textContent = meta.filter(Boolean).join("  ·  ");
    const paused = !!v && v.paused && !!watching.userPaused;
    const state = bar.querySelector(".tvtw-bar__state path");
    state.setAttribute("d", paused ? ICONS.pause : ICONS.play);
    bar.querySelector(".tvtw-bar__state").style.visibility = paused ? "visible" : "hidden";
    const prog = bar.querySelector(".tvtw-bar__prog");
    prog.hidden = live;
    if (!live && v) {
      const dur = v.duration && isFinite(v.duration) ? v.duration : it.length || 0;
      bar.querySelector(".tvtw-bar__time").textContent = clock(v.currentTime);
      bar.querySelector(".tvtw-bar__end").textContent = clock(dur);
      bar.querySelector(".tvtw-bar__fill").style.width = `${dur ? Math.min(100, (v.currentTime / dur) * 100) : 0}%`;
    }
    bar.querySelector(".tvtw-bar__hint").textContent = live ? "OK Pause  ·  Zurück: zur Übersicht"
      : "OK Pause  ·  ◀ ▶ 10 Sekunden  ·  ▲ ▼ 1 Minute  ·  Zurück: zur Übersicht";
  }
  function showBar(ms = 4000) {
    if (!bar) return;
    updateBar();
    bar.classList.add("is-on");
    barUntil = Date.now() + ms;
  }

  // Twitchs Hinweise vor dem Video (Inhalts-Warnung, „Ton an“ …) und den Cookie-Hinweis selbst bestätigen
  function clearGates() {
    document.querySelector("[data-a-target='content-classification-gate-overlay-start-watching-button']")?.click();
    document.querySelector("[data-a-target='player-overlay-mature-accept']")?.click();
    const consent = document.querySelector("[data-a-target='consent-banner']");
    if (consent) [...consent.querySelectorAll("button")].find((b) => /Ablehnen|Reject/i.test(b.textContent))?.click();
  }

  function watch(it) {
    if (!bar) buildBar();
    if (page) page.restore = TV.current && root.contains(TV.current) ? TV.current : null;
    watching = { item: it, started: Date.now() };
    document.documentElement.classList.add("tvtw-watch");
    bar._wait.classList.add("is-on");
    navigate(it.kind === "video" ? `/videos/${it.id}` : `/${it.login}`);
    showBar(6000);
    clearInterval(waitTimer);
    let unmuted = false, lastTime = null, moved = 0; // erst Bewegung nach dem Start zählt
    bar._wait.classList.add("is-first");
    waitTimer = setInterval(() => {
      if (!watching) return clearInterval(waitTimer);
      clearGates();
      const v = video();
      if (v && !unmuted && v.readyState > 2) {
        unmuted = true;
        if (v.muted) {
          const btn = document.querySelector("[data-a-target='player-mute-unmute-button']");
          if (btn) btn.click(); else v.muted = false;
          setTimeout(() => { const w = video(); if (w && w.muted) w.muted = false; }, 400);
        }
        if (v.volume < 0.5) v.volume = 1;
      }
      // Ladekreis nur, solange das Bild steht (vor dem ersten Bild schwarz, danach durchsichtig)
      const now = Date.now();
      if (v && v.currentTime !== lastTime) { if (lastTime !== null && v.currentTime > 0) moved = now; lastTime = v.currentTime; }
      const stalled = !v || (!v.paused && now - moved > 1500);
      if (moved) bar._wait.classList.remove("is-first");
      bar._wait.classList.toggle("is-on", !moved || stalled);
      const playing = !!moved && !stalled;
      // Leiste nach ein paar Sekunden ausblenden (nicht, solange pausiert)
      if (bar.classList.contains("is-on")) {
        if (now > barUntil && !watching.userPaused && playing) bar.classList.remove("is-on");
        else updateBar();
      }
      if (!playing && v && v.paused && v.readyState > 2 && Date.now() - watching.started > 4000 && !watching.userPaused) v.play().catch(() => {});
    }, 500);
  }

  function stopWatching() {
    if (!watching) return;
    watching = null;
    clearInterval(waitTimer);
    const v = video();
    if (v) v.pause();
    navigate("/directory");
    document.documentElement.classList.remove("tvtw-watch");
    bar?.classList.remove("is-on");
    bar?._wait.classList.remove("is-on");
    const back = page?.restore;
    if (back && back.isConnected) { reveal(back); TV.focus(back); }
  }

  function togglePause() {
    const v = video();
    if (!v || !watching) return;
    if (v.paused) { watching.userPaused = false; v.play().catch(() => {}); }
    else { watching.userPaused = true; v.pause(); }
    setTimeout(() => showBar(), 50);
  }

  function playerKey(key) {
    const v = video();
    const vod = watching?.item.kind === "video";
    if (key === "back") return stopWatching(), true;
    if (key === "ok") return togglePause(), true;
    if (vod && v && (key === "left" || key === "right" || key === "up" || key === "down")) {
      const step = key === "left" ? -10 : key === "right" ? 10 : key === "up" ? 60 : -60;
      v.currentTime = Math.max(0, Math.min((v.duration || 1e9) - 1, v.currentTime + step));
    }
    showBar();
    return true;
  }

  // ---------- Bewegen, Scrollen, Zurück ----------
  function reveal(target) {
    if (target._item && page?.kind === "home") setHero(target._item);
    const row = target.closest(".tvtw-row");
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
    if (scroller && scroller.contains(target)) {
      const box = pageBox.getBoundingClientRect();
      const anchor = target.closest(".tvtw-shelf") || target;
      const r = anchor.getBoundingClientRect();
      let y = Number(scroller.dataset.y);
      const top = r.top - box.top, bottom = r.bottom - box.top;
      if (top < 16) y += top - 16;
      else if (bottom > box.height - 24) y += bottom - (box.height - 24);
      // erste Reihe der Startseite: großes Bild oben mit zeigen
      if (anchor === scroller.querySelector(".tvtw-shelf") || target === scroller.querySelector("button, input")) y = 0;
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
    const row = from.closest(".tvtw-row");
    if (!row) return false;
    const next = dir === "right" ? from.nextElementSibling : from.previousElementSibling;
    if (!next) return true;
    reveal(next);
    TV.focus(next);
    return true;
  }

  function moveFirst(dir, from) {
    if (dir === "down" && header.contains(from)) {
      const target = scroller?.querySelector(".tvtw-btn--primary, button, input");
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
        TV.focus(pillsBox.querySelector(".is-selected") || pillsBox.querySelector(".tvtw-pill"));
        return true;
      }
    }
    return false;
  }

  function back() {
    if (stack.length) {
      // vorherige Seite unverändert wieder einsetzen (nicht neu laden) und dorthin, wo man war
      const { from } = stack.pop();
      page?.dispose?.();
      page = from;
      scroller = from.el;
      pageBox.replaceChildren(scroller);
      root.classList.toggle("tvtw--sub", stack.length > 0);
      markPills();
      const target = from.restore?.isConnected ? from.restore : scroller.querySelector("button, input");
      if (target) { reveal(target); TV.focus(target); }
      return true;
    }
    if (TV.current && !header.contains(TV.current)) {
      const pill = pillsBox.querySelector(".is-selected");
      if (pill) { TV.focus(pill); return true; }
    }
    if (tab !== "home") { openTab("home"); return true; }
    TV.home();
    return true;
  }

  // ---------- Anmelden: Twitchs eigene Seite zeigen (mit tv.js bedienbar) ----------
  function login() {
    document.documentElement.classList.remove("tvtw-app");
    root.hidden = true;
    Object.assign(TV.site, defaults, { back: () => (location.assign("/directory"), true) });
    location.assign("/login");
  }

  // ---------- Start ----------
  const defaults = { ...TV.site };
  function start() {
    document.documentElement.classList.add("tvtw-app");
    build();
    Object.assign(TV.site, {
      scope: () => (watching ? null : root),
      skip: () => false,
      exclude: "",
      nativeFocus: false,
      scrollFocus: false,
      initial: () => scroller?.querySelector(".tvtw-btn--primary, button, input") || pillsBox.querySelector(".is-selected"),
      reveal, move, moveFirst, back,
      inPlayer: () => !!watching,
      playerKey,
      playPause: () => (watching ? (togglePause(), true) : false),
    });
    // Startseite von Twitch spielt selbst ein Video ab: im Hintergrund auf eine ruhige Seite wechseln
    if (!/^\/directory/.test(location.pathname)) navigate("/directory");
    setInterval(() => { if (!watching) clearGates(); }, 3000);
    clearGates();
    const ready = authToken()
      ? gql(`{ currentUser { login displayName profileImageURL(width:70) } }`).then((d) => { me = d.currentUser || null; }).catch(() => {})
      : Promise.resolve();
    ready.finally(() => { renderPills(); openTab("home"); window.TVBoot?.release(); });
  }

  // nur auf normalen Seiten übernehmen (nicht im eingebetteten Player, nicht auf der Anmeldeseite)
  if (/^\/(login|signup|passport)/.test(location.pathname) || location.hostname !== "www.twitch.tv") {
    TV.site.back = () => (location.assign("/directory"), true);
    window.TVBoot?.release();
    return;
  }
  start();
})();
