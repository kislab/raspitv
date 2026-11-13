// Spotify, Seiten-Kontext (MAIN world, document_start): Brücke für die eigene TV-Oberfläche (spotify-app.js).
//
// Der Web-Player meldet sich selbst bei Spotify an; seine Anfragen tragen einen Zugangsschlüssel. Diese Brücke
// merkt sich ihn (nur hier in der Seite, er verlässt sie nie) und stellt damit dieselben Anfragen wie der
// Web-Player: Daten über dessen GraphQL-Schnittstelle (die öffentliche api.spotify.com sperrt den Web-Player)
// und Abspielen per „play“-Befehl an genau dieses Gerät.
//
// Anfragen (postMessage vom Inhalts-Skript):  {tvsp: "req", id, op, args}
// Antworten:                                  {tvsp: "res", id, ok, data | error}   – nie der Schlüssel
(() => {
  let auth = null;          // "Bearer …" des Web-Players
  let clientToken = null;   // zusätzlicher Kopf, den der Web-Player mitschickt

  function remember(headers) {
    if (!headers) return;
    const get = (name) => (headers instanceof Headers ? headers.get(name)
      : Array.isArray(headers) ? (headers.find(([k]) => k.toLowerCase() === name) || [])[1]
        : headers[name] || headers[name.replace(/(^|-)\w/g, (m) => m.toUpperCase())]);
    const a = get("authorization");
    if (a && /^Bearer /.test(a)) auth = a;
    const c = get("client-token");
    if (c) clientToken = c;
  }

  // GraphQL-Abfragen des Web-Players (api-partner …/pathfinder): Name → {url, sha256Hash}. So können wir
  // dieselben Abfragen mit eigenen Variablen stellen (die Kennungen ändern sich mit neuen Spotify-Versionen).
  const gqlOps = {};
  let lastCommand = null;   // letzter Wiedergabe-Befehl des Web-Players (Adresse + Inhalt, ohne Schlüssel)
  let spclient = null;      // Wiedergabe-Server
  let deviceId = null;      // dieses Web-Player-Gerät
  const playerUrls = [];    // zuletzt benutzte Player-Adressen (Fehlersuche, ohne Schlüssel)
  function rememberGql(url, body) {
    try {
      if (!/pathfinder/.test(url)) return;
      let name, hash, vars;
      if (body && typeof body === "string") {
        const b = JSON.parse(body);
        name = b.operationName;
        hash = b.extensions?.persistedQuery?.sha256Hash;
        vars = b.variables;
      } else {
        const u = new URL(url);
        name = u.searchParams.get("operationName");
        hash = JSON.parse(u.searchParams.get("extensions") || "{}").persistedQuery?.sha256Hash;
        vars = JSON.parse(u.searchParams.get("variables") || "{}");
      }
      if (name && hash) gqlOps[name] = { url: url.split("?")[0], hash, vars };
    } catch (e) { /* egal */ }
  }

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : input?.url || "";
      if (/spotify\.com/.test(url)) {
        remember(init?.headers);
        if (input instanceof Request) remember(input.headers);
        rememberGql(url, init?.body);
        if (/connect-state\/v1\/player\/command/.test(url) && typeof init?.body === "string") {
          lastCommand = { url, body: init.body };
        }
        // Gerät dieses Web-Players und Wiedergabe-Server (z. B. https://gew4-spclient.spotify.com)
        // Die volle Kennung (40 Zeichen) steht bei track-playback bzw. im Play-Befehl des Web-Players;
        // connect-state/…/hobs_<id> enthält nur eine gekürzte – damit antwortet Spotify mit 404.
        const dev = url.match(/^(https:\/\/[^/]+)\/(?:track-playback\/v1\/devices\/|connect-state\/v1\/player\/command\/from\/)([0-9a-f]{40})\b/);
        if (dev) { spclient = dev[1]; deviceId = dev[2]; }
        if (/connect-state|track-playback|player/.test(url)) {
          playerUrls.push(`${init?.method || "GET"} ${url.replace(/^https:\/\/[^/]+/, "").split("?")[0].slice(0, 140)}`);
          if (playerUrls.length > 25) playerUrls.shift();
        }
      }
    } catch (e) { /* nie die Seite stören */ }
    return origFetch.apply(this, arguments);
  };
  const origSet = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try {
      const n = String(name).toLowerCase();
      if (n === "authorization" && /^Bearer /.test(value)) auth = value;
      if (n === "client-token") clientToken = value;
    } catch (e) { /* nie die Seite stören */ }
    return origSet.apply(this, arguments);
  };


  // Kennungen aller Abfragen stehen in den Skripten des Web-Players ("name","query","<sha256>") – einmal
  // auslesen, dann kennen wir auch Abfragen, die die Seite selbst noch nicht gestellt hat.
  let scanned = null;
  function scanScripts() {
    if (!scanned) {
      scanned = (async () => {
        const urls = [...new Set(performance.getEntriesByType("resource").map((e) => e.name)
          .filter((u) => /\.js(\?|$)/.test(u) && /spotifycdn|open\.spotify/.test(u)))];
        for (const u of urls) {
          try {
            const text = await (await origFetch(u)).text();
            for (const m of text.matchAll(/"(\w+)","(?:query|mutation)","([0-9a-f]{64})"/g)) {
              if (!gqlOps[m[1]]) gqlOps[m[1]] = { url: "https://api-partner.spotify.com/pathfinder/v2/query", hash: m[2], vars: null };
            }
          } catch (e) { /* nächste Datei */ }
        }
      })();
    }
    return scanned;
  }

  async function gql(name, variables) {
    if (!gqlOps[name]) await scanScripts();
    const op = gqlOps[name];
    if (!op) throw new Error(`Abfrage ${name} noch unbekannt`);
    if (!auth) throw new Error("noch nicht bereit");
    const headers = { authorization: auth, accept: "application/json", "content-type": "application/json;charset=UTF-8" };
    if (clientToken) headers["client-token"] = clientToken;
    const r = await origFetch(op.url, {
      method: "POST", headers,
      body: JSON.stringify({ variables, operationName: name, extensions: { persistedQuery: { version: 1, sha256Hash: op.hash } } }),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error(data?.errors?.[0]?.message || `HTTP ${r.status}`);
    return data;
  }

  const ops = {
    ready: async () => ({ ready: !!auth, player: !!(spclient && deviceId), gql: Object.keys(gqlOps) }),
    gql: ({ name, variables }) => gql(name, { ...(gqlOps[name]?.vars || {}), ...(variables || {}) }),
    template: ({ name }) => gqlOps[name]?.vars || null,
    diag: () => ({ spclient, deviceId, playerUrls }),
    // Abspielen wie der Web-Player selbst: „play“-Befehl an dieses Gerät. context = Playlist/Album/…-URI,
    // trackUri/index = ab diesem Titel.
    async play({ context, trackUri, index }) {
      if (!auth || !spclient || !deviceId) throw new Error("Player noch nicht bereit");
      const tmpl = lastCommand ? JSON.parse(lastCommand.body).command : null;
      const skip = {};
      if (trackUri) skip.track_uri = trackUri;
      if (Number.isInteger(index)) skip.track_index = index;
      const command = {
        context: { uri: context, url: `context://${context}`, metadata: {} },
        play_origin: tmpl?.play_origin || { feature_identifier: "your_library", feature_version: "web-player", referrer_identifier: "your_library" },
        options: { license: "tft", skip_to: skip, player_options_override: {} },
        logging_params: { command_id: [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("") },
        endpoint: "play",
      };
      const headers = { authorization: auth, "content-type": "application/json" };
      if (clientToken) headers["client-token"] = clientToken;
      const r = await origFetch(`${spclient}/connect-state/v1/player/command/from/${deviceId}/to/${deviceId}`, {
        method: "POST", headers, body: JSON.stringify({ command }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return true;
    },
  };

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.data?.tvsp !== "req") return;
    const { id, op, args } = event.data;
    try {
      if (!ops[op]) throw new Error(`unbekannt: ${op}`);
      const data = await ops[op](args || {});
      window.postMessage({ tvsp: "res", id, ok: true, data }, "*");
    } catch (error) {
      window.postMessage({ tvsp: "res", id, ok: false, error: String(error?.message || error) }, "*");
    }
  });
})();
