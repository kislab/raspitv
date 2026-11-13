// Pluto TV: Adapter für media-app.js. Pluto ist kostenlos und ohne Anmeldung: eine anonyme Sitzung von
// boot.pluto.tv liefert den Schlüssel für Senderliste, Programm, Filme/Serien und die HLS-Streams (mit Werbung).
// Die Pluto-Webseite selbst lädt ihre Skripte nicht (media-rules.json).
(() => {
  if (!window.MediaApp) return;

  let clientId = "";
  try {
    clientId = localStorage.getItem("tvm-pluto-client") || crypto.randomUUID();
    localStorage.setItem("tvm-pluto-client", clientId);
  } catch (e) { clientId = crypto.randomUUID(); }

  let session = null, sessionAt = 0;
  async function boot() {
    if (session && Date.now() - sessionAt < (session.refreshInSec || 3600) * 900) return session;
    const q = new URLSearchParams({ appName: "web", appVersion: "9.0.0", deviceVersion: "130", deviceModel: "web",
      deviceMake: "chrome", deviceType: "web", clientID: clientId, clientModelNumber: "1.0.0", serverSideAds: "false",
      drmCapabilities: "widevine:L3" });
    const r = await fetch(`https://boot.pluto.tv/v4/start?${q}`);
    if (!r.ok) throw new Error(`Anmeldung bei Pluto ging nicht (HTTP ${r.status})`);
    session = await r.json();
    sessionAt = Date.now();
    return session;
  }
  async function get(url) {
    const s = await boot();
    const r = await fetch(url, { headers: { Authorization: `Bearer ${s.sessionToken}` } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  const CH = "https://service-channels.clusters.pluto.tv";
  const VOD = "https://service-vod.clusters.pluto.tv";

  const cover = (covers, ratio) => (covers || []).find((c) => c.aspectRatio === ratio)?.url || "";
  function vodItem(v) {
    if (!v || !(v._id || v.id)) return null;
    const series = v.type === "series";
    return {
      id: v._id || v.id,
      kind: series ? "show" : "video",
      title: v.name || "",
      sub: [v.genre, v.rating && v.rating !== "no rating" ? `ab ${v.rating}` : ""].filter(Boolean).join(" · "),
      desc: v.description || v.summary || "",
      img: cover(v.covers, "16:9") || v.featuredImage?.path || cover(v.covers, "4:3"),
      poster: cover(v.covers, "347:500") || cover(v.covers, "16:9"),
      duration: v.duration ? Math.round(v.duration / 1000) : 0,
    };
  }

  async function live() {
    const start = new Date(Date.now() - 5 * 60000).toISOString();
    const [chans, cats, times] = await Promise.all([
      get(`${CH}/v2/guide/channels?channelIds=&offset=0&limit=1000&sort=number%3Aasc`),
      get(`${CH}/v2/guide/categories`),
      get(`${CH}/v2/guide/timelines?channelIds=&start=${encodeURIComponent(start)}&duration=60`).catch(() => ({ data: [] })),
    ]);
    const now = Date.now();
    const current = {};
    for (const t of times.data || []) {
      const cur = (t.timelines || []).find((x) => new Date(x.start) <= now && now < new Date(x.stop));
      if (cur) current[t.channelId] = cur;
    }
    const byCat = new Map((cats.data || []).map((c) => [c.id, { title: c.name, items: [] }]));
    for (const c of chans.data || []) {
      const cur = current[c.id];
      const img = (c.images || []).find((i) => i.type === "featuredImage")?.url || cur?.episode?.poster?.path ||
        (c.images || []).find((i) => i.style === "wide")?.url || "";
      const it = { id: c.id, kind: "live", title: c.name, sub: cur?.title || "", desc: cur?.episode?.description && cur.episode.description !== "no info available" ? cur.episode.description : c.summary || "", img };
      const cat = byCat.get((c.categoryIDs || [])[0]);
      if (cat) cat.items.push(it);
    }
    return { sections: [...byCat.values()].filter((c) => c.items.length).map((c) => ({ title: c.title, layout: "wide", items: c.items })) };
  }

  async function ondemand() {
    const d = await get(`${VOD}/v4/vod/categories?includeItems=true&offset=0&page=1&limit=40`);
    return { sections: (d.categories || []).map((c) => ({
      title: c.name, layout: /Hero/i.test(c.name) ? "wide" : "poster", items: (c.items || []).map(vodItem).filter(Boolean),
    })) };
  }

  MediaApp.start({
    id: "pluto",
    name: "Pluto TV",
    logo: '<svg viewBox="0 0 170 40"><text x="0" y="30" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="30" fill="#fff200">pluto tv</text></svg>',
    accent: "#2c3ee8",
    openVideos: true,
    tabs: [
      { key: "live", label: "Live-TV", icon: "live" },
      { key: "vod", label: "Filme & Serien", icon: "movie" },
      { key: "search", label: "Suche", icon: "search", search: true },
    ],
    async load(tab) {
      return tab === "live" ? live() : ondemand();
    },
    async search(term) {
      const d = await get(`https://service-media-search.clusters.pluto.tv/v1/search?q=${encodeURIComponent(term)}&limit=60`);
      const hits = (d.data || []).filter((x) => x.type === "movie" || x.type === "series");
      // Suchtreffer haben keine Bilder: vollständige Angaben in einem Rutsch nachladen
      const full = hits.length ? await get(`${VOD}/v4/vod/items?ids=${hits.map((x) => x.id).join(",")}`).catch(() => []) : [];
      const byId = new Map((Array.isArray(full) ? full : []).map((x) => [x._id || x.id, x]));
      const items = hits.map((x) => vodItem({ ...x, ...(byId.get(x.id) || {}), _id: x.id })).filter(Boolean);
      return { sections: [{ title: "Ergebnisse", layout: "wide", items }] };
    },
    async open(it) {
      if (it.kind === "show") {
        const s = await get(`${VOD}/v4/vod/series/${it.id}/seasons?offset=1000&page=1`);
        const secs = (s.seasons || []).map((se) => ({
          title: `Staffel ${se.number}`, layout: "wide",
          items: (se.episodes || []).map((e) => ({ ...vodItem({ ...e, type: "episode" }), sub: `Folge ${e.number}`, play: true })).filter(Boolean),
        }));
        return { title: s.name || it.title, sub: it.sub, desc: s.description || it.desc,
          img: s.featuredImage?.path || it.img, sections: secs };
      }
      return { title: it.title, sub: it.sub, meta: [it.duration ? MediaApp.minutes(it.duration) : ""].filter(Boolean),
        desc: it.desc, img: it.img, play: { ...it, play: true }, sections: [] };
    },
    async stream(it) {
      const s = await boot();
      const what = it.kind === "live" ? "channel" : "episode";
      const url = `${s.servers.stitcher}/v2/stitch/hls/${what}/${it.id}/master.m3u8?${s.stitcherParams}&jwt=${s.sessionToken}&masterJWTPassthrough=true`;
      return { url, type: "hls", live: it.kind === "live", title: it.kind === "live" && it.sub ? `${it.title} – ${it.sub}` : it.title };
    },
  });
})();
