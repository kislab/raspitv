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

  const SKIP_LIST = [
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
    "[data-testid=delete-from-library-button]", // „Aus Mediathek löschen“ – nicht aus Versehen drücken
  ];
  const SKIP = SKIP_LIST.join(",");
  // für tv.js: schon bei der Abfrage ausfiltern (das Element selbst und alles darin)
  const EXCLUDE = SKIP_LIST.flatMap((sel) => [sel, `${sel} *`]).join(",");

  // Die Seite scrollt nicht das Fenster, sondern #scrollable-page: gewähltes Element dort sichtbar halten.
  /** Reihe „Als Nächstes“ seitlich verschieben, sodass die gewählte Karte ganz zu sehen ist. */
  function scrollQueue(card) {
    const list = card.parentElement;
    const box = list.parentElement.getBoundingClientRect();
    const shift = Number(list.dataset.shift || 0);
    const left = card.offsetLeft, right = left + card.offsetWidth;
    const width = box.width - 20; // Innenabstand links/rechts (10 px, Platz für den Fokusrahmen)
    let next = shift;
    if (left - next < 0) next = left;
    else if (right - next > width) next = right - width;
    list.dataset.shift = next;
    list.style.transform = `translateX(${-next}px)`;
  }

  // ---------- Lange Song-Listen schrittweise zeigen ----------
  // Playlists mit 100+ Zeilen (je ~30 Elemente) machen jede Stil-Neuberechnung auf dem Pi teuer. Zuerst nur
  // ROWS_STEP Zeilen zeigen, beim Herunterblättern kurz vor dem Ende die nächsten. Ausgeblendete Zeilen
  // (display: none) kosten weder Stil noch Layout. Eine einzige Regel, deren Grenze verschoben wird.
  const ROWS_STEP = 8;
  let rowLimit = ROWS_STEP;
  const rowStyle = document.createElement("style");
  (document.head || document.documentElement).append(rowStyle);
  function setRowLimit(n) {
    rowLimit = n;
    rowStyle.textContent = `html.tv-am .songs-list-row:nth-child(n+${n + 1} of .songs-list-row) { display: none !important; }`;
  }
  setRowLimit(ROWS_STEP);
  function growRows(row) {
    const rows = row.parentElement.querySelectorAll(":scope > .songs-list-row");
    const index = Array.prototype.indexOf.call(rows, row);
    if (index >= rowLimit - 3 && rows.length > rowLimit) setRowLimit(rowLimit + ROWS_STEP);
  }

  function reveal(el) {
    const row = el.closest(".songs-list-row");
    if (row) growRows(row);
    document.documentElement.classList.toggle("tv-am-noring", !!el.closest(".navigation, .tv-am-subnav, .tv-am-now__buttons"));
    if (el.closest(".tv-am-now__queue")) return scrollQueue(el);
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

  // Rechts neben einer Song-Zeile ist nichts (sonst springt der Fokus quer über die Seite)
  function move(dir, from) {
    return dir === "right" && !!from.closest(".songs-list-row");
  }

  // Play/Pause der Fernbedienung: Knopf in der Player-Leiste der Seite
  function playPause() {
    if (view) return control("play"), true;
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


  // ---------- „Jetzt läuft“ (statt der Player-Leiste, wie in der TV-App) ----------
  // Apples Player-Leiste bleibt unsichtbar im Hintergrund (ihre Knöpfe steuern die Wiedergabe). Sobald etwas
  // geladen ist, steht oben in der Leiste „Jetzt läuft“; OK öffnet die Vollbild-Ansicht mit Cover und Knöpfen.
  const SVG = "http://www.w3.org/2000/svg";
  function icon(d) {
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "currentColor");
    svg.append(path);
    return svg;
  }
  const ICONS = {
    prev: "M6 5h2v14H6zM9.5 12 19 5v14z",
    next: "M16 5h2v14h-2zM5 5l9.5 7L5 19z",
    play: "M7 4.5v15L19.5 12z",
    pause: "M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z",
  };
  const shadowButton = (host) => host && (host.shadowRoot?.querySelector("button") || host.querySelector("button") || host);
  const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

  function nowState() {
    const lcd = document.querySelector(".player-lcd");
    if (!lcd || lcd.classList.contains("player-lcd--empty")) return null;
    // Laufschrift enthält den Text doppelt (für das Weiterlaufen) – nur das erste Stück lesen
    const line = (sel) => (lcd.querySelector(`${sel} .marquee-line__text-content`) || lcd.querySelector(sel))?.textContent.trim() || "";
    const [artist, album] = line(".marquee--secondary").split(" — ");
    const srcset = lcd.querySelector("source")?.srcset || "";
    const art = (srcset.split(",")[0] || "").trim().split(" ")[0].replace(/\/\d+x\d+([^/]*)$/, "/600x600$1");
    const media = [...document.querySelectorAll("audio, video")].find((m) => m.currentSrc);
    const range = document.querySelector("amp-playback-controls-progress")?.shadowRoot?.querySelector("input[type=range]");
    return {
      title: line(".lcd-meta__primary-container"), artist: artist || "", album: album || "", art,
      playing: !!media && !media.paused, pos: Number(range?.value || 0), dur: Number(range?.max || 0),
      preview: !!lcd.querySelector(".playback-badge"),
    };
  }

  function control(which) {
    const skips = document.querySelectorAll(".playback-controls__main amp-playback-controls-item-skip");
    const host = which === "play" ? document.querySelector("amp-playback-controls-play")
      : which === "prev" ? skips[0] : skips[skips.length - 1];
    shadowButton(host)?.click();
    setTimeout(update, 300);
  }

  let queueKey = null;  // zuletzt gezeigte Warteschlange (nur bei Änderung neu aufbauen)

  // Warteschlange kommt von applemusic-main.js (Seiten-Kontext, MusicKit)
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.tvam !== "queue" || !view) return;
    const { items } = event.data;
    const key = items.map((i) => `${i.index}:${i.title}`).join("|");
    if (key === queueKey) return;
    queueKey = key;
    const box = view.querySelector(".tv-am-now__queue");
    const list = view.querySelector(".tv-am-now__queue-list");
    const hadFocus = TV.current && list.contains(TV.current);
    list.replaceChildren(...items.map((item) => {
      const card = el("button", "tv-am-now__qitem");
      const img = el("img");
      img.src = item.art;
      img.loading = "lazy";
      card.append(img, el("div", "tv-am-now__qtitle", item.title), el("div", "tv-am-now__qartist", item.artist));
      card.addEventListener("click", () => {
        window.postMessage({ tvam: "jump", index: item.index }, "*");
        setTimeout(() => TV.focus(view?.querySelector(".tv-am-now__play")), 400);
      });
      return card;
    }));
    box.classList.toggle("tv-am-now__queue--empty", !items.length);
    if (hadFocus) TV.focus(list.firstElementChild || view.querySelector(".tv-am-now__play"));
  });


  // ---------- Mediathek (angemeldet) ----------
  // Apple hängt Mediathek und alle Playlists an die Seitenleiste – oben wäre das viel zu lang. Wie in der
  // TV-App: oben nur eine Pille „Mediathek“; in der Mediathek eine zweite Reihe mit ihren Bereichen.
  // Beide klicken Apples (versteckte) Links, damit die Seite ohne Neuladen wechselt.
  const LIBRARY = [
    ["Zuletzt hinzugefügt", "/library/recently-added"], ["Playlists", "/library/all-playlists"],
    ["Künstler", "/library/artists"], ["Alben", "/library/albums"], ["Titel", "/library/songs"],
    ["Musikvideos", "/library/music-videos"], ["Für dich", "/library/made-for-you"],
  ];
  let libItem = null, subNav = null;

  function go(path) {
    const link = [...document.querySelectorAll(".navigation a[href]")].find((a) => new URL(a.href, location.href).pathname.endsWith(path));
    if (link) link.click();
    else location.href = `/de${path}`;
  }

  function navLink(text, path, cls) {
    const a = el("a", `navigation-item__link ${cls || ""}`, text);
    a.href = "#";
    a.addEventListener("click", (e) => { e.preventDefault(); e.stopImmediatePropagation(); closeNow(); go(path); }, true);
    return a;
  }

  function updateLibrary() {
    const hasLibrary = !!document.querySelector(".navigation-items--library");
    const list = document.querySelector(".navigation-items--primary .navigation-items__list");
    const inLibrary = location.pathname.includes("/library");
    if (hasLibrary && list && !libItem?.isConnected) {
      libItem = el("li", "navigation-item tv-am-lib-item");
      libItem.append(navLink("Mediathek", "/library/recently-added"));
      const now = list.querySelector(".tv-am-now-item");
      list.insertBefore(libItem, now || null);
    }
    if (libItem) libItem.classList.toggle("tv-am-selected", inLibrary && !view);
    document.documentElement.classList.toggle("tv-am-lib", hasLibrary && inLibrary);
    const header = document.querySelector(".header");
    if (hasLibrary && inLibrary && header && !subNav?.isConnected) {
      subNav = el("div", "tv-am-subnav");
      const ul = el("div", "tv-am-subnav__list");
      for (const [text, path] of LIBRARY) ul.append(navLink(text, path, "tv-am-subnav__link"));
      subNav.append(ul);
      header.append(subNav);
    }
    if (subNav) {
      for (const a of subNav.querySelectorAll("a")) {
        const path = LIBRARY.find(([t]) => t === a.textContent)[1];
        const here = location.pathname.replace(/\/$/, "");
        a.classList.toggle("tv-am-selected", here.endsWith(path) ||
          (path === "/library/all-playlists" && location.pathname.includes("/library/playlist/")));
      }
    }
  }

  let navItem = null;   // „Jetzt läuft“ in der Leiste
  let view = null;      // Vollbild-Ansicht, solange offen
  let artUrl = "";
  let tick = 0;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function openNow() {
    if (view) return;
    view = el("div", "tv-am-now");
    const bg = el("div", "tv-am-now__bg");
    const cover = el("img", "tv-am-now__cover");
    const info = el("div", "tv-am-now__info");
    const buttons = el("div", "tv-am-now__buttons");
    for (const which of ["prev", "play", "next"]) {
      const b = el("button", `tv-am-now__btn tv-am-now__${which}`);
      b.dataset.which = which;
      b.addEventListener("click", () => control(which));
      buttons.append(b);
    }
    info.append(el("div", "tv-am-now__label", "Jetzt läuft"), el("div", "tv-am-now__title"), el("div", "tv-am-now__artist"),
      el("div", "tv-am-now__album"), el("div", "tv-am-now__bar"), el("div", "tv-am-now__times"), buttons);
    info.querySelector(".tv-am-now__bar").append(el("div", "tv-am-now__fill"));
    const main = el("div", "tv-am-now__main");
    main.append(cover, info);
    const queue = el("div", "tv-am-now__queue");
    queue.append(el("div", "tv-am-now__queue-label", "Als Nächstes"), el("div", "tv-am-now__queue-list"));
    view.append(bg, main, queue);
    queueKey = null;
    document.body.append(view);
    document.documentElement.classList.add("tv-am-now-open");
    artUrl = "";
    update();
    TV.focus(view.querySelector(".tv-am-now__play"));
  }

  function closeNow() {
    if (!view) return false;
    view.remove();
    view = null;
    document.documentElement.classList.remove("tv-am-now-open");
    const link = document.querySelector(".tv-am-now-item a");
    if (link) setTimeout(() => TV.focus(link), 0); // nach tv.js' eigener Zurück-Behandlung
    return true;
  }

  function update() {
    if (window.TVAM_APP?.active) return; // eigene Oberfläche läuft (applemusic-app.js)
    updateLibrary();
    const s = nowState();
    // Eintrag oben in der Leiste
    const list = document.querySelector(".navigation-items--primary .navigation-items__list");
    if (s && list && !navItem?.isConnected) {
      navItem = el("li", "navigation-item tv-am-now-item");
      const a = el("a", "navigation-item__link", "Jetzt läuft");
      a.href = "#";
      a.addEventListener("click", (e) => { e.preventDefault(); e.stopImmediatePropagation(); openNow(); }, true);
      navItem.append(a);
      list.append(navItem);
    } else if (!s && navItem) {
      if (TV.current && navItem.contains(TV.current)) TV.focus(TV.site.initial());
      navItem.remove();
      navItem = null;
    }
    if (!view) return;
    if (!s) return closeNow();
    if (!(tick++ % 4)) window.postMessage({ tvam: "queue?" }, "*"); // alle 2 s
    if (s.art && s.art !== artUrl) {
      artUrl = s.art;
      view.querySelector(".tv-am-now__cover").src = s.art;
      view.querySelector(".tv-am-now__bg").style.backgroundImage = `url("${s.art}")`;
    }
    view.querySelector(".tv-am-now__title").textContent = s.title;
    view.querySelector(".tv-am-now__artist").textContent = s.artist;
    view.querySelector(".tv-am-now__album").textContent = s.album + (s.preview ? " · Vorschau" : "");
    view.querySelector(".tv-am-now__fill").style.width = s.dur ? `${(100 * s.pos) / s.dur}%` : "0";
    view.querySelector(".tv-am-now__times").textContent = s.dur ? `${fmt(s.pos)} / ${fmt(s.dur)}` : "";
    const play = view.querySelector(".tv-am-now__play");
    const want = s.playing ? "pause" : "play";
    if (play.dataset.icon !== want) {
      play.dataset.icon = want;
      play.replaceChildren(icon(ICONS[want]));
      view.querySelector(".tv-am-now__prev").replaceChildren(icon(ICONS.prev));
      view.querySelector(".tv-am-now__next").replaceChildren(icon(ICONS.next));
    }
  }
  // Ansicht offen: jede halbe Sekunde (Fortschritt), sonst alle 1,5 s (nur der Eintrag in der Leiste)
  (function loop() { update(); setTimeout(loop, view ? 500 : 1500); })();

  /** Album-/Playlist-Seite: „Wiedergabe“ bzw. „Hörprobe“ im Kopf */
  function detailPlay() {
    const header = document.querySelector("#scrollable-page .container-detail-header");
    return header && [...header.querySelectorAll("button.click-action")].find((b) => b.textContent.trim());
  }

  // Neue Seite (Album, Playlist, Mediathek-Bereich …): wie in der TV-App aufs erste Element im Inhalt statt
  // auf das, was zufällig an der alten Stelle liegt. Wartet bis zu 8 s, bis die Seite es zeigt.
  let lastPath = location.pathname, pathFocusUntil = 0;
  function checkPath() {
    if (window.TVAM_APP?.active) return;
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      setRowLimit(ROWS_STEP); // neue Seite: wieder nur die ersten Zeilen
      // über die Leiste oben gewechselt: Fokus bleibt in der Leiste
      pathFocusUntil = TV.current?.isConnected && TV.current.closest(".header") ? 0 : Date.now() + 8000;
    }
    if (!pathFocusUntil || view || overlay()) return;
    if (Date.now() > pathFocusUntil) { pathFocusUntil = 0; return; }
    const page = document.getElementById("scrollable-page");
    const target = detailPlay() || page?.querySelector(".product-lockup__link, .songs-list-row, main :is(a[href], button):not(footer *)");
    if (target && target.getBoundingClientRect().height > 8) {
      pathFocusUntil = 0;
      TV.focus(target);
    }
  }
  setInterval(checkPath, 300);

  // Zwischen Leiste und Mediathek-Reihe: ▼ auf den gewählten Bereich, ▲ zurück auf „Mediathek“
  function moveFirst(dir, from) {
    if (!subNav?.isConnected || !document.documentElement.classList.contains("tv-am-lib")) return false;
    if (dir === "down" && from.closest(".navigation")) {
      const target = subNav.querySelector(".tv-am-selected") || subNav.querySelector("a");
      return TV.focus(target), true;
    }
    if (dir === "up" && from.closest(".tv-am-subnav")) {
      const pill = libItem?.querySelector("a");
      return !!pill && (TV.focus(pill), true);
    }
    return false;
  }

  Object.assign(TV.site, {
    nativeFocus: false,
    exclude: EXCLUDE,
    scrollFocus: false, // reveal() scrollt den inneren Bereich – sofort und nur, wenn nötig // Apple-Seiten reagieren auf :focus mit teurer Stil-Neuberechnung; tv.js klickt ohnehin selbst
    moveFirst,
    skip: (el) => !!el.closest(SKIP),
    scope: () => view || overlay(),
    back: () => closeNow() || back(),
    move,
    reveal,
    playPause,
    // erstes Element: Inhalt statt Seitenleiste
    initial: () => view?.querySelector(".tv-am-now__play") || overlayStart() || detailPlay() ||
      document.querySelector("#scrollable-page .product-lockup__link") ||
      document.querySelector("#scrollable-page main :is(a[href], button):not(footer *)") ||
      document.querySelector(".navigation-item--selected a, .navigation a[aria-current]"),
  });

  // Angemeldet? Dann die eigene TV-Oberfläche starten (Apples Seite lädt nur noch im Hintergrund).
  // MusicKit braucht nach dem Laden etwas; höchstens ~40 s lang nachfragen.
  let tries = 0;
  (function startApp() {
    if (!window.TVAM_APP || window.TVAM_APP.active) return;
    window.TVAM_APP.call("auth").then((info) => {
      if (info.authorized) window.TVAM_APP.start(info);
      else {
        if (tries > 8) window.TVBoot?.release(); // nicht angemeldet: Apples Seite zeigen (boot.js)
        if (++tries < 40) setTimeout(startApp, 1000);
      }
    }).catch(() => { if (++tries < 40) setTimeout(startApp, 1000); });
  })();
})();
