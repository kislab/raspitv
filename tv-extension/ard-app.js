// ARD Mediathek (und 3sat, das die ARD-Schnittstelle als Partner führt): Adapter für media-app.js. Inhalte aus der offenen Schnittstelle der ARD
// (api.ardmediathek.de/page-gateway), Live-Programm aus programm-api.ard.de, Videos als MP4 (bis 1080p)
// bzw. HLS (Livestreams) im eigenen Player. Die ARD-Webseite selbst wird nicht geladen (media-boot.js).
(() => {
  if (!window.MediaApp) return;
  const API = "https://api.ardmediathek.de/page-gateway";
  // 3sat: gleiche Schnittstelle, eigener Partner-Bereich
  const SAT = /(^|\.)3sat\.de$/.test(location.hostname);
  const P = SAT ? "3sat" : "ard";

  async function get(url) {
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  const pic = (image, width) => (image && image.src ? image.src.replace("{width}", String(width)) : "");
  const withEmbedded = (url) => (/[?&]embedded=/.test(url) ? url : `${url}${url.includes("?") ? "&" : "?"}embedded=true`);

  const PAGE_TYPES = new Set(["show", "compilation", "editorialPage", "grouping"]);
  /** ARD-Teaser → Eintrag */
  function item(t) {
    if (!t || !t.id || t.type === "banner") return null;
    const href = t.links?.target?.href || "";
    const kind = t.type === "live" ? "live" : PAGE_TYPES.has(t.type) ? "show" : "video";
    return {
      id: t.id,
      kind,
      title: t.shortTitle || t.mediumTitle || t.longTitle || "",
      sub: [t.show?.title && t.show.title !== t.shortTitle ? t.show.title : "", t.publicationService?.name].filter(Boolean).join(" · "),
      meta: t.broadcastedOn ? new Date(t.broadcastedOn).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" }) : "",
      img: pic(t.images?.aspect16x9, 640),
      poster: pic(t.images?.aspect3x4, 400) || pic(t.images?.aspect16x9, 640),
      duration: t.duration || 0,
      href: href ? withEmbedded(href) : `${API}/pages/${P}/item/${t.id}?embedded=true`,
    };
  }

  /** Seite (Widgets) → Abschnitte */
  function sections(page) {
    const out = [];
    for (const w of page.widgets || []) {
      if (!/gridlist|stage/.test(w.type || "") || !(w.teasers || []).length) continue;
      const items = w.teasers.map(item).filter(Boolean);
      if (!items.length) continue;
      const posters = w.teasers.filter((t) => t.type === "poster").length > w.teasers.length / 2;
      const sec = { title: w.type === "stage" ? "" : w.title || "", layout: posters ? "poster" : "wide", items };
      const self = w.links?.self?.href;
      const pg = w.pagination;
      if (self && pg && pg.totalElements > (pg.pageNumber + 1) * pg.pageSize) {
        let n = pg.pageNumber;
        sec.more = async () => {
          n += 1;
          if (n * pg.pageSize >= pg.totalElements) return [];
          const next = await get(self.replace(/pageNumber=\d+/, `pageNumber=${n}`));
          return (next.teasers || []).map(item).filter(Boolean);
        };
      }
      out.push(sec);
    }
    return out;
  }

  async function live() {
    const now = await get("https://programm-api.ard.de/nownext/api/now");
    const items = Object.values(now.channels || {}).filter((c) => !SAT || /3sat/i.test(c.name)).map((c) => {
      const ev = (c.events || [])[0] || {};
      const pic = ev.image?.src || ev.image?.url || "";
      return {
        id: c.id,
        kind: "live",
        title: c.name,
        sub: ev.title?.short || "",
        desc: ev.title?.long || "",
        img: pic ? pic.replace("{width}", "640") : "",
        href: `${API}/pages/ard/item/${c.id}?embedded=true&mcV6=true`,
      };
    });
    return { sections: [{ title: "Jetzt live", layout: "wide", items }] };
  }

  const EDITORIAL = { filme: "filme", serien: "serien", dokus: "dokus", sport: "sport", kinder: "kinderfamilie" };

  /** Videoseite → Abspiel-Widget */
  async function player(it) {
    const page = await get(it.href.includes("/item/") ? it.href : `${API}/pages/${P}/item/${it.id}?embedded=true&mcV6=true`);
    const w = (page.widgets || []).find((x) => /^player_/.test(x.type || ""));
    return { page, w };
  }

  MediaApp.start({
    id: P,
    name: SAT ? "3sat" : "ARD Mediathek",
    logo: SAT ? "3sat" : "ARD Mediathek",
    accent: SAT ? "#e1001a" : "#2b6fd6",
    openVideos: true,
    tabs: SAT ? [
      { key: "home", label: "Start", icon: "home" },
      { key: "live", label: "Live", icon: "live" },
      { key: "search", label: "Suche", icon: "search", search: true },
    ] : [
      { key: "home", label: "Start", icon: "home" },
      { key: "live", label: "Live", icon: "live" },
      { key: "filme", label: "Filme", icon: "movie" },
      { key: "serien", label: "Serien", icon: "series" },
      { key: "dokus", label: "Dokus", icon: "doc" },
      { key: "sport", label: "Sport", icon: "sport" },
      { key: "search", label: "Suche", icon: "search", search: true },
    ],
    async load(tab) {
      if (tab === "live") return live();
      const url = tab === "home" ? `${API}/pages/${P}/home?embedded=true` : `${API}/pages/ard/editorial/${EDITORIAL[tab]}?embedded=true`;
      return { sections: sections(await get(url)) };
    },
    async search(term) {
      const q = encodeURIComponent(term);
      const [shows, vods] = await Promise.all([
        get(`${API}/widgets/${P}/search/grouping?searchString=${q}&pageSize=24`).catch(() => null),
        get(`${API}/widgets/${P}/search/vod?searchString=${q}&pageSize=48`).catch(() => null),
      ]);
      return { sections: [
        { title: "Sendungen", layout: "wide", items: (shows?.teasers || []).map(item).filter(Boolean) },
        { title: "Videos", layout: "wide", items: (vods?.teasers || []).map(item).filter(Boolean) },
      ] };
    },
    async open(it) {
      if (it.kind === "show") {
        const page = await get(it.href);
        const secs = sections(page);
        // Sendung: Folgen als Raster, wenn es nur eine Liste gibt
        if (secs.length === 1) secs[0].grid = true;
        const img = pic(page.images?.aspect16x9, 1280) || it.img;
        return { title: page.title || it.title, desc: page.synopsis || page.description || "", img, sections: secs };
      }
      const { page, w } = await player(it);
      const d = {
        title: w?.title || page.title || it.title,
        sub: w?.show?.title && w.show.title !== w?.title ? w.show.title : "",
        meta: [w?.publicationService?.name, it.duration ? MediaApp.minutes(it.duration) : "",
          w?.availableTo ? `verfügbar bis ${new Date(w.availableTo).toLocaleDateString("de-DE")}` : ""].filter(Boolean),
        desc: w?.synopsis || "",
        img: (w?.image && pic(w.image, 1280)) || it.img,
        play: { ...it, play: true },
        sections: sections(page).filter((s) => s.items.every((x) => x.id !== it.id) || s.items.length > 1)
          .map((s) => ({ ...s, items: s.items.filter((x) => x.id !== it.id) })),
      };
      return d;
    },
    async stream(it) {
      const { w } = await player(it);
      const mc = w?.mediaCollection?.embedded || w?.mediaCollection;
      if (!mc) throw new Error(w?.blockedByFsk ? "Erst ab 20 Uhr verfügbar (Jugendschutz)" : "kein Video gefunden");
      // normale Tonspur (nicht Audiodeskription, „Klare Sprache“ o. Ä.)
      const all = (mc.streams || []).filter((s) => s.kind === "main").flatMap((s) => s.media || []);
      const standard = all.filter((m) => (m.audios || []).every((a) => a.kind === "standard") && !/klaresprache|_AD_|audiodeskription/i.test(m.url || ""));
      const media = standard.length ? standard : all;
      const mp4 = media.filter((m) => m.mimeType === "video/mp4" && (m.maxHResolutionPx || 0) <= 1920)
        .sort((a, b) => (b.maxHResolutionPx || 0) - (a.maxHResolutionPx || 0))[0];
      const hls = media.find((m) => /mpegurl/i.test(m.mimeType || ""));
      const live = it.kind === "live" || w?.type === "player_live";
      const pick = !live && mp4 ? { url: mp4.url, type: "mp4" } : hls ? { url: hls.url, type: "hls" } : mp4 ? { url: mp4.url, type: "mp4" } : null;
      if (!pick) throw new Error("kein abspielbares Video");
      return { ...pick, live, title: it.kind === "live" ? `${it.title}${it.sub ? ` – ${it.sub}` : ""}` : w?.title };
    },
  });
})();
