// Netflix: Verhalten wie in der TV-App – Reihen mit Karussell, Detailansicht, Player.
// Selektoren beruhen auf den data-uia-Kennzeichnungen der Netflix-Seite (Stand November 2026).
(() => {
  if (!window.TV) return;
  document.documentElement.classList.add("tv-netflix");

  const ROW = "[data-uia^='carousel-row-section']";
  const CARD = "[data-uia='standard-card'], [data-uia='progress-card'], [data-uia='episodic-card'], [data-uia$='-card']";
  const DETAIL = "[data-uia='modal-motion-container-DETAIL_MODAL'], [data-uia*='DETAIL_MODAL'], [role=dialog][aria-modal=true]";
  const CLOSE = "[data-uia='previewModal-closebtn'], [data-uia*='close'][role=button], [role=dialog] button[aria-label*='chließen'], [role=dialog] button[aria-label*='lose']";
  const PLAY = "[data-uia='play-video-button'], [data-uia*='play-button']";
  const PROFILE = "[data-uia^='profile-selector+tile-'] a, [data-uia^='profile-selector+tile-'] button, [data-uia^='profile-selector+tile-'][role=button], [data-uia^='profile-selector+tile-']";
  const ROOTS = ["/browse", "/", "/login", "/de/", "/de/login", "/de-en/", "/de-en/login"];

  // Netflix hält versteckte Dialoge (0 × 0 Pixel) im Dokument – nur sichtbare zählen.
  const detail = () =>
    [...document.querySelectorAll(DETAIL)].find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 100 && r.height > 100;
    }) || null;

  // Erstes Element, das tatsächlich zu sehen ist (Netflix hat viele versteckte Doppel)
  const firstShown = (selector, root = document) =>
    [...root.querySelectorAll(selector)].find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 8 && r.height > 8 && r.bottom > 0 && r.top < innerHeight;
    }) || null;

  const cardsIn = (row) =>
    [...row.querySelectorAll(CARD)].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 8 && r.left >= -4 && r.right <= innerWidth + 4;
    });

  Object.assign(TV.site, {
    // Offene Detailansicht eines Titels: Navigation bleibt darin.
    scope: detail,

    // Erstes Element wie in der TV-App: "Abspielen" (Detailansicht oder Banner), sonst der erste Titel.
    initial: () => {
      const open = detail();
      return (
        firstShown(PLAY, open || document) ||
        (open ? null : firstShown(PROFILE) || firstShown(CARD))
      );
    },

    inPlayer: () => location.pathname.startsWith("/watch"),

    playerKey(key, fromKeyboard) {
      if (key === "back") {
        history.back();
        return true;
      }
      // Echte Tastatur: Netflix kann Pfeiltasten, Enter und Leertaste im Player selbst.
      if (fromKeyboard) return false;
      window.dispatchEvent(new CustomEvent("tv-player", { detail: key }));
      return true;
    },

    // Rand einer Titelreihe: Karussell weiterblättern und den neuen Randtitel wählen.
    move(dir, from) {
      const row = from.closest(ROW);
      const arrow = row?.querySelector(
        dir === "right" ? "[data-uia='carousel-hawkins-right-button']" : "[data-uia='carousel-hawkins-left-button']"
      );
      if (!arrow || !arrow.isConnected) return true; // Reihenanfang/-ende: stehen bleiben
      arrow.click();
      setTimeout(() => {
        const cards = cardsIn(row);
        TV.focus(dir === "right" ? cards[0] : cards[cards.length - 1]);
      }, 800);
      return true;
    },

    // Kleine Text-Links in der Detailansicht (Altersfreigabe, Besetzung, Genres) überspringen –
    // wie in der TV-App geht es von "Abspielen" direkt zu den Folgen.
    skip: (el) =>
      !!el.closest("[data-uia='previewModal--detailsMetadata'], [data-uia='maturity-rating'], [data-uia^='previewModal--tags'], [data-uia='about-container']"),

    // Karte ragt aus dem Bild: Reihe in diese Richtung weiterblättern, dieselbe Karte bleibt gewählt.
    reveal(el) {
      if (!el.matches(CARD)) return;
      const r = el.getBoundingClientRect();
      const dir = r.right > innerWidth + 2 ? "right" : r.left < -2 ? "left" : null;
      const row = el.closest(ROW);
      const arrow = dir && row?.querySelector(`[data-uia='carousel-hawkins-${dir}-button']`);
      if (!arrow) return;
      const href = el.getAttribute("href");
      arrow.click();
      setTimeout(() => {
        const same = cardsIn(row).find((card) => card.getAttribute("href") === href);
        if (same) TV.focus(same);
      }, 800);
    },

    back() {
      const open = detail();
      const close = open && open.querySelector(CLOSE);
      if (close) {
        close.click();
        return true;
      }
      if (open) {
        history.back(); // Detailansicht liegt als ?jbv=… in der Adresse
        return true;
      }
      if (window.scrollY > 200) {
        // wie in der TV-App: Zurück springt erst nach oben zum Banner
        window.scrollTo({ top: 0, behavior: "smooth" });
        setTimeout(() => TV.focus(firstShown(PLAY) || firstShown(CARD)), 500);
        return true;
      }
      if (ROOTS.includes(location.pathname)) {
        TV.home(); // auf der Startseite führt Zurück zu RaspiTV
        return true;
      }
      return false;
    },
  });
})();
