// TV-Bedienung für Webseiten: Navigation mit Pfeiltasten/OK/Zurück wie in einer TV-App.
//
// Tasten kommen entweder von der Tastatur oder – über background.js – von der
// Fernbedienungs-Schnittstelle von RaspiTV. Seitenspezifisches Verhalten (z. B. Netflix)
// hängt sich über TV.site ein.
(() => {
  if (window.top !== window || window.TV) return;

  const FOCUSABLE_LIST = [
    "a[href]", "button", "input:not([type=hidden])", "select", "textarea",
    "[role=button]", "[role=link]", "[role=menuitem]", "[role=tab]", "[role=checkbox]",
    "[tabindex]:not([tabindex='-1'])",
  ];
  const FOCUSABLE = FOCUSABLE_LIST.join(",");
  /** Wählbare Elemente; TV.site.exclude (Selektor) wird schon in der Abfrage ausgefiltert – auf großen
   *  Seiten (Song-Listen mit je 10 Knöpfen pro Zeile) spart das Hunderte Messungen pro Tastendruck. */
  let excludeFor = null, focusableSel = FOCUSABLE;
  function focusables(scope) {
    const ex = TV.site.exclude;
    if (ex !== excludeFor) {
      excludeFor = ex;
      focusableSel = ex ? FOCUSABLE_LIST.map((s) => `${s}:not(${ex})`).join(",") : FOCUSABLE;
    }
    return scope.querySelectorAll(focusableSel);
  }
  const TEXT_TYPES = new Set(["text", "email", "password", "search", "tel", "url", "number"]);

  const TV = (window.TV = {
    current: null,
    // Von der jeweiligen Seite überschreibbar:
    site: {
      scope: () => null,          // Element, auf das die Navigation begrenzt ist (z. B. ein Dialog)
      initial: () => null,        // bevorzugtes erstes Element
      inPlayer: () => false,      // läuft gerade ein Video im Vollbild?
      playerKey: () => false,     // Taste im Player behandeln; false = Seite selbst entscheiden lassen
      move: () => false,          // Rand einer Reihe erreicht (z. B. Karussell weiterblättern)
      moveFirst: () => false,     // vor der Suche nach dem nächsten Element: true = Seite hat selbst bewegt
      exclude: "",                // Selektor: nie wählbar (wie skip, aber schon in der Abfrage – schneller)
      scrollFocus: true,          // gewähltes Element sanft zur Bildmitte scrollen (sonst nur reveal())
      nativeFocus: true,          // auch den Browser-Fokus setzen (kostet auf großen Seiten Stil-Neuberechnung)
      skip: () => false,          // Element nicht anwählen (z. B. kleine Info-Links)
      reveal: () => {},
      takeover: () => false,      // eigene Oberfläche der Seite aktiv? Dann bekommt sie alle Tasten
      key: () => false,           // Taste in der eigenen Oberfläche behandeln           // gewähltes Element ist nur teilweise zu sehen (z. B. Karussell nachziehen)
      back: () => false,          // eigenes Zurück-Verhalten
      playPause: () => false,     // Play/Pause der Fernbedienung selbst erledigen (z. B. Musik-Player der Seite)
    },
    home: () => chrome.runtime.sendMessage({ cmd: "home" }).catch(() => {}),
  });

  // ---------- Fokus ----------

  // über tagName statt instanceof: gilt auch für Felder in eingebetteten Fenstern derselben Seite
  // (z. B. Anmeldedialog von Apple Music), die ihre eigenen HTMLInputElement-Klassen haben
  const isTextInput = (el) =>
    !!el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && TEXT_TYPES.has(el.type)));

  function visible(el) {
    if (el.disabled || el.closest("[aria-hidden='true'], [inert], #tv-osk")) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    if (r.right < 4 || r.left > innerWidth - 4) return false; // seitlich aus dem Bild (Karussell)
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    // Liegt etwas anderes darüber (z. B. bei unsichtbar eingeklappten Feldern)? Nur im Bild prüfbar.
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || x >= innerWidth || y < 0 || y >= innerHeight) return true;
    const hit = el.ownerDocument.elementFromPoint(x, y); // eigenes Dokument (auch in einem eingebetteten Fenster)
    if (!hit || el.contains(hit)) return true;
    const label = hit.closest("label");
    if (label && (label.control === el || label.contains(el))) return true;
    // Geschwister in einer engen gemeinsamen Hülle (Beschriftung über einem Textfeld)
    const wrap = hit.parentElement;
    if (!wrap || !wrap.contains(el)) return false;
    const w = wrap.getBoundingClientRect();
    return w.width * w.height <= 3 * r.width * r.height;
  }

  /** Wie visible(), aber für die Auswahl: der Fokusrahmen selbst zählt nicht. */
  function selectable(el) {
    return el !== ring && !TV.site.skip(el) && visible(el);
  }

  /** Bereich, auf den die Navigation gerade begrenzt ist: offener Dialog oder null (ganze Seite). */
  function currentScope() {
    const dialogs = [...document.querySelectorAll("[role=dialog], dialog[open]")].filter((d) => {
      const r = d.getBoundingClientRect();
      return r.width > 100 && r.height > 100;
    });
    return TV.site.scope() || dialogs.pop() || null;
  }

  function candidates() {
    const scope = currentScope() || document;
    const list = [...focusables(scope)].filter(selectable);
    // Verschachtelte Elemente: das äußere nur verwerfen, wenn das innere es fast ganz ausfüllt
    // (Link um einen Knopf). Eine Karte mit kleinem "+"-Knopf darin bleibt selbst wählbar.
    const area = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height; };
    return list.filter((el) => !list.some((other) => other !== el && el.contains(other) && area(other) > 0.6 * area(el)));
  }

  function focus(el) {
    if (!el) return;
    TV.current?.classList.remove("tv-focus");
    TV.current = el;
    el.classList.add("tv-focus");
    if (TV.site.nativeFocus) el.focus({ preventScroll: true });
    kickRing();
    TV.site.reveal(el);
    // Elemente im oberen Seitenbereich: ganz nach oben scrollen, damit Kopfzeile und Banner
    // vollständig zu sehen sind; weiter unten das gewählte Element mittig halten.
    if (!TV.site.scrollFocus) return;
    const r = el.getBoundingClientRect();
    if (r.bottom + scrollY < innerHeight - 40) window.scrollTo({ top: 0, behavior: "smooth" });
    else el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  }
  TV.focus = focus;
  TV.keyboard = (input, onClose) => openKeyboard(input, onClose); // Bildschirmtastatur für eigene Felder

  // Der Fokusrahmen ist ein eigenes Element über der Seite – so kann ihn kein
  // Seiten-Stylesheet verstecken, und er folgt Animationen und Scrollen.
  let lastRect = null; // letzte Position des gewählten Elements
  const ring = document.createElement("div");
  ring.id = "tv-ring";
  document.documentElement.append(ring);
  // Jedes Bild nachführen nur, solange sich etwas bewegt (Scrollen, Animation nach einem Tastendruck);
  // steht alles still, reicht ein Blick alle 250 ms – sonst hält der Rahmen den Pi ständig mit 60 Bildern/s wach.
  let still = 0;          // Bilder in Folge ohne Bewegung
  let ringTimer = null;   // wartender setTimeout (Ruhe) – null, solange im Bild-Takt nachgeführt wird
  function trackRing() {
    ringTimer = null;
    const el = TV.current;
    const show = el && el.isConnected && !osk && !TV.site.inPlayer() && !TV.site.takeover() && visible(el);
    ring.style.display = show ? "block" : "none";
    if (show) {
      const r = el.getBoundingClientRect();
      const moved = !lastRect || r.left !== lastRect.left || r.top !== lastRect.top ||
        r.width !== lastRect.width || r.height !== lastRect.height;
      still = moved ? 0 : still + 1;
      lastRect = r;
      if (moved) {
        const pad = 6;
        ring.style.transform = `translate(${r.left - pad}px, ${r.top - pad}px)`;
        ring.style.width = `${r.width + 2 * pad}px`;
        ring.style.height = `${r.height + 2 * pad}px`;
      }
    }
    if (show && still < 20) requestAnimationFrame(trackRing);
    else ringTimer = setTimeout(trackRing, show ? 250 : 300);
  }
  /** Nach einem Tastendruck sofort wieder im Bild-Takt nachführen. */
  function kickRing() {
    still = 0;
    if (ringTimer !== null) {
      clearTimeout(ringTimer);
      ringTimer = null;
      requestAnimationFrame(trackRing);
    }
  }

  function initial(list) {
    const preferred = TV.site.initial();
    if (preferred && visible(preferred)) return preferred;
    const onScreen = list.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight;
    });
    return onScreen.find(isTextInput) || onScreen[0] || list[0]; // Formulare: gleich ins Textfeld
  }

  function nearest(list, rect) {
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    let best = null, bestDistance = Infinity;
    for (const el of list) {
      const r = el.getBoundingClientRect();
      const distance = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
      if (distance < bestDistance) { best = el; bestDistance = distance; }
    }
    return best;
  }

  // Nächstes Element in einer Richtung. Erst nur nach Lage bewerten (billig: getBoundingClientRect),
  // dann die besten der Reihe nach auf echte Sichtbarkeit prüfen (teuer: elementFromPoint) – auf großen
  // Seiten (Playlist mit 100 Zeilen) sonst Hunderte Trefferprüfungen pro Tastendruck.
  function move(dir) {
    const scope = currentScope() || document;
    const all = [...focusables(scope)];
    if (!all.length) return;
    let from = TV.current;
    if (!from || !from.isConnected || !scope.contains(from) || !selectable(from)) {
      // Seiten wie Netflix tauschen Elemente beim Neuzeichnen aus: dann von der
      // letzten bekannten Position aus weitergehen statt von vorn zu beginnen.
      if (!lastRect) return focus(initial(candidates()));
      from = null;
    }
    if (from && TV.site.moveFirst(dir, from)) return;
    const horizontal = dir === "left" || dir === "right";
    const sign = dir === "right" || dir === "down" ? 1 : -1;
    const c = from ? from.getBoundingClientRect() : lastRect;
    const ranked = [];
    for (const el of all) {
      if (el === from) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      // Abstand in Bewegungsrichtung (Mittelpunkt muss klar dahinter liegen)
      const ahead = horizontal
        ? sign * (r.left + r.width / 2 - (c.left + c.width / 2))
        : sign * (r.top + r.height / 2 - (c.top + c.height / 2));
      if (ahead < 4) continue;
      const gap = horizontal
        ? Math.max(0, sign > 0 ? r.left - c.right : c.left - r.right)
        : Math.max(0, sign > 0 ? r.top - c.bottom : c.top - r.bottom);
      // Versatz quer zur Bewegungsrichtung; 0 = liegt in derselben Reihe/Spalte
      const offset = horizontal
        ? Math.max(0, r.top - c.bottom, c.top - r.bottom)
        : Math.max(0, r.left - c.right, c.left - r.right);
      const aligned = offset === 0;
      ranked.push({ el, r, aligned, score: gap + ahead * 0.1 + offset * (horizontal ? 6 : 2) });
    }
    // Links/rechts bleibt streng in der Reihe; hoch/runter nimmt das insgesamt nächste Element.
    ranked.sort((a, b) => (horizontal && a.aligned !== b.aligned ? (a.aligned ? -1 : 1) : a.score - b.score));
    let best = null;
    for (const item of ranked) {
      if (!selectable(item.el) || wrapsChild(item.el, item.r)) continue;
      best = item;
      break;
    }
    // Links/rechts bleibt in der Reihe: am Rand darf die Seite z. B. ein Karussell weiterblättern.
    if (horizontal && !(best && best.aligned) && from && TV.site.move(dir, from)) return;
    if (best) focus(best.el);
  }

  /** Äußeres Element (Link um einen Knopf), das ein wählbares inneres fast ganz ausfüllt? Dann das innere nehmen. */
  function wrapsChild(el, r) {
    const area = r.width * r.height;
    for (const inner of el.querySelectorAll(FOCUSABLE)) {
      const ri = inner.getBoundingClientRect();
      if (ri.width * ri.height > 0.6 * area && selectable(inner)) return true;
    }
    return false;
  }

  function ok() {
    const el = TV.current;
    if (!el || !el.isConnected) return move("down");
    if (isTextInput(el)) return openKeyboard(el);
    el.click();
  }

  function back() {
    if (TV.site.back()) return;
    if (history.length > 1) history.back();
    else TV.home();
  }

  // ---------- Bildschirmtastatur ----------

  const ROWS = ["1234567890", "qwertzuiop", "asdfghjkl@", "yxcvbnm.-_"].map((r) => [...r]);
  ROWS.push(["⇧", "Leerzeichen", "⌫", "Fertig", "phone"]); // phone: Handy-Symbol – auf dem Handy tippen
  let osk = null; // { input, box, row, col, shift, hint }
  function phoneIcon() {
    // Handy-Symbol per DOM (innerHTML ist auf manchen Seiten durch Trusted Types gesperrt)
    const ns = "http://www.w3.org/2000/svg";
    const el = (tag, attrs) => {
      const e = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      return e;
    };
    const svg = el("svg", { viewBox: "0 0 24 24", width: "26", height: "26", fill: "none", stroke: "currentColor",
      "stroke-width": "2", "stroke-linecap": "round" });
    svg.append(el("rect", { x: "6.5", y: "2", width: "11", height: "20", rx: "2.5" }), el("path", { d: "M10.5 5.5h3" }),
      el("circle", { cx: "12", cy: "18.3", r: "1", fill: "currentColor", stroke: "none" }));
    return svg;
  }

  function setValue(input, value) {
    // Über den nativen Setter, damit React & Co. die Änderung bemerken
    const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function openKeyboard(input, onClose) {
    const box = document.createElement("div");
    box.id = "tv-osk";
    document.documentElement.append(box);
    osk = { input, box, row: 1, col: 0, shift: false, onClose };
    renderKeyboard();
  }

  function closeKeyboard() {
    const { box, input, onClose } = osk;
    box.remove();
    input.dispatchEvent(new Event("change", { bubbles: true }));
    osk = null;
    if (onClose) onClose(input.value);
  }

  function renderKeyboard() {
    const { input, box, shift } = osk;
    const text = document.createElement("div");
    text.className = "tv-osk-text";
    text.textContent = input.type === "password" ? "•".repeat(input.value.length) : input.value;
    const rows = ROWS.map((keys, r) => {
      const row = document.createElement("div");
      row.className = "tv-osk-row";
      keys.forEach((key, c) => {
        const cell = document.createElement("div");
        cell.className = "tv-osk-key";
        if (r === osk.row && c === osk.col) cell.classList.add("tv-osk-on");
        else if (key === "⇧" && shift) cell.classList.add("tv-osk-active");
        if (key === "phone") cell.append(phoneIcon());
        else cell.textContent = shift && key.length === 1 ? key.toUpperCase() : key;
        row.append(cell);
      });
      return row;
    });
    const hint = document.createElement("div");
    hint.className = "tv-osk-hint";
    hint.textContent = osk.hint || "";
    box.replaceChildren(text, ...(osk.hint ? [hint] : []), ...rows);
  }

  function keyboardKey(key) {
    if (key === "back") return closeKeyboard();
    if (key === "up" || key === "down") {
      const row = Math.min(Math.max(osk.row + (key === "up" ? -1 : 1), 0), ROWS.length - 1);
      // Spalte anteilig übertragen, weil die unterste Reihe weniger Tasten hat
      osk.col = Math.round((osk.col / (ROWS[osk.row].length - 1)) * (ROWS[row].length - 1));
      osk.row = row;
    } else if (key === "left" || key === "right") {
      osk.col = Math.min(Math.max(osk.col + (key === "left" ? -1 : 1), 0), ROWS[osk.row].length - 1);
    } else if (key === "ok") {
      const pressed = ROWS[osk.row][osk.col];
      const value = osk.input.value;
      if (pressed === "Fertig") return closeKeyboard();
      if (pressed === "phone") {
        osk.hint = "Jetzt auf dem Handy in der RaspiTV-Fernbedienung tippen. Noch kein Handy verbunden? " +
          "RaspiTV → Einstellungen → System → Handy verbinden";
      } else if (pressed === "⇧") osk.shift = !osk.shift;
      else if (pressed === "⌫") setValue(osk.input, value.slice(0, -1));
      else if (pressed === "Leerzeichen") setValue(osk.input, value + " ");
      else {
        setValue(osk.input, value + (osk.shift ? pressed.toUpperCase() : pressed));
        osk.shift = false;
      }
    }
    renderKeyboard();
  }

  // ---------- Tasten ----------

  /** Verarbeitet eine Taste; gibt false zurück, wenn die Seite sie selbst behandeln soll. */
  let pressed = false; // hat jemand schon eine Taste gedrückt?

  function handle(key, fromKeyboard) {
    pressed = true;
    if (key === "home") return TV.home(), true;
    if (osk) return keyboardKey(key), true;
    if (TV.site.takeover()) return TV.site.key(key), true;
    if (TV.site.inPlayer()) return TV.site.playerKey(key, fromKeyboard);
    if (key === "ok") ok();
    else if (key === "back") back();
    else move(key);
    return true;
  }

  const KEYMAP = {
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    Enter: "ok", Escape: "back", Backspace: "back", BrowserBack: "back", Home: "home", BrowserHome: "home",
  };

  function onKey(event) {
    const key = KEYMAP[event.key];
    if (!key) return;
    // Beim Tippen mit echter Tastatur gehören Cursor-Tasten und Enter dem Textfeld.
    // (Nicht, solange die eigene Oberfläche der Seite aktiv ist: dort gehören alle Tasten ihr –
    // z. B. legt Netflix den Fokus bei der PIN-Abfrage auf ein unsichtbares Textfeld.)
    const typing = !osk && !TV.site.takeover() && isTextInput(event.target);
    if (typing && (key === "left" || key === "right" || key === "ok" || key === "home" || event.key === "Backspace")) return;
    const handled = event.type === "keydown" ? handle(key, true) : !TV.site.inPlayer();
    if (handled) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKey, true);

  // Lautstärke-Anzeige: RaspiTV stellt den Ton und schickt "volume:<prozent>:<stumm 0/1>".
  // Gleiches Aussehen wie in RaspiTV (qml/VolumeOsd.qml) und im Jellyfin-Player.
  const vol = document.createElement("div");
  vol.id = "tv-volume";
  vol.innerHTML = '<div class="tv-vol-num"></div><div class="tv-vol-track"><div class="tv-vol-fill"></div></div>' +
    '<svg class="tv-vol-icon" viewBox="0 0 24 24"><path class="tv-vol-body" d="M3 9.6h3.6L11.5 5v14l-4.9-4.6H3z"/>' +
    '<path class="tv-vol-waves" d="M14.4 9.2a4 4 0 0 1 0 5.6M17 6.6a7.6 7.6 0 0 1 0 10.8"/>' +
    '<path class="tv-vol-x" d="M15 9.5l5 5M20 9.5l-5 5"/></svg>';
  let volTimer = null;
  function showVolume(value, muted) {
    // Im Vollbild (Player) zeigt Chromium nur das Vollbild-Element – die Anzeige muss hinein
    const host = document.fullscreenElement || document.documentElement;
    if (vol.parentNode !== host) host.append(vol);
    vol.querySelector(".tv-vol-num").textContent = muted ? "–" : String(value);
    vol.querySelector(".tv-vol-fill").style.height = `${value > 0 ? Math.max(value, 3) : 0}%`;
    vol.classList.toggle("tv-vol-muted", muted || value === 0);
    vol.classList.add("tv-vol-on");
    clearTimeout(volTimer);
    volTimer = setTimeout(() => vol.classList.remove("tv-vol-on"), 2500);
  }

  // Hinweis oben (z. B. Sleep-Timer): "toast:<sekunden>:<text>", "toast:0:" blendet aus.
  const toast = document.createElement("div");
  toast.id = "tv-toast";
  let toastTimer = null;
  function showToast(seconds, text) {
    const host = document.fullscreenElement || document.documentElement;
    if (toast.parentNode !== host) host.append(toast);
    clearTimeout(toastTimer);
    if (!text || !seconds) return toast.classList.remove("tv-toast-on");
    toast.textContent = text;
    toast.classList.add("tv-toast-on");
    toastTimer = setTimeout(() => toast.classList.remove("tv-toast-on"), seconds * 1000);
  }

  // Text vom Handy (RaspiTV schickt "text:<fertig 0/1>:<text>"): in die offene Bildschirmtastatur
  // bzw. das gewählte Textfeld der Seite; „fertig“ schließt die Tastatur bzw. drückt Enter.
  function typeText(text, submit) {
    if (osk) {
      setValue(osk.input, text);
      if (submit) closeKeyboard();
      else renderKeyboard();
      return;
    }
    const active = document.activeElement;
    const el = active && isTextInput(active) ? active : TV.current && isTextInput(TV.current) ? TV.current : null;
    if (!el) return;
    el.focus();
    setValue(el, text);
    if (submit) {
      for (const type of ["keydown", "keypress", "keyup"]) {
        el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      }
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    const v = /^volume:(\d+):([01])$/.exec(message.key || "");
    const t = /^toast:(\d+):(.*)$/s.exec(message.key || "");
    const typed = /^text:([01]):(.*)$/s.exec(message.key || "");
    if (typed) {
      typeText(typed[2], typed[1] === "1");
    } else if (t) {
      showToast(+t[1], t[2]);
    } else if (v) {
      showVolume(+v[1], v[2] === "1");
    } else if (message.key === "playpause") {  // Play/Pause der Fernbedienung: laufendes Video umschalten
      if (TV.site.playPause()) return;
      const video = [...document.querySelectorAll("video, audio")].find((v) => v.readyState > 0);
      if (video) video.paused ? video.play() : video.pause();
    } else if (message.key) handle(message.key, false);
  });
  setInterval(() => chrome.runtime.sendMessage({ cmd: "ping" }).catch(() => {}), 20000);
  chrome.runtime.sendMessage({ cmd: "ping" }).catch(() => {});

  // Nach dem Laden und nach Seitenwechseln automatisch ein Element wählen.
  let timer = null;
  let lastScope = null; // zuletzt gesehener Dialog
  let opener = null;    // Element, von dem aus der Dialog geöffnet wurde
  let openTries = 0;
  function refocus() {
    if (timer) return; // höchstens alle 600 ms prüfen, auch wenn sich die Seite ständig ändert
    timer = setTimeout(() => {
      timer = null;
      if (osk || TV.site.inPlayer() || TV.site.takeover()) return;
      // Dialog geöffnet: bevorzugtes Element darin wählen. Dialog geschlossen: zurück dorthin,
      // wo man vorher war (z. B. die Karte, die die Detailansicht geöffnet hat).
      const scope = currentScope();
      if (scope !== lastScope) {
        const opened = scope && !lastScope;
        if (opened) {
          // Während der Öffnen-Animation ist das bevorzugte Element evtl. noch nicht sichtbar:
          // dann beim nächsten Durchlauf erneut versuchen (höchstens ~2 Sekunden lang).
          const preferred = TV.site.initial();
          if (!(preferred && visible(preferred)) && ++openTries < 4) return;
          openTries = 0;
          if (!opener) opener = TV.current;
          lastScope = scope;
          return focus(preferred && visible(preferred) ? preferred : initial(candidates()));
        }
        lastScope = scope;
        if (!scope && opener && opener.isConnected) {
          const back = opener;
          opener = null;
          return focus(back);
        }
      }
      // Solange niemand eine Taste gedrückt hat, auf das bevorzugte Element wechseln,
      // sobald es sichtbar wird (z. B. "Abspielen", wenn das Banner eingeblendet ist).
      const preferred = !pressed && TV.site.initial();
      if (preferred && preferred !== TV.current && visible(preferred)) return focus(preferred);
      if (TV.current && TV.current.isConnected && visible(TV.current)) return;
      const list = candidates();
      if (!list.length) return;
      if (TV.current && lastRect) return focus(nearest(list, lastRect)); // ausgetauschtes Element wiederfinden
      focus(initial(list)); // wie in der TV-App: bevorzugtes Element statt z. B. dem Logo
    }, 600);
  }
  requestAnimationFrame(trackRing);
  setInterval(refocus, 700); // auch ohne Änderungen an der Seite regelmäßig prüfen
  new MutationObserver(refocus).observe(document.documentElement, { childList: true, subtree: true });
  refocus();
})();
