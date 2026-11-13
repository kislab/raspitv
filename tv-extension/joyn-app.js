// Joyn: Adapter für media-app.js. Joyns Seite läuft unsichtbar im Hintergrund; ihre Inhalte kommen über die
// Brücke joyn-bridge.js (dieselben GraphQL-Abfragen wie die Seite, Suche über Algolia). Videos sind
// kopiergeschützt: abgespielt wird im Player der Joyn-Seite (Seiten-Player von media-app.js), der dafür ein –
// auch kostenloses – Joyn-Konto verlangt.
(() => {
  if (!window.MediaApp) return;

  // ---------- Brücke ----------
  let seq = 0;
  const waiting = new Map();
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.tvjn !== "res") return;
    const w = waiting.get(event.data.id);
    if (!w) return;
    waiting.delete(event.data.id);
    if (event.data.ok) w.resolve(event.data.data); else w.reject(new Error(event.data.error));
  });
  function call(op, args) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      waiting.set(id, { resolve, reject });
      window.postMessage({ tvjn: "req", id, op, args }, "*");
      setTimeout(() => { if (waiting.delete(id)) reject(new Error("Zeitüberschreitung")); }, 30000);
    });
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function ready() {
    for (let i = 0; i < 40; i++) {
      const r = await call("ready").catch(() => null);
      if (r && r.ready && r.have.includes("LandingPageClient")) return r;
      await sleep(500);
    }
    throw new Error("Joyn lädt nicht");
  }
  async function q(name, vars) {
    await ready();
    return call("q", { name, vars });
  }

  // ---------- Daten ----------
  const prof = (url, profile) => (url ? url.replace(/profile:[^/?]+$/, `profile:${profile}`) : "");
  function item(a) {
    if (!a) return null;
    const t = a.__typename;
    if (t === "Brand" && a.livestream) {
      return { id: a.livestream.id, kind: "live", title: a.title, sub: "Live", img: prof(a.logo?.url, "nextgen-web-brand-150x"),
        logo: true, path: `/play/live-tv?channel_id=${a.livestream.id}` };
    }
    if (t === "EpgEntry") {
      const ls = a.livestream || {};
      return { id: `${ls.id}-${a.id}`, kind: "live", title: ls.brand?.title || a.title, sub: a.title,
        img: a.image?.url || "", path: `/play/live-tv?channel_id=${ls.id}` };
    }
    if (!a.path) return null;
    const show = t === "Series" || t === "Compilation";
    const land = a.heroLandscapeImage?.urlLivestill || a.heroLandscapeImage?.url || a.primaryImage?.defaultIconicImageUrl || a.primaryImage?.url || "";
    return {
      id: a.id,
      kind: show ? "show" : "video",
      title: a.title || "",
      sub: [a.genres?.[0]?.name, a.ageRating?.minAge != null ? `ab ${a.ageRating.minAge}` : ""].filter(Boolean).join(" · "),
      desc: a.description || "",
      img: prof(land, "nextgen-web-livestill-503x283"),
      poster: prof(a.heroPortrait?.url || a.heroPortraitImage?.urlCard || a.primaryImage?.url || land, "nextgen-web-heroportrait-243x365"),
      bigImg: a.heroLandscapeImage?.urlLandscape1920x || "",
      duration: a.video?.duration || 0,
      path: a.path,
    };
  }
  function laneSections(blocks) {
    const out = [];
    for (const b of blocks || []) {
      const items = (b.assets || []).map(item).filter(Boolean);
      if (!items.length) continue;
      const portrait = /Featured/.test(b.__typename || "");
      out.push({ title: b.headline || "", layout: items[0].kind === "live" ? "wide" : portrait ? "poster" : "wide", items });
    }
    return out;
  }
  async function page(path) {
    const d = await q("LandingPageClient", { path, variation: "Default" });
    const p = d?.page || {};
    const secs = laneSections(p.blocks);
    const ids = (p.lazyBlocks || []).map((b) => b.id);
    const chunks = [];
    for (let i = 0; i < ids.length; i += 6) chunks.push(ids.slice(i, i + 6));
    const more = await Promise.all(chunks.map((c) => q("LandingBlocks", { ids: c }).catch(() => null)));
    for (const m of more) secs.push(...laneSections(m?.blocks));
    return { sections: secs };
  }

  /** Staffeln einer Serie stehen nur im HTML ihrer Seite („allSeasons“) */
  async function seasonsOf(path) {
    // steht maskiert in einem Skript-Text der Seite (\"allSeasons\":[…]): Abschnitt ausschneiden, dann
    // erst als JavaScript-Text und danach als JSON lesen
    const html = await (await fetch(path)).text();
    const key = '\\"allSeasons\\":';
    const i = html.indexOf(key);
    if (i < 0) return [];
    let depth = 0, j = i + key.length;
    const start = j;
    for (; j < html.length; j++) {
      if (html[j] === "[") depth++;
      else if (html[j] === "]" && --depth === 0) break;
    }
    try {
      const text = JSON.parse(`"${html.slice(start, j + 1)}"`);
      return JSON.parse(text).map((s) => ({ id: s.id, number: s.number, count: s.numberOfEpisodes }));
    } catch (e) { return []; }
  }
  async function episodes(seasonId) {
    const all = [];
    for (const license of ["FREE", "SVOD"]) {
      const d = await q("Season", { id: seasonId, first: 100, licenseFilter: license, offset: 0 }).catch(() => null);
      for (const e of d?.season?.episodes || []) if (!all.some((x) => x.id === e.id)) all.push(e);
    }
    all.sort((a, b) => (a.number || 0) - (b.number || 0));
    return all.map((e) => ({
      id: e.id, kind: "video", play: true, title: `${e.number}. ${e.title || ""}`, sub: e.licenseTypes?.includes("SVOD") && !e.licenseTypes?.includes("AVOD") ? "Joyn PLUS+" : "",
      img: e.primaryImage?.url || "", duration: e.video?.duration || 0, path: e.path,
    }));
  }

  // ---------- Seiten-Player ----------
  let returnPath = "/";
  const findVideo = () => {
    let found = null;
    const walk = (root) => {
      for (const e of root.querySelectorAll("*")) {
        if (found) return;
        if (e.tagName === "VIDEO" && e.id !== "adVideo" && !e.closest?.("#adVideo")) found = e;
        if (e.shadowRoot) walk(e.shadowRoot);
      }
    };
    walk(document);
    return found;
  };
  // Cookie-Hinweis von Joyn („Ohne Auswahl fortfahren“) selbst bestätigen
  function clearConsent() {
    const banner = document.querySelector("cmp-banner")?.shadowRoot;
    if (!banner) return;
    let link = null;
    const walk = (r) => { for (const e of r.querySelectorAll("*")) { if (e.shadowRoot) walk(e.shadowRoot); if (e.tagName === "CMP-LINK" && /Ohne Auswahl/.test(e.textContent)) link = e; } };
    walk(banner);
    const target = link?.shadowRoot?.querySelector("a, button") || link;
    if (!target || !target.getClientRects().length) return; // Hinweis ist schon weg
    // der Link zeigt auf „/“: Joyns eigene Behandlung soll laufen, aber nicht die Seite neu laden
    target.addEventListener("click", (e) => e.preventDefault(), { once: true });
    target.click();
  }
  setInterval(clearConsent, 2000);

  MediaApp.start({
    id: "joyn",
    name: "Joyn",
    logo: '<svg viewBox="0 0 110 40"><text x="0" y="31" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="32" fill="#fff">joyn</text></svg>',
    accent: "#ff3d8b",
    openVideos: true,
    tabs: [
      { key: "/", label: "Start", icon: "home" },
      { key: "/live-tv", label: "Live-TV", icon: "live" },
      { key: "/serien", label: "Serien", icon: "series" },
      { key: "/filme", label: "Filme", icon: "movie" },
      { key: "/sport", label: "Sport", icon: "sport" },
      { key: "search", label: "Suche", icon: "search", search: true },
    ],
    load: (tab) => page(tab),
    async search(term) {
      await ready();
      const hits = await call("search", { term });
      const items = hits.map((h) => {
        const path = (h.routes || []).find((r) => r.deviceClass === "WEB")?.path || (h.routes || [])[0]?.path;
        const img = (h.images || []).find((i) => /LANDSCAPE|PRIMARY|HERO/i.test(i.type || ""))?.url || (h.images || [])[0]?.url || "";
        return path && { id: h.id, kind: h.type === "MOVIE" ? "video" : "show", title: h.titles?.DE || h.title || "",
          sub: [h.genres?.de?.[0], h.productionYear].filter(Boolean).join(" · "), desc: h.description || "", img, path };
      }).filter(Boolean);
      return { sections: [{ title: "Ergebnisse", layout: "wide", items }] };
    },
    async open(it) {
      if (it.kind === "show") {
        const seasons = await seasonsOf(it.path);
        seasons.sort((a, b) => b.number - a.number);
        const secs = [];
        for (const s of seasons.slice(0, 6)) {
          const eps = await episodes(s.id).catch(() => []);
          if (eps.length) secs.push({ title: `Staffel ${s.number}`, layout: "wide", items: eps });
        }
        if (!secs.length) secs.push({ title: "", items: [] });
        return { title: it.title, sub: it.sub, desc: it.desc, img: it.img, sections: secs };
      }
      return { title: it.title, sub: it.sub, meta: [it.duration ? MediaApp.minutes(it.duration) : ""].filter(Boolean),
        desc: it.desc, img: it.img, play: { ...it, play: true }, sections: [] };
    },
    async watch(it) {
      returnPath = "/";
      const path = /^\/play\//.test(it.path) ? it.path : `/play${it.path}`;
      await call("nav", { path });
    },
    async unwatch() {
      const v = findVideo();
      if (v) v.pause();
      await call("nav", { path: returnPath });
    },
    video: findVideo,
  });
})();
