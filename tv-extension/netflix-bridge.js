// Netflix, Seiten-Kontext (MAIN world): Brücke für die eigene TV-Oberfläche (netflix-tv.js).
//
// Die Netflix-Seite holt ihre Inhalte über GraphQL (Apollo-Client unter netflix.appContext.state.graphqlClient).
// Diese Brücke merkt sich die Abfragen, die die Seite selbst stellt (Startseite, Detailansicht, Staffeln,
// Suche …) – auch über Neustarts hinweg im localStorage – und stellt sie mit anderen Werten erneut
// (z. B. eine andere Serie). Zugangsdaten braucht sie dafür nicht: der Client der Seite erledigt das.
//
// Anfragen (postMessage vom Inhalts-Skript):  {tvnf: "req", id, op, args}
// Antworten:                                  {tvnf: "res", id, ok, data | error}
(() => {
  const STORE = "raspitv-nf-docs";
  const docs = {};   // Name → {doc, vars}  (doc ohne Quelltext-Positionen, damit speicherbar)
  try { Object.assign(docs, JSON.parse(localStorage.getItem(STORE) || "{}")); } catch (e) { /* leer anfangen */ }

  const client = () => window.netflix?.appContext?.state?.graphqlClient || null;
  const strip = (doc) => JSON.parse(JSON.stringify(doc, (k, v) => (k === "loc" ? undefined : v)));
  const opName = (doc) => doc?.definitions?.find((d) => d.kind === "OperationDefinition")?.name?.value || "";
  let dirty = false;
  function remember(doc, vars) {
    const name = opName(doc);
    if (!name || /^CLCS/.test(name)) return;
    const known = docs[name];
    // Startseite: die Grundwerte der eigentlichen Startseite merken (nicht die einer Kategorie)
    if (known && name === "GetBrowsePage" && vars?.categoryId != null) return;
    if (known && known.vars && JSON.stringify(known.vars) === JSON.stringify(vars)) return;
    docs[name] = { doc: strip(doc), vars: JSON.parse(JSON.stringify(vars || {})) };
    dirty = true;
  }
  function save() {
    if (!dirty) return;
    dirty = false;
    try { localStorage.setItem(STORE, JSON.stringify(docs)); } catch (e) { /* voll o. Ä. */ }
  }

  // Abfragen der Seite einsammeln (laufende Abfragen des Clients) und Änderungen (Mutationen) mitschneiden
  let hooked = null;
  function scan() {
    const c = client();
    if (!c) return;
    if (hooked !== c) {
      hooked = c;
      const mutate = c.mutate.bind(c);
      c.mutate = (options) => {
        try { remember(options.mutation, options.variables); } catch (e) { /* nie die Seite stören */ }
        return mutate(options);
      };
      // einmalige Abfragen (ohne Beobachtung) tauchen in queryManager nicht auf
      const query = c.query.bind(c);
      c.query = (options) => {
        try { if (!options.__tvnf) remember(options.query, options.variables); } catch (e) { /* egal */ }
        return query(options);
      };
    }
    for (const [, q] of c.queryManager?.queries || []) {
      try { if (q.document) remember(q.document, q.variables); } catch (e) { /* egal */ }
    }
    save();
  }
  setInterval(scan, 1500);

  async function run({ name, vars, policy }) {
    scan();
    const c = client();
    const known = docs[name];
    if (!c) throw new Error("noch nicht bereit");
    if (!known) throw new Error(`unbekannt: ${name}`);
    const variables = { ...known.vars, ...(vars || {}) };
    const isMutation = known.doc.definitions.some((d) => d.operation === "mutation");
    const r = isMutation ? await c.mutate({ mutation: known.doc, variables })
      : await c.query({ query: known.doc, variables, fetchPolicy: policy || "no-cache", __tvnf: true });
    if (!r.data && r.errors) throw new Error(r.errors[0]?.message || "Fehler");
    return r.data;
  }

  // Seitenwechsel innerhalb der Netflix-App (ohne Neuladen)
  function nav(path) {
    const h = window.netflix?.appContext?.state?.history;
    if (h && typeof h.pushState === "function") { h.pushState(path); return true; }
    location.href = path;
    return false;
  }

  const OPS = {
    ready: () => { scan(); return { ready: !!client(), have: Object.keys(docs) }; },
    q: run,
    nav: ({ path }) => nav(path),
    forget: ({ name }) => { delete docs[name]; dirty = true; save(); return true; },
  };

  window.addEventListener("message", async (event) => {
    const m = event.data;
    if (event.source !== window || !m || m.tvnf !== "req") return;
    try {
      const data = await OPS[m.op](m.args || {});
      window.postMessage({ tvnf: "res", id: m.id, ok: true, data }, "*");
    } catch (error) {
      window.postMessage({ tvnf: "res", id: m.id, ok: false, error: String(error?.message || error) }, "*");
    }
  });
})();
