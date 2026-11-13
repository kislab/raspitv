// Mediatheken mit eigener TV-Oberfläche (ARD, ZDF …): von der Webseite bleibt nur das leere Gerüst.
// Ihre Skripte lädt der Browser gar nicht erst (Regel in media-rules.json), ihr Inhalt wird ausgeblendet
// (media-app.css), und media-app.js baut die eigene Oberfläche. Inhalte kommen aus den offenen Schnittstellen
// der Sender, Videos spielt ein eigener Player – so braucht der Pi nur einen Bruchteil der Rechenzeit.
document.documentElement.classList.add("tvm-app");
