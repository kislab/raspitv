// ZDF: Adapter für media-app.js. Inhalte aus der App-Schnittstelle des ZDF (zdf-prod-futura.zdf.de/mediathekV2),
// Videos als MP4 (bis 1080p) bzw. HLS (Livestreams) im eigenen Player, Untertitel als WebVTT.
// Die ZDF-Webseite selbst lädt ihre Skripte nicht (media-rules.json).
(() => {
  if (!window.MediaApp) return;
  const API = "https://zdf-prod-futura.zdf.de/mediathekV2";

  async function get(url) {
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  /** Bild mit passendem Seitenverhältnis aus teaserBild ({breite: {url, width, height}}) */
  function pic(bilder, ratio, width) {
    const list = Object.values(bilder || {}).filter((b) => b && b.url && b.width && b.height && Math.abs(b.width / b.height - ratio) < 0.05);
    list.sort((a, b) => a.width - b.width);
    return (list.find((b) => b.width >= width) || list[list.length - 1] || {}).url || "";
  }
  const dateDe = (s) => { // "12.11.2026 23:26" → "12.11.2026"
    const m = /^(\d+\.\d+\.\d+)/.exec(s || "");
    return m ? m[1] : "";
  };

  const PAGE_TYPES = new Set(["brand", "category", "topic", "brandsAlphabetical"]);
  function item(t) {
    if (!t || !t.url || !/^https:\/\/zdf-prod-futura/.test(t.url)) return null;
    const kind = t.type === "livevideo" ? "live" : t.type === "video" ? "video" : PAGE_TYPES.has(t.type) ? "show" : null;
    if (!kind) return null;
    return {
      id: t.id,
      kind,
      title: t.titel || t.headline || "",
      sub: [t.headline && t.headline !== t.titel ? t.headline : "", t.channel].filter(Boolean).join(" · "),
      meta: dateDe(t.date || t.visibleFrom),
      desc: t.beschreibung || "",
      img: pic(t.teaserBild, 16 / 9, 640),
      poster: pic(t.teaserBild, 3 / 4, 400) || pic(t.teaserBild, 2 / 3, 400) || pic(t.teaserBild, 16 / 9, 640),
      duration: t.length || 0,
      href: t.url,
    };
  }
  function sections(clusters) {
    const out = [];
    for (const c of clusters || []) {
      const items = (c.teaser || []).map(item).filter(Boolean);
      if (!items.length) continue;
      out.push({ title: c.name || "", layout: c.type === "teaserPoster" ? "poster" : "wide", items });
    }
    return out;
  }

  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const parseDe = (s) => { // "13.11.2026 05:30"
    const m = /^(\d+)\.(\d+)\.(\d+) (\d+):(\d+)/.exec(s || "");
    return m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]) : null;
  };
  let liveCache = null;
  async function live() {
    const d = await get(`${API}/live-tv/${today()}`);
    const now = new Date();
    liveCache = {};
    const items = (d.epgCluster || []).map((c) => {
      const ls = c.liveStream || {};
      const cur = (c.teaser || []).find((t) => { const a = parseDe(t.airtime), b = parseDe(t.airtimeEnd); return a && b && a <= now && now < b; }) || {};
      const id = `live-${c.name}`;
      liveCache[id] = ls.formitaeten || [];
      return {
        id, kind: "live", title: c.name, sub: cur.titel || "", desc: cur.beschreibung || "",
        img: pic(cur.teaserBild, 16 / 9, 640) || pic(ls.teaserBild, 16 / 9, 640),
      };
    });
    return { sections: [{ title: "Jetzt live", layout: "wide", items }] };
  }

  /** beste Quelle: MP4 bis 1080p, sonst HLS */
  function source(formitaeten, live) {
    const f = (formitaeten || []).filter((x) => (x.class || "main") === "main" && (!x.language || x.language === "deu"));
    const order = ["fhd", "hd", "veryhigh", "high", "med", "low"];
    const mp4 = f.filter((x) => /mp4_http/.test(x.type)).sort((a, b) => order.indexOf(a.quality) - order.indexOf(b.quality))[0];
    const hls = f.find((x) => /m3u8/.test(x.type) && x.quality === "auto") || f.find((x) => /m3u8/.test(x.type));
    if (!live && mp4) return { url: mp4.url, type: "mp4" };
    if (hls) return { url: hls.url, type: "hls" };
    if (mp4) return { url: mp4.url, type: "mp4" };
    return null;
  }

  const DOCS = { filme: "filme-104", serien: "serien-100", dokus: "doku-wissen-104", krimi: "krimi-102", az: "sendungen-100" };

  MediaApp.start({
    id: "zdf",
    name: "ZDF",
    logo: '<svg viewBox="0 0 120 40"><text x="0" y="31" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="34" fill="#fa7d19">ZDF</text></svg>',
    accent: "#fa7d19",
    openVideos: true,
    tabs: [
      { key: "home", label: "Start", icon: "home" },
      { key: "live", label: "Live", icon: "live" },
      { key: "filme", label: "Filme", icon: "movie" },
      { key: "serien", label: "Serien", icon: "series" },
      { key: "krimi", label: "Krimi", icon: "doc" },
      { key: "dokus", label: "Dokus", icon: "doc" },
      { key: "az", label: "A–Z", icon: "grid" },
      { key: "search", label: "Suche", icon: "search", search: true },
    ],
    async load(tab) {
      if (tab === "live") return live();
      if (tab === "home") {
        const d = await get(`${API}/start-page`);
        const stage = (d.stage || []).map(item).filter(Boolean);
        return { sections: [{ title: "", layout: "wide", items: stage }, ...sections(d.cluster)] };
      }
      const d = await get(`${API}/document/${DOCS[tab]}`);
      return { sections: sections(d.cluster) };
    },
    async search(term) {
      const d = await get(`${API}/search?q=${encodeURIComponent(term)}`);
      const all = (d.results || []).map(item).filter(Boolean);
      return { sections: [
        { title: "Sendungen", layout: "wide", items: all.filter((x) => x.kind === "show") },
        { title: "Videos", layout: "wide", items: all.filter((x) => x.kind !== "show") },
      ] };
    },
    async open(it) {
      const d = await get(it.href);
      const doc = d.document || {};
      const secs = sections(d.cluster);
      if (it.kind === "show") {
        return {
          title: doc.titel || it.title, sub: doc.headline || "", desc: doc.beschreibung || d.shortText?.text || it.desc,
          img: pic(doc.teaserBild, 16 / 9, 1280) || it.img, sections: secs,
        };
      }
      return {
        title: doc.titel || it.title,
        sub: doc.headline && doc.headline !== doc.titel ? doc.headline : "",
        meta: [doc.channel, doc.length ? MediaApp.minutes(doc.length) : "", dateDe(doc.date),
          doc.timetolive ? `verfügbar bis ${dateDe(doc.timetolive)}` : ""].filter(Boolean),
        desc: doc.beschreibung || it.desc,
        img: pic(doc.teaserBild, 16 / 9, 1280) || it.img,
        play: { ...it, play: true },
        sections: secs.map((s) => ({ ...s, items: s.items.filter((x) => x.id !== it.id) })),
      };
    },
    async stream(it) {
      if (it.kind === "live") {
        if (!liveCache || !liveCache[it.id]) await live();
        const s = source(liveCache[it.id], true);
        if (!s) throw new Error("kein Livestream");
        return { ...s, live: true, title: `${it.title}${it.sub ? ` – ${it.sub}` : ""}` };
      }
      const d = await get(it.href);
      const doc = d.document || {};
      if (doc.fsk && /fsk18|fsk16/.test(doc.fsk) && !doc.formitaeten?.length) throw new Error("Erst abends verfügbar (Jugendschutz)");
      const s = source(doc.formitaeten, false);
      if (!s) throw new Error("kein abspielbares Video");
      const vtt = (doc.captions || []).find((c) => c.format === "webvtt");
      return { ...s, title: doc.titel || it.title, subtitles: vtt?.uri || null };
    },
  });
})();
