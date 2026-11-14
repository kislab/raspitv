// YouTube (TV-Oberfläche youtube.com/tv): Fernbedienungstasten als Tastendrücke weitergeben.
//
// RaspiTV liest die Bluetooth-Fernbedienung exklusiv (remote_input.py) – bei Chromium kommen ihre Tasten
// also nie als echte Tastendrücke an, sondern nur als Nachricht über background.js. Seiten mit tv.js
// verarbeiten die Nachricht selbst; die YouTube-TV-Oberfläche bedient sich aber schon mit Pfeiltasten,
// Enter und Escape. Darum hier: Nachricht → Tastendruck an das Element mit dem Fokus.
(() => {
  const KEYS = {
    up: ["ArrowUp", 38], down: ["ArrowDown", 40], left: ["ArrowLeft", 37], right: ["ArrowRight", 39],
    ok: ["Enter", 13], back: ["Escape", 27], playpause: ["MediaPlayPause", 179],
  };

  function press(name) {
    const [key, code] = KEYS[name];
    const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document;
    for (const type of ["keydown", "keyup"]) {
      target.dispatchEvent(new KeyboardEvent(type, {
        key, code: key, keyCode: code, which: code, bubbles: true, cancelable: true, composed: true,
      }));
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.key === "bgpause") {
      // RaspiTV geht zur Startseite (YouTube bleibt angehalten im Hintergrund): vorher sauber pausieren
      for (const v of document.querySelectorAll("video")) { try { if (!v.paused) v.pause(); } catch (e) { /* weiter */ } }
      return;
    }
    if (KEYS[message.key]) press(message.key);
  });
})();
