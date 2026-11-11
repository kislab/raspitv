// Apple Music (music.apple.com) mit der Fernbedienung – und so sparsam, dass der Pi mitkommt.
//
// Die Webseite bleibt sichtbar (anders als bei Netflix & Co. keine eigene Oberfläche); tv.js wählt
// Elemente mit den Pfeiltasten an. Hier: Kleinkram ausblenden, den die Fernbedienung nicht braucht
// (Play-Knöpfe auf den Covern, „…“-Menüs, doppelte Titel-Links), im inneren Scrollbereich der Seite
// mitscrollen und Play/Pause der Fernbedienung an den Player der Seite geben.
// Leistung: applemusic-tv.css (keine Unschärfe, keine Übergänge, Reihen außerhalb nicht zeichnen).
(() => {
  if (!window.TV) return;
  document.documentElement.classList.add("tv-am");

  const SKIP = [
    ".play-button",                 // Play-Knopf auf dem Cover (OK auf der Karte öffnet sie)
    ".contextual-menu__trigger",    // „…“-Menü
    ".more-button",
    ".product-lockup__title",       // Titel-Link unter dem Cover führt zum selben Ziel
    ".product-lockup__subtitle a",
    ".track-lockup__subtitle a",    // Song-Zeile: Interpret-Link (ein Schritt pro Zeile, OK spielt den Song)
    ".songs-list-row *",            // Zeile in Album-/Playlist-Tabellen: die ganze Zeile ist ein Schritt
    ".shelf-grid-nav__arrow",
    ".native-cta__button",          // „In Musik öffnen“ (startet die App auf Mac/iPhone)
    "footer",                       // Rechtliches, Sprachwahl (würde auf Englisch umstellen)
    ".banner",                      // Abo-Werbung unten am Rand (fängt sonst den Fokus beim Navigieren)
  ].join(",");

  // Die Seite scrollt nicht das Fenster, sondern #scrollable-page: gewähltes Element dort sichtbar halten.
  function reveal(el) {
    const page = document.getElementById("scrollable-page");
    if (!page || !page.contains(el)) return;
    const r = el.getBoundingClientRect();
    const box = page.getBoundingClientRect();
    const margin = 120;
    if (r.top < box.top + margin || r.bottom > box.bottom - margin) {
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    } else {
      // nur waagrecht in der Reihe nachziehen
      const row = el.closest(".shelf-grid__body, .shelf-grid__list, ul");
      const rr = row && row.getBoundingClientRect();
      if (rr && (r.left < rr.left || r.right > rr.right)) el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    }
  }

  // Anmelden/Abo: Apple zeigt das in einem eingebetteten Fenster (gleiche Domain) über der Seite.
  // Navigation dorthin begrenzen; Zurück schließt es.
  function overlay() {
    for (const frame of document.querySelectorAll("iframe[src*='/includes/commerce/']")) {
      const r = frame.getBoundingClientRect();
      if (r.width < 200 || r.height < 200) continue;
      let doc = null;
      try { doc = frame.contentDocument; } catch (e) { /* fremde Domain */ }
      const modal = doc && doc.querySelector(".cc-modal, [role=dialog]");
      if (modal) return modal;
    }
    return null;
  }

  /** Im Anmeldedialog zuerst ins Textfeld, sonst auf den Haupt-Knopf (statt aufs X). */
  function overlayStart() {
    const modal = overlay();
    return modal && (modal.querySelector("input:not([type=hidden]):not([disabled])") ||
      modal.querySelector(".button-elevated, button[type=submit]"));
  }

  function back() {
    const modal = overlay();
    const close = modal && modal.ownerDocument.querySelector(".cc-modal__close-button, button[aria-label='Schließen']");
    if (!close) return false;
    close.click();
    return true;
  }

  // ◀ am linken Rand des Inhalts: in die Seitenleiste (statt zu „Anmelden“ ganz unten); ▶ von dort zurück
  function move(dir, from) {
    const page = document.getElementById("scrollable-page");
    const nav = document.querySelector(".navigation");
    if (dir === "right" && from.closest(".songs-list-row")) return true; // rechts neben einer Zeile ist nichts
    if (dir === "left" && page && page.contains(from)) {
      const item = nav && (nav.querySelector(".navigation-item--selected a, a[aria-current]") || nav.querySelector(".navigation-item__link"));
      if (item) return TV.focus(item), true;
    }
    if (dir === "right" && nav && nav.contains(from)) {
      const first = TV.site.initial();
      if (first) return TV.focus(first), true;
    }
    return false;
  }

  // Play/Pause der Fernbedienung: Knopf in der Player-Leiste der Seite
  function playPause() {
    const host = document.querySelector("amp-playback-controls-play");
    const button = host && (host.shadowRoot?.querySelector("button") || host.querySelector("button") || host);
    if (!button) return false;
    button.click();
    return true;
  }

  // OK auf einer Song-Zeile spielt den Song, statt die Albumseite zu öffnen bzw. die Zeile nur zu markieren.
  // Nur für Klicks der Fernbedienung (tv.js klickt per el.click(), das ist nicht „isTrusted“).
  document.addEventListener("click", (event) => {
    if (event.isTrusted || !event.target.closest || event.target.closest(".play-button")) return;
    const row = event.target.closest(".track-lockup a, .songs-list-row");
    const play = row && row.closest(".track-lockup, .songs-list-row").querySelector(".play-button");
    if (!play) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    play.click();
  }, true);

  Object.assign(TV.site, {
    skip: (el) => !!el.closest(SKIP),
    scope: overlay,
    back,
    move,
    reveal,
    playPause,
    // erstes Element: Inhalt statt Seitenleiste
    initial: () => overlayStart() ||
      document.querySelector("#scrollable-page .product-lockup__link") ||
      document.querySelector("#scrollable-page main :is(a[href], button):not(footer *)") ||
      document.querySelector(".navigation-item--selected a, .navigation a[aria-current]"),
  });
})();
