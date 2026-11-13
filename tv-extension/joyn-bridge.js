// Joyn, Seiten-Kontext (MAIN world, document_start): Brücke für die eigene TV-Oberfläche (joyn-app.js).
//
// Joyns Seite fragt ihre Inhalte als gespeicherte GraphQL-Abfragen bei api.joyn.de ab (GET mit Name, Variablen
// und Hash) und schickt dabei Schlüssel und einen (anonymen) Zugang mit. Die Brücke merkt sich je Abfrage den
// Hash und die Köpfe – nur hier in der Seite, sie verlassen sie nie – und stellt dieselben Abfragen mit anderen
// Variablen (andere Serie, andere Seite …). Hashes überleben einen Neustart im localStorage.
//
// Anfragen (postMessage):  {tvjn: "req", id, op, args}     Antworten: {tvjn: "res", id, ok, data | error}
(() => {
  const STORE = "raspitv-joyn-ops";
  const ops = {};          // Name → {hash, params}
  let headers = {};        // Köpfe der Seite (x-api-key, joyn-platform, authorization …)
  try { Object.assign(ops, JSON.parse(localStorage.getItem(STORE) || "{}")); } catch (e) { /* leer */ }
  const API = /^https:\/\/api\.joyn\.de\/graphql/;

  function remember(url, h) {
    if (!API.test(url)) return;
    const entries = h instanceof Headers ? [...h.entries()] : Array.isArray(h) ? h : Object.entries(h || {});
    for (const [k, v] of entries) headers[k.toLowerCase()] = v;
    try {
      const u = new URL(url);
      const name = u.searchParams.get("operationName");
      const hash = JSON.parse(u.searchParams.get("extensions") || "{}")?.persistedQuery?.sha256Hash;
      if (!name || !hash) return;
      const params = {};
      for (const [k, v] of u.searchParams) if (!["operationName", "variables", "extensions"].includes(k)) params[k] = v;
      if (ops[name]?.hash !== hash) {
        ops[name] = { hash, params };
        localStorage.setItem(STORE, JSON.stringify(ops));
      }
    } catch (e) { /* egal */ }
  }

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : input?.url || String(input);
      if (API.test(url)) remember(url, input instanceof Request ? input.headers : init?.headers);
    } catch (e) { /* nie die Seite stören */ }
    return origFetch.apply(this, arguments);
  };
  const origOpen = XMLHttpRequest.prototype.open;
  const origSet = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) { this.__tvjn = String(url); return origOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try { if (API.test(this.__tvjn || "")) remember(this.__tvjn, { [k]: v }); } catch (e) { /* egal */ }
    return origSet.apply(this, arguments);
  };

  async function q({ name, vars }) {
    const op = ops[name];
    if (!op) throw new Error(`unbekannt: ${name}`);
    if (!headers["x-api-key"]) throw new Error("noch nicht bereit");
    const u = new URL("https://api.joyn.de/graphql");
    u.searchParams.set("operationName", name);
    for (const [k, v] of Object.entries(op.params || {})) u.searchParams.set(k, v);
    u.searchParams.set("variables", JSON.stringify(vars || {}));
    u.searchParams.set("extensions", JSON.stringify({ persistedQuery: { version: 1, sha256Hash: op.hash } }));
    const h = { ...headers };
    delete h["content-type"];
    const r = await origFetch(u.toString(), { headers: h });
    const data = await r.json().catch(() => null);
    if (!data) throw new Error(`HTTP ${r.status}`);
    if (!data.data && data.errors) throw new Error(data.errors[0]?.message || "Fehler");
    return data.data;
  }

  // Seitenwechsel ohne Neuladen über den Next.js-Router der Seite
  function nav({ path }) {
    const router = window.next?.router;
    if (router?.push) { router.push(path); return true; }
    location.href = path;
    return false;
  }

  // Suche: Joyn sucht über Algolia; den Such-Schlüssel liefert Joyns Schnittstelle (bleibt hier in der Seite)
  let algoliaKey = null;
  async function search({ term }) {
    if (!algoliaKey) algoliaKey = (await q({ name: "AlgoliaApiKey", vars: {} }))?.searchApiKey;
    if (!algoliaKey) throw new Error("Suche nicht verfügbar");
    const body = { requests: [{ indexName: "indexion_prod_vod", facetFilters: [["type:SERIES", "type:COMPILATION", "type:MOVIE"]],
      filters: "distributionTenant:JOYN", hitsPerPage: 50, query: term }] };
    const r = await origFetch("https://ffqrv35svv-dsn.algolia.net/1/indexes/*/queries", {
      method: "POST", body: JSON.stringify(body),
      headers: { "x-algolia-application-id": "FFQRV35SVV", "x-algolia-api-key": algoliaKey, "content-type": "application/json" },
    });
    const d = await r.json();
    return d?.results?.[0]?.hits || [];
  }

  const OPS = {
    ready: () => ({ ready: !!headers["x-api-key"], have: Object.keys(ops) }),
    q,
    nav,
    search,
  };
  window.addEventListener("message", async (event) => {
    const m = event.data;
    if (event.source !== window || !m || m.tvjn !== "req") return;
    try {
      window.postMessage({ tvjn: "res", id: m.id, ok: true, data: await OPS[m.op](m.args || {}) }, "*");
    } catch (error) {
      window.postMessage({ tvjn: "res", id: m.id, ok: false, error: String(error?.message || error) }, "*");
    }
  });
})();
