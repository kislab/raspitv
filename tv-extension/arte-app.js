// ARTE: Adapter für media-app.js. Inhalte aus ARTEs eigener Schnittstelle (api.arte.tv/api/emac), Videos und
// Livestream über ARTEs Player-Schnittstelle (HLS, deutsche Fassung bevorzugt) im eigenen Player.
// Die ARTE-Webseite selbst lädt ihre Skripte nicht (media-rules.json).
(() => {
  if (!window.MediaApp) return;
  const EMAC = "https://api.arte.tv/api/emac/v4/de/web";
  const PLAYER = "https://api.arte.tv/api/player/v2/config/de";

  async function get(url) {
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(r.status === 429 ? "ARTE ist gerade überlastet, bitte gleich nochmal" : `HTTP ${r.status}`);
    // Fehler interner Abfragen setzt ARTE als Text mitten ins JSON („429 - Too Many Requests“): als leer lesen
    const text = (await r.text()).replace(/\n\d{3} - [^\n]*\n/g, "null");
    return JSON.parse(text);
  }
  const size = (img, w, h) => (img && img.url ? img.url.replace("__SIZE__", `${w}x${h}`) : "");

  function item(t) {
    if (!t || !t.programId || !t.kind || t.kind.code === "EXTERNAL") return null;
    const collection = !!t.kind.isCollection;
    return {
      id: t.programId,
      kind: collection ? "show" : "video",
      title: t.title || "",
      sub: t.subtitle || t.kind.label || "",
      desc: t.shortDescription || t.teaserText || "",
      img: size(t.mainImage, 640, 360),
      poster: size(t.mainImage, 400, 600),
      duration: typeof t.duration === "number" ? t.duration : 0,
    };
  }
  function sections(page) {
    const out = [];
    for (const z of page.zones || []) {
      const data = (z.content && z.content.data) || [];
      const items = data.map(item).filter(Boolean);
      if (!items.length) continue;
      const sec = { title: z.title || "", layout: /portrait/.test(z.displayOptions?.template || "") ? "poster" : "wide", items };
      let next = z.content.pagination?.links?.next;
      if (next) {
        sec.more = async () => {
          if (!next) return [];
          const d = await get(next);
          next = d.pagination?.links?.next || null;
          return (d.data || []).map(item).filter(Boolean);
        };
      }
      out.push(sec);
    }
    return out;
  }

  /** deutsche Fassung bevorzugen (sonst Original mit deutschen Untertiteln, sonst die erste) */
  function pickStream(streams) {
    const label = (s) => `${s.versions?.[0]?.shortLabel || ""} ${s.versions?.[0]?.label || ""}`;
    return streams.find((s) => /^DE\b/.test(label(s)) && !/UT|Untertitel/i.test(label(s)))
      || streams.find((s) => /Deutsch/.test(label(s))) || streams[0];
  }

  const PAGES = { filme: "CIN", serien: "SER", dokus: "DOR" };

  MediaApp.start({
    id: "arte",
    name: "ARTE",
    logo: '<svg viewBox="0 0 130 40"><text x="0" y="31" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="32" fill="#fd5b2b">ARTE</text></svg>',
    accent: "#fd5b2b",
    openVideos: true,
    tabs: [
      { key: "home", label: "Start", icon: "home" },
      { key: "live", label: "Live", icon: "live" },
      { key: "filme", label: "Filme", icon: "movie" },
      { key: "serien", label: "Serien", icon: "series" },
      { key: "dokus", label: "Dokus", icon: "doc" },
      { key: "search", label: "Suche", icon: "search", search: true },
    ],
    async load(tab) {
      if (tab === "live") {
        const c = await get(`${PLAYER}/LIVE`);
        const m = c.data?.attributes?.metadata || {};
        return { sections: [{ title: "Jetzt live", layout: "wide", items: [{
          id: "LIVE", kind: "live", title: "ARTE", sub: m.title || "", desc: m.description || "",
          img: m.images?.[0]?.url || "",
        }] }] };
      }
      const page = await get(`${EMAC}/pages/${tab === "home" ? "HOME" : PAGES[tab]}/`);
      return { sections: sections(page) };
    },
    async search(term) {
      const page = await get(`${EMAC}/pages/SEARCH/?query=${encodeURIComponent(term)}`);
      return { sections: sections(page) };
    },
    async open(it) {
      const page = await get(`${EMAC}/pages/${it.id}/`).catch(() => null);
      const meta = page?.metadata || {};
      const secs = page ? sections(page).map((s) => ({ ...s, items: s.items.filter((x) => x.id !== it.id) })) : [];
      if (it.kind === "show") {
        if (secs.length && secs[0].items.length > 4) secs[0].grid = true;
        return { title: meta.title || it.title, sub: it.sub, desc: meta.description || it.desc,
          img: size(meta.images?.[0], 1280, 720) || it.img, sections: secs };
      }
      return {
        title: meta.title || it.title, sub: meta.subtitle || it.sub,
        meta: [it.duration ? MediaApp.minutes(it.duration) : ""].filter(Boolean),
        desc: meta.description || it.desc,
        img: size(meta.images?.[0], 1280, 720) || it.img,
        play: { ...it, play: true },
        sections: secs,
      };
    },
    async stream(it) {
      const c = await get(`${PLAYER}/${it.id}`);
      const a = c.data?.attributes || {};
      if (a.error) throw new Error(a.error.title || a.error.message || "nicht verfügbar");
      const streams = a.streams || [];
      if (!streams.length) throw new Error(a.restriction?.message || "nicht verfügbar");
      const s = pickStream(streams);
      const m = a.metadata || {};
      return { url: s.url, type: "hls", live: !!a.live || it.kind === "live",
        title: [m.title, m.subtitle].filter(Boolean).join(" – ") || it.title };
    },
  });
})();
