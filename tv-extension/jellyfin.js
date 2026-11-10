// Jellyfin im RaspiTV-Player: TV-Ansicht einschalten und Tasten der Fernbedienung weiterreichen.
//
// Jellyfin hat eine eigene TV-Oberfläche mit Pfeiltasten-Bedienung. Dieses Skript läuft auf allen
// http-Seiten, tut aber nur etwas, wenn die Seite ein Jellyfin-Server ist.
(() => {
  const isJellyfin = () =>
    !!document.querySelector("meta[name='application-name'][content='Jellyfin']") ||
    /^Jellyfin/.test(document.title) ||
    !!document.querySelector("#reactRoot.jellyfin, .skinHeader, .mainAnimatedPages");
  if (!isJellyfin()) return;

  // TV-Layout von Jellyfin (Einstellung "Anzeigemodus: TV") fest einschalten
  try {
    if (localStorage.getItem("layout") !== "tv") {
      localStorage.setItem("layout", "tv");
      location.reload();
      return;
    }
  } catch (e) { /* ohne Speicher: Desktop-Ansicht */ }

  const KEYS = {
    up: ["ArrowUp", 38], down: ["ArrowDown", 40], left: ["ArrowLeft", 37], right: ["ArrowRight", 39],
    ok: ["Enter", 13], back: ["Backspace", 8],
  };

  function press(name) {
    const [key, keyCode] = KEYS[name];
    const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
    const options = { key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true };
    const down = new KeyboardEvent("keydown", options);
    const handled = !target.dispatchEvent(down);
    target.dispatchEvent(new KeyboardEvent("keyup", options));
    if (handled) return;
    // Synthetische Tasten lösen keine Standardaktionen aus: Klicken bzw. Zurück selbst übernehmen
    if (name === "ok" && target !== document.body) target.click();
    else if (name === "back" && !/\/(home|login|selectserver)/.test(location.hash)) history.back();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.key && KEYS[message.key]) press(message.key);
  });
  // Hintergrunddienst wachhalten (er leitet die Tasten von RaspiTV weiter)
  setInterval(() => chrome.runtime.sendMessage({ cmd: "ping" }).catch(() => {}), 20000);
  chrome.runtime.sendMessage({ cmd: "ping" }).catch(() => {});
})();
