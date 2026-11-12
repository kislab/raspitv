// Disney+, Seiten-Kontext (MAIN world, document_start): Brücke für die eigene TV-Oberfläche.
//
// Die Disney-Seite holt ihre Inhalte (Startseite, Serien, Staffeln …) über Disneys Schnittstelle; ihre
// Anfragen tragen einen Zugangsschlüssel. Diese Brücke merkt sich ihn (nur hier in der Seite, er verlässt sie
// nie) und stellt damit dieselben Anfragen. (Die PIN-Übergabe macht weiterhin disney-main.js.)
//
// Anfragen (postMessage vom Inhalts-Skript):  {tvdp: "req", id, op, args}
// Antworten:                                  {tvdp: "res", id, ok, data | error}   – nie der Schlüssel
(() => {
  let auth = null;
  const extra = {};          // weitere Köpfe, die Disney mitschickt (x-application-version …)
  const seen = [];           // zuletzt abgefragte Adressen der Schnittstelle (ohne Köpfe)
  const API = /^https:\/\/disney\.api\.edge\.bamgrid\.com\//;

  function remember(url, headers) {
    if (!API.test(url) || !headers) return;
    const entries = headers instanceof Headers ? [...headers.entries()]
      : Array.isArray(headers) ? headers : Object.entries(headers);
    for (const [k, v] of entries) {
      const name = k.toLowerCase();
      if (name === "authorization" && /^Bearer /.test(v)) auth = v;
      else if (/^x-(application-version|bamsdk-|dss-)/.test(name)) extra[name] = v;
    }
    if (/\/dust/.test(url)) return; // Statistik, keine Inhalte
    if (seen.length > 120) seen.shift();
    if (!seen.includes(url)) seen.push(url);
  }

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : input?.url || "";
      remember(url, init?.headers);
      if (input instanceof Request) remember(url, input.headers);
    } catch (e) { /* nie die Seite stören */ }
    return origFetch.apply(this, arguments);
  };
  const origOpen = XMLHttpRequest.prototype.open;
  const origSet = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__tvdpUrl = String(url);
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try { remember(this.__tvdpUrl || "", { [name]: value }); } catch (e) { /* egal */ }
    return origSet.apply(this, arguments);
  };

  async function get(url) {
    if (!auth) throw new Error("noch nicht bereit");
    const r = await origFetch(url, { headers: { authorization: auth, accept: "application/json", ...extra } });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error(data?.errors?.[0]?.description || data?.errors?.[0]?.code || `HTTP ${r.status}`);
    return data;
  }

  // Seitenwechsel ohne Neuladen: Disneys React-Router („navigator“ mit push) über die React-Interna eines
  // beliebigen Elements der Seite suchen und benutzen. Sonst (nicht gefunden) normal laden.
  let navigator = null;
  function findNavigator() {
    if (navigator) return navigator;
    const starts = [...document.querySelectorAll("a[href^='/browse'], a[href^='/home'], a[href^='/'], main *")].slice(0, 40);
    for (const start of starts) {
      const key = Object.keys(start).find((k) => k.startsWith("__reactFiber"));
      if (!key) continue;
      for (let f = start[key], depth = 0; f && depth < 400; f = f.return, depth++) {
        const nav = f.memoizedProps?.navigator;
        if (nav && typeof nav.push === "function") return (navigator = nav);
      }
    }
    return null;
  }
  function navigate(path) {
    const nav = findNavigator();
    if (nav) nav.push(path);
    else location.href = path;
    return !!nav;
  }

  // Solange die eigene Oberfläche die Disney-Seite nicht braucht: ihr „Tab im Hintergrund“ melden, damit
  // sie Karussell und andere Zeitgeber anhält (sie liefe sonst unsichtbar weiter, ~15 % CPU).
  let pretendHidden = false;
  const realHidden = Object.getOwnPropertyDescriptor(Document.prototype, "hidden");
  const realState = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
  Object.defineProperty(document, "hidden", { configurable: true, get() { return pretendHidden || realHidden.get.call(this); } });
  Object.defineProperty(document, "visibilityState", { configurable: true,
    get() { return pretendHidden ? "hidden" : realState.get.call(this); } });
  function setHidden(on) {
    if (pretendHidden === !!on) return false;
    pretendHidden = !!on;
    document.dispatchEvent(new Event("visibilitychange"));
    return true;
  }

  const ops = {
    hidden: async ({ on }) => setHidden(on),
    navigate: async ({ path }) => navigate(path),
    ready: async () => ({ ready: !!auth }),
    seen: async () => seen.map((u) => u.replace(/^https:\/\/[^/]+/, "")),
    get: ({ url }) => get(url),
  };

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.data?.tvdp !== "req") return;
    const { id, op, args } = event.data;
    try {
      if (!ops[op]) throw new Error(`unbekannt: ${op}`);
      const data = await ops[op](args || {});
      window.postMessage({ tvdp: "res", id, ok: true, data }, "*");
    } catch (error) {
      window.postMessage({ tvdp: "res", id, ok: false, error: String(error?.message || error) }, "*");
    }
  });
})();
