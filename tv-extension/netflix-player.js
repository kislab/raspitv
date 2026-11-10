// Läuft im Kontext der Netflix-Seite (nicht der Erweiterung), weil nur dort die
// Player-Schnittstelle von Netflix erreichbar ist. Empfängt Fernbedienungs-Tasten von netflix.js
// und zeigt dazu eine Bedienleiste wie in der Netflix-TV-App.
(() => {
  const SKIP = [
    "[data-uia='player-skip-intro']",
    "[data-uia='player-skip-recap']",
    "[data-uia='player-skip-preplay']",
    "[data-uia^='next-episode-seamless-button']",
  ].join(",");
  const SEEK_MS = 10000;
  const ICON_PLAY = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M7 4l13 8-13 8z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';

  function player() {
    const api = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
    return api.getVideoPlayerBySessionId(api.getAllPlayerSessionIds()[0]);
  }

  // ---------- Bedienleiste ----------

  let bar = null;
  let skipPill = null;
  let hideTimer = null;

  function build() {
    bar = document.createElement("div");
    bar.id = "tv-player-bar";
    bar.innerHTML = `
      <div class="tv-pb-titles"><div class="tv-pb-title"></div><div class="tv-pb-sub"></div></div>
      <div class="tv-pb-row">
        <div class="tv-pb-icon"></div>
        <div class="tv-pb-time tv-pb-now"></div>
        <div class="tv-pb-track"><div class="tv-pb-fill"></div><div class="tv-pb-knob"></div></div>
        <div class="tv-pb-time tv-pb-left"></div>
      </div>
      <div class="tv-pb-hint"></div>`;
    skipPill = document.createElement("div");
    skipPill.id = "tv-skip";
    document.documentElement.append(bar, skipPill);
  }

  const clock = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(sec).padStart(2, "0")}`;
  };

  function state() {
    try {
      const p = player();
      return { time: p.getCurrentTime(), duration: p.getDuration(), paused: p.isPaused() };
    } catch (error) {
      const v = document.querySelector("video");
      return v ? { time: v.currentTime * 1000, duration: v.duration * 1000, paused: v.paused } : null;
    }
  }

  /** [Titel, Folge] aus den Metadaten des Netflix-Players. */
  function metaTitles() {
    try {
      const id = location.pathname.split("/")[2];
      const all = window.netflix.appContext.state.playerApp.getState().videoPlayer.videoMetadata;
      const video = (all[id] || Object.values(all)[0])._metadataObject.video;
      for (const season of video.seasons || []) {
        const ep = (season.episodes || []).find((e) => String(e.id || e.episodeId) === id);
        if (ep) return [video.title, `St. ${season.seq}, F. ${ep.seq}  „${ep.title}“`];
      }
      return video.title ? [video.title, ""] : null;
    } catch (error) {
      return null;
    }
  }

  /** [Titel, Folge] – aus Netflix' Daten, sonst von der eigenen Oberfläche beim Start gemerkt. */
  function titles() {
    const meta = metaTitles();
    if (meta) return meta;
    const stored = sessionStorage.getItem("raspitv-title");
    if (stored) {
      const [main, ...rest] = stored.split(" · ");
      return [main, rest.join(" · ")];
    }
    const el = document.querySelector("[data-uia='video-title']");
    if (el) {
      const parts = [...el.querySelectorAll("h4, span")].map((e) => e.textContent.trim()).filter(Boolean);
      if (parts.length) return [parts[0], parts.slice(1).join(" · ")];
    }
    return [document.title.replace(/\s*[–-]\s*Netflix\s*$/, ""), ""];
  }

  function render(hint) {
    const s = state();
    if (!s) return;
    if (!bar) build();
    const ratio = s.duration > 0 ? Math.min(1, s.time / s.duration) : 0;
    const [main, sub] = titles();
    bar.querySelector(".tv-pb-title").textContent = main;
    bar.querySelector(".tv-pb-sub").textContent = sub;
    bar.querySelector(".tv-pb-icon").innerHTML = s.paused ? ICON_PLAY : ICON_PAUSE;
    bar.querySelector(".tv-pb-fill").style.width = `${ratio * 100}%`;
    bar.querySelector(".tv-pb-knob").style.left = `${ratio * 100}%`;
    bar.querySelector(".tv-pb-now").textContent = clock(s.time);
    const left = Math.max(0, s.duration - s.time);
    bar.querySelector(".tv-pb-left").textContent = left >= 60000 ? `noch ${Math.round(left / 60000)} Min.` : `noch ${clock(left)}`;
    bar.querySelector(".tv-pb-hint").textContent = hint || (s.paused ? "Pausiert – OK zum Fortsetzen" : "");
    bar.classList.add("tv-pb-show");
    bar.classList.toggle("tv-pb-paused", s.paused);
    clearTimeout(hideTimer);
    if (!s.paused) hideTimer = setTimeout(() => bar.classList.remove("tv-pb-show"), 4000);
  }

  // "Intro überspringen" / "Nächste Folge" als gut sichtbarer Knopf, solange Netflix ihn anbietet
  function updateSkip() {
    if (!skipPill) build();
    const skip = location.pathname.startsWith("/watch") && document.querySelector(SKIP);
    const label = skip ? skip.textContent.trim() || "Überspringen" : "";
    skipPill.classList.toggle("tv-skip-show", !!skip);
    if (skip && skipPill.dataset.label !== label) {
      skipPill.dataset.label = label;
      skipPill.innerHTML = `<span class="tv-skip-ok">OK</span><span></span>`;
      skipPill.lastChild.textContent = label;
    }
  }

  setInterval(() => {
    const watching = location.pathname.startsWith("/watch");
    // Während die Leiste sichtbar ist, Zeit laufend aktualisieren
    if (bar && bar.classList.contains("tv-pb-show") && watching) render(bar.querySelector(".tv-pb-hint").textContent);
    if (bar && !watching) bar.classList.remove("tv-pb-show");
    updateSkip();
  }, 500);

  // ---------- Tasten ----------

  window.addEventListener("tv-player", (event) => {
    const key = event.detail;
    let hint = "";
    if (key === "ok") {
      const skip = document.querySelector(SKIP);
      if (skip) {
        skip.click(); // "Intro überspringen" / "Nächste Folge"
        return render(skip.textContent.trim());
      }
    }
    try {
      const p = player();
      if (key === "ok") p.isPaused() ? p.play() : p.pause();
      else if (key === "left") { p.seek(Math.max(0, p.getCurrentTime() - SEEK_MS)); hint = "« 10 Sekunden zurück"; }
      else if (key === "right") { p.seek(Math.min(p.getDuration() - 1000, p.getCurrentTime() + SEEK_MS)); hint = "10 Sekunden vor »"; }
    } catch (error) {
      // Schnittstelle nicht gefunden: wenigstens Pause/Weiter direkt am Video
      const video = document.querySelector("video");
      if (video && key === "ok") video.paused ? video.play() : video.pause();
    }
    setTimeout(() => render(hint), 150); // Netflix braucht einen Moment, bis der neue Zustand gilt
  });
})();
