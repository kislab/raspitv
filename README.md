# RaspiTV

Mediacenter für den Raspberry Pi 4 im Stil von Google TV – bedienbar mit der Fernbedienung.

- **Startseite** (natives PyQt5-Programm): App-Kacheln für Netflix, Disney+, YouTube, Prime Video,
  Twitch, ARD, ZDF, Jellyfin und Spotify, Einstellungen, Zurück zum Desktop.
- **Player**: Chromium im Kioskmodus (nur für DRM-Videos), mit eigener Erweiterung `tv-extension/`,
  die Netflix, Disney+ und Prime Video wie die jeweilige TV-App aussehen lässt.
- **Jellyfin**: der Server im Heimnetz wird automatisch gefunden (Einstellungen → Jellyfin).
  Anmelden ohne Tastatur: „Quick Connect verwenden“ wählen und den Code in der Jellyfin-App am Handy bestätigen.
- **Kacheln anordnen**: OK lange gedrückt halten → Menü mit Öffnen, Verschieben, Ausblenden.
- **Fernbedienung**: HTTP-Schnittstelle auf `127.0.0.1:8765` (`POST /key {"key": "up"}`, `"menu"` = langes OK, `GET /status`).

## Installation

Ein Befehl im Terminal des Raspberry Pi (Raspberry Pi OS):

```bash
curl -fsSL https://raw.githubusercontent.com/kislab/raspitv/main/install.sh | bash
```

Das lädt RaspiTV nach `~/raspitv`, installiert fehlende Pakete (`python3-pyqt5`, `chromium`,
`libwidevinecdm0` … – fragt dafür nach dem sudo-Passwort) und legt RaspiTV als Programm an:
Symbol auf dem Desktop, Eintrag im Startmenü (Unterhaltung) und Autostart beim Hochfahren
(Terminal öffnet sich und lädt RaspiTV). Ohne Autostart: `… | bash -s -- --no-autostart`.
Derselbe Befehl aktualisiert eine bestehende Installation.

## Updates

Beim Start (Autostart) holt RaspiTV mit `git pull` automatisch die neueste Version aus diesem
Repository. Zusätzlich: Einstellungen → System → **Nach Updates suchen** – lädt die neue Version
und startet RaspiTV damit neu.

## Entwicklung

`dev/start.sh <app>` startet RaspiTV mit offenem DevTools-Port (9222) und öffnet eine App,
`dev/cdp.py` führt JavaScript in der Seite oder der Erweiterung aus, `dev/shot.sh` macht einen
Bildschirmfoto.

Logos und Markennamen gehören den jeweiligen Anbietern.
