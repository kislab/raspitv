// Apple Music, Seiten-Kontext (MAIN world): Brücke zu MusicKit für die eigene TV-Oberfläche (applemusic-app.js)
// und für „Jetzt läuft“ im einfachen Modus (applemusic-tv.js).
//
// Anfragen (postMessage vom Inhalts-Skript):   {tvam: "req", id, op, args}
// Antworten:                                   {tvam: "res", id, ok, data | error}
// Player-Zustand (bei Änderung, höchstens 2×/s): {tvam: "state", state}
// Alt (einfacher Modus): {tvam: "queue?"} -> {tvam: "queue", position, items}; {tvam: "jump", index}
(() => {
  const player = () => window.MusicKit?.getInstance?.();
  const art = (url, size = 240) => (url || "").replace("{w}", size).replace("{h}", size).replace("{f}", "jpg").replace("{c}", "");

  function item(it, index) {
    const a = it?.attributes || {};
    return {
      index, id: it?.id, type: it?.type,
      title: it?.title || a.name || "", artist: it?.artistName || a.artistName || "", album: it?.albumName || a.albumName || "",
      art: art(it?.artworkURL || a.artwork?.url, 600),
    };
  }

  function state() {
    const mk = player();
    if (!mk) return null;
    const now = mk.nowPlayingItem;
    return {
      authorized: !!mk.isAuthorized,
      item: now ? item(now, mk.queue?.position ?? -1) : null,
      playing: mk.playbackState === 2 || mk.isPlaying === true,
      pos: mk.currentPlaybackTime || 0,
      dur: mk.currentPlaybackDuration || (now?.playbackDuration || 0) / 1000,
      position: mk.queue?.position ?? -1,
      length: mk.queue?.items?.length || 0,
      shuffle: mk.shuffleMode === 1,
    };
  }

  let lastSent = "", pending = null;
  function pushState() {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      const s = state();
      const json = JSON.stringify(s);
      if (json === lastSent) return;
      lastSent = json;
      window.postMessage({ tvam: "state", state: s }, "*");
    }, 400);
  }

  const ops = {
    async auth() {
      const mk = player();
      return { authorized: !!mk?.isAuthorized, storefront: mk?.storefrontId || "de" };
    },
    async api({ path, params }) {
      const r = await player().api.music(path, params || {});
      return r.data;
    },
    // queue: z. B. {album: id} | {playlist: id} | {songs: [ids]} | {station: id}; startWith: Index
    async play({ queue, startWith, shuffle }) {
      const mk = player();
      mk.shuffleMode = shuffle ? 1 : 0;
      await mk.setQueue({ ...queue, startWith: startWith || 0, startPlaying: true });
      if (!mk.isPlaying) await mk.play().catch(() => {});
      return true;
    },
    async control({ action, value }) {
      const mk = player();
      if (action === "toggle") return mk.isPlaying ? mk.pause() : mk.play();
      if (action === "next") return mk.skipToNextItem();
      if (action === "prev") return mk.currentPlaybackTime > 4 ? mk.seekToTime(0) : mk.skipToPreviousItem();
      if (action === "seek") return mk.seekToTime(Math.max(0, (mk.currentPlaybackTime || 0) + value));
      if (action === "jump") return mk.changeToMediaAtIndex(value);
      return null;
    },
    async queue() {
      const mk = player();
      const q = mk.queue;
      const position = q ? q.position : -1;
      return { position, items: (q?.items || []).map(item).slice(Math.max(position + 1, 0), position + 41) };
    },
    async state() { return state(); },
  };

  window.addEventListener("message", async (event) => {
    if (event.source !== window || !event.data || typeof event.data.tvam !== "string") return;
    const msg = event.data;
    const mk = player();
    if (msg.tvam === "req") {
      try {
        if (!mk && msg.op !== "auth") throw new Error("MusicKit nicht bereit");
        const data = await ops[msg.op](msg.args || {});
        window.postMessage({ tvam: "res", id: msg.id, ok: true, data }, "*");
      } catch (error) {
        window.postMessage({ tvam: "res", id: msg.id, ok: false, error: String(error?.message || error) }, "*");
      }
    } else if (msg.tvam === "queue?" && mk) {
      const data = await ops.queue();
      window.postMessage({ tvam: "queue", ...data }, "*");
    } else if (msg.tvam === "jump" && mk && Number.isInteger(msg.index)) {
      mk.changeToMediaAtIndex(msg.index).catch(() => {});
    }
  });

  // Ereignisse von MusicKit anmelden, sobald es geladen ist
  (function hook() {
    const mk = player();
    if (!mk) return setTimeout(hook, 500);
    for (const name of ["playbackStateDidChange", "nowPlayingItemDidChange", "queueItemsDidChange",
      "queuePositionDidChange", "playbackTimeDidChange", "authorizationStatusDidChange", "shuffleModeDidChange"]) {
      try { mk.addEventListener(name, pushState); } catch (e) { /* ältere MusicKit-Version */ }
    }
    pushState();
  })();
})();
