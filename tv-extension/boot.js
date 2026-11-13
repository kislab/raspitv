// Startschutz für Dienste mit eigener TV-Oberfläche (Netflix, Disney+, Spotify, Apple Music, Twitch):
// läuft ganz am Anfang (document_start) und verdeckt die Original-Seite sofort – statt ihrer ist ein Ladekreis
// in der Farbe des Dienstes zu sehen. Die App nimmt die Abdeckung weg, sobald ihre eigene Oberfläche steht
// (TVBoot.release) oder klar ist, dass die Seite selbst gezeigt werden soll (Anmeldung, Player).
(() => {
  if (window.top !== window) return;
  const ACCENT = { "www.netflix.com": "#e50914", "www.disneyplus.com": "#0072d2", "open.spotify.com": "#1ed760",
    "music.apple.com": "#fa2d48", "www.twitch.tv": "#9146ff" };
  const html = document.documentElement;
  html.classList.add("tv-boot");
  html.style.setProperty("--tv-boot-accent", ACCENT[location.hostname] || "#fff");
  let released = false, idle = 0;
  const release = () => {
    if (released) return;
    released = true;
    html.classList.remove("tv-boot");
  };
  window.TVBoot = {
    release,
    /** Die App zeigt (noch) nichts Eigenes: nach ~3 s doch die Seite freigeben (z. B. Anmeldeseite) */
    idle(ms = 400) {
      idle += ms;
      if (idle >= 3000) release();
    },
  };
  setTimeout(release, 20000); // Sicherheit: nie dauerhaft verdecken
})();
