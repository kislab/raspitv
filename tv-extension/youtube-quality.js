// YouTube: Qualität je Video festlegen (höchste verfügbare bis 1080p) statt sie YouTube automatisch wechseln
// zu lassen. Wechselt YouTube mitten im laufenden Video die Auflösung (z. B. 720p → 480p), bleibt der
// Hardware-Decoder des Pi 4 (V4L2) stehen: Bild friert nach wenigen Sekunden ein, „lädt“ dann ~30 s.
// Eine fest gewählte Qualität baut den Puffer dagegen sauber neu auf – danach wechselt nichts mehr.
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
  setInterval(lock, 300);
})();
