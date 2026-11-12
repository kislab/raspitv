// Prime lädt für Detailseiten die ganze Seite neu. Bis prime-tv.js läuft (document_idle), wäre kurz die
// Original-Seite zu sehen. Darum gleich beim Laden ausblenden; prime-tv.js nimmt das zurück, sobald es weiß,
// was gezeigt wird (eigene Oberfläche oder – im Player, bei der Anmeldung – die Seite selbst).
document.documentElement.classList.add("pv-boot");
setTimeout(() => document.documentElement.classList.remove("pv-boot"), 12000); // Sicherheit
