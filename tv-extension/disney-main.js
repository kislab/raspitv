// Läuft im Kontext der Disney+-Seite (nicht der Erweiterung), weil nur dort Disneys eigene
// Eingabe-Handler erreichbar sind. Empfängt die PIN von disney-app.js.
(() => {
  // Disneys PIN-Felder nehmen weder gesetzte Werte noch nachgebaute Tastendrücke an,
  // wohl aber "Einfügen" einer ganzen PIN – genau das wird hier ausgelöst.
  window.addEventListener("tv-disney-pin", (event) => {
    const pin = String(event.detail || "");
    const input = document.querySelector("[data-testid='digit-0']");
    if (!input) return;
    const key = Object.keys(input).find((k) => k.startsWith("__reactEventHandlers") || k.startsWith("__reactProps"));
    const handlers = key && input[key];
    if (!handlers || !handlers.onPaste) return;
    handlers.onPaste({
      clipboardData: { getData: () => pin },
      preventDefault() {},
      stopPropagation() {},
      target: input,
      currentTarget: input,
    });
  });
})();
