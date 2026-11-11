// Apple Music, Seiten-Kontext (MAIN world): Warteschlange aus MusicKit lesen und zu einem Titel springen.
// applemusic-tv.js fragt per postMessage {tvam: "queue?"} und bekommt {tvam: "queue", position, items}.
(() => {
  const player = () => window.MusicKit?.getInstance?.();
  const art = (url) => (url || "").replace("{w}", "240").replace("{h}", "240").replace("{f}", "jpg");
  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || typeof event.data.tvam !== "string") return;
    const mk = player();
    if (!mk) return;
    if (event.data.tvam === "queue?") {
      const q = mk.queue;
      const position = q ? q.position : -1;
      const items = (q?.items || []).map((item, index) => ({
        index, title: item.title || "", artist: item.artistName || "", art: art(item.artworkURL || item.attributes?.artwork?.url),
      })).slice(Math.max(position + 1, 0), position + 41);
      window.postMessage({ tvam: "queue", position, items }, "*");
    } else if (event.data.tvam === "jump" && Number.isInteger(event.data.index)) {
      mk.changeToMediaAtIndex(event.data.index).catch(() => {});
    }
  });
})();
