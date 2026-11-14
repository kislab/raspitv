// YouTube: Einfrieren nach wenigen Sekunden verhindern.
//
// Wechselt YouTube mitten im laufenden Video die Auflösung (z. B. 360p → 720p), bleibt der Hardware-Decoder des
// Pi 4 (V4L2) stehen: das Bild friert ein, die Zeit läuft nicht weiter, obwohl genug geladen ist.
// 1. Qualität je Video festlegen (höchste verfügbare bis 1080p) – so früh wie möglich, damit danach nichts mehr
//    wechselt. Beim allerersten Video nach dem Öffnen läuft es aber oft schon in niedriger Qualität los.
// 2. Wächter: Steht das Video trotz Puffer still, einmal an dieselbe Stelle springen – das setzt den Decoder neu
//    auf, und es geht sofort weiter (getestet: 360p → 720p eingefroren, nach dem Sprung läuft 720p).
// Läuft in der Seite selbst (MAIN), weil nur dort die Player-Schnittstelle erreichbar ist.
(() => {
  const ORDER = ["hd1080", "hd720", "large", "medium", "small", "tiny"]; // höchstens 1080p (media-limit.js)
  let lockedFor = "";

  function lock() {
    const p = document.querySelector("#movie_player, .html5-video-player");
    if (!p || !p.getAvailableQualityLevels || !p.setPlaybackQualityRange || !p.getVideoData) return;
    const id = (p.getVideoData() || {}).video_id || "";
    if (!id || id === lockedFor) return;
    const levels = p.getAvailableQualityLevels() || [];
    const best = ORDER.find((q) => levels.includes(q));
    if (!best) return; // Formate noch nicht bekannt – gleich noch einmal
    lockedFor = id;
    p.setPlaybackQualityRange(best, best);
  }

  let last = { time: -1, frames: -1, since: 0 };
  let nudgedAt = 0;
  function watch() {
    const v = document.querySelector("video");
    if (!v || v.paused || v.ended || v.seeking || !v.src) { last.since = 0; return; }
    const frames = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality().totalVideoFrames : 0;
    const now = performance.now();
    if (v.currentTime !== last.time || frames !== last.frames) {
      last = { time: v.currentTime, frames, since: now };
      return;
    }
    // steht still: nur eingreifen, wenn genug geladen ist (sonst lädt es einfach noch)
    let ahead = 0;
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= v.currentTime + 0.1 && v.buffered.end(i) > v.currentTime) {
        ahead = v.buffered.end(i) - v.currentTime;
      }
    }
    if (ahead > 1 && now - last.since > 1500 && now - nudgedAt > 4000) {
      nudgedAt = now;
      last.since = now;
      v.currentTime = v.currentTime; // Decoder neu aufsetzen
    }
  }

  setInterval(() => { lock(); watch(); }, 250);
})();
