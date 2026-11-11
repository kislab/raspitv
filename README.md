# RaspiTV

Mediacenter für den Raspberry Pi 4 im Stil von Google TV – bedienbar mit der Fernbedienung.

- **Startseite** (Python + Qt Quick/QML, von der Grafikeinheit gezeichnet): App-Kacheln für Netflix,
  Disney+, YouTube, Prime Video, Twitch, ARD, ZDF, Jellyfin und Spotify, Einstellungen, Zurück zum Desktop.
  Logik und Zustand in Python (`raspitv.py`, `profiles_ui.py`), Oberfläche in `qml/`.
- **App-Store**: Reihe „Verfügbare Apps“ unter „Deine Apps“ (ARTE, Joyn, RTL+, Apple TV+ …) – OK installiert;
  deinstallieren über das Kachel-Menü oder Einstellungen → Apps.
- **Player**: Chromium im Kioskmodus (nur für DRM-Videos), mit eigener Erweiterung `tv-extension/`,
  die Netflix, Disney+ und Prime Video wie die jeweilige TV-App aussehen lässt.
- **Jellyfin** als eigene App in RaspiTV (`jellyfin.py`, `jellyfin_ui.py`, `qml/Jellyfin.qml`): Start (Weiterschauen,
  Nächste Folgen, Neu in …), Bibliotheken, Suche, Detailseite mit Staffeln/Folgen; Leiste oben (◀ ▶ wählen,
  ▼ in den Inhalt, ▲ zurück). Abspielen mit mpv: H.264 per Hardware-Dekoder direkt auf den Bildschirm
  (`vo=dmabuf-wayland`, ruckelfrei), eigene Player-Leiste (`jellyfin_osd.py`: Titel, Fortschritt, Restzeit,
  „endet um“; OK = Pause, ◀ ▶ = 10 s, ▲ ▼ = 1 min, Menü = Ton & Untertitel, Zurück = Leiste weg bzw. beenden).
  Jellyfin-Einstellungen in der App: Serveradresse ändern oder im Heimnetz suchen,
  Anmelden per Quick Connect oder Name/Passwort (je RaspiTV-Konto).
  Anmelden ohne Tastatur: „Quick Connect verwenden“ wählen und den Code in der Jellyfin-App am Handy bestätigen.
- **Konten**: „Wer schaut?“ wie bei Google TV. Jedes Konto hat eigene Logins bei Netflix, Disney+,
  YouTube, Prime Video & Co. (eigenes Browser-Profil), eigene Kachel-Reihenfolge und optional eine PIN.
  Wechseln: Konto-Symbol oben links; bearbeiten: OK auf einem Konto lange drücken.
- **WLAN und Bluetooth**: Einstellungen → System → WLAN (Netz wählen, Passwort über die Bildschirmtastatur)
  bzw. Bluetooth (Kopfhörer, Lautsprecher, Controller koppeln). Das verbundene WLAN steht oben rechts neben dem Zahnrad.
- **Bluetooth-Fernbedienung** (auch Alexa-/Fire-TV-Fernbedienung): Einstellungen → System → Bluetooth →
  Nach Geräten suchen, Fernbedienung in den Kopplungsmodus (Home ~10 s halten), „Koppeln“. RaspiTV liest sie
  selbst (`remote_input.py`, auch während Netflix & Co. laufen), verbindet sie nach dem Einschlafen beim
  nächsten Tastendruck wieder und beantwortet Kopplungsanfragen selbst (kein Desktop-Fenster). Symbol oben
  rechts: hell = verbunden, durchgestrichen = schläft/getrennt. Nötig: Bluetooth-„Privacy“ (macht der Installer).
- **Kacheln anordnen**: OK lange gedrückt halten → Menü mit Öffnen, Verschieben, Deinstallieren.
- **Lautstärke**: Lautstärke-Tasten der Fernbedienung stellen den Standard-Audioausgang (PipeWire); unter 20 % in
  2er-, sonst in 5er-Schritten, „lauter“ hebt Stumm auf. Anzeige als senkrechte Leiste links – gleich in RaspiTV
  (`qml/VolumeOsd.qml`), im Jellyfin-Player (`jellyfin_osd.volume`) und in Netflix/Disney+/Prime (`tv-extension/tv.js`).
- **Fernbedienung**: HTTP-Schnittstelle auf `127.0.0.1:8765` (`POST /key {"key": "up"}`, `"menu"` = langes OK,
  `"volumeup"`/`"volumedown"`/`"mute"`, `GET /status`).

## Installation

Ein Befehl im Terminal des Raspberry Pi (Raspberry Pi OS):

```bash
curl -fsSL https://raw.githubusercontent.com/kislab/raspitv/main/install.sh | bash
```

Das lädt RaspiTV nach `~/raspitv`, installiert fehlende Pakete (`python3-pyqt5`, Qt Quick, `chromium`,
`libwidevinecdm0` … – fragt dafür nach dem sudo-Passwort) und legt RaspiTV als Programm an:
Symbol auf dem Desktop, Eintrag im Startmenü (Unterhaltung) und Autostart beim Hochfahren
(Terminal öffnet sich und lädt RaspiTV). Beim Hochfahren ist der Desktop nicht zu sehen: ein Startbild mit dem
RaspiTV-Logo (`splash.py`, gestartet über `~/.config/labwc/autostart` noch vor Desktop und Leiste, per Fensterregel
in `~/.config/labwc/rc.xml` immer oben) zeigt „Starte …“, „Suche nach Updates …“ und bleibt, bis RaspiTV zu sehen ist. Ohne Autostart: `… | bash -s -- --no-autostart`.
Derselbe Befehl aktualisiert eine bestehende Installation.

Der Installer richtet außerdem das **RaspiTV-Bootbild** ein (Logo statt Regenbogen und Raspberry-Pi-Bild,
Plymouth-Thema `boot/plymouth/`). Ohne: `… | bash -s -- --no-bootlogo`; rückgängig:
`sudo ~/raspitv/boot/install-bootlogo.sh --remove`. Das Logo zeichnet `boot/make-logo.py`.

## Deinstallieren

Doppelklick auf **„RaspiTV deinstallieren“** auf dem Desktop (oder `~/raspitv/uninstall.sh`). Nach der
Bestätigung mit „ja“ entfernt es alles, was der Installer angelegt hat, und stellt das System wieder her:
Autostart, Startmenü-Eintrag und Desktop-Symbole, Bootbild (vorheriges Plymouth-Thema, `cmdline.txt`,
`config.txt`), Bluetooth-Einstellung (`/etc/bluetooth/main.conf` aus der Sicherung), die von RaspiTV
nachinstallierten Pakete (der Installer merkt sie sich in `~/.config/raspitv/installed-packages`), alle
Einstellungen, Konten und Logins sowie `~/raspitv`. Gekoppelte Bluetooth-Geräte und WLAN bleiben.

## Updates

Beim Start (Autostart) holt RaspiTV mit `git pull` automatisch die neueste Version aus diesem
Repository. Zusätzlich: Einstellungen → System → **Nach Updates suchen** – lädt die neue Version
und startet RaspiTV damit neu.

## Entwicklung

`dev/start.sh <app>` startet RaspiTV mit offenem DevTools-Port (9222) und öffnet eine App,
`dev/cdp.py` führt JavaScript in der Seite oder der Erweiterung aus, `dev/shot.sh` macht einen
Bildschirmfoto.

Logos und Markennamen gehören den jeweiligen Anbietern.
