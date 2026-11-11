// Text vom Handy (phone.py → RaspiTV → "text:<fertig 0/1>:<text>") auf Seiten ohne eigene TV-Anpassung
// (YouTube, Spotify, ARD …): ins gewählte Textfeld schreiben, „fertig“ drückt Enter.
// Netflix, Disney+ und Prime Video erledigt tv.js (dort auch in der Bildschirmtastatur).
(() => {
  const TYPES = new Set(["text", "search", "email", "url", "password", "tel", "number"]);
  const isText = (el) =>
    el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TYPES.has(el.type));

  function setValue(input, value) {
    // Über den nativen Setter, damit React & Co. die Änderung bemerken
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const top = window.top === window;

  function target() {
    if (isText(document.activeElement)) return document.activeElement;
    if (!top) return null;  // eingebettete Fenster (z. B. Apple-Anmeldung): nur das Feld, das gerade aktiv ist
    // nichts gewählt: das Suchfeld der Seite
    const field = document.querySelector("input[type=search], input[name=search_query], input[name=q], input[role=combobox], input[type=text]");
    return field && field.offsetParent !== null ? field : null;
  }

  chrome.runtime.onMessage.addListener((message) => {
    const typed = /^text:([01]):(.*)$/s.exec(message.key || "");
    if (!typed) return;
    const el = target();
    if (!el) return;
    el.focus();
    setValue(el, typed[2]);
    if (typed[1] === "1") {
      for (const type of ["keydown", "keypress", "keyup"]) {
        el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      }
      const submit = el.form && el.form.querySelector("button[type=submit], #sign-in");
      if (submit) submit.click();
      else if (el.form && typeof el.form.requestSubmit === "function") {
        try { el.form.requestSubmit(); } catch (e) { /* Formular will es anders */ }
      }
    }
  });
  if (!top) return;  // die Verbindung hält das Hauptfenster
  // hält die Verbindung zu RaspiTV (background.js) offen, auch ohne tv.js
  const ping = () => chrome.runtime.sendMessage({ cmd: "ping" }).catch(() => {});
  setInterval(ping, 20000);
  ping();
})();
