#!/bin/bash
# Raspberry Pi OS für RaspiTV entschlacken – alles, was nur Leistung, Startzeit oder Platz kostet und für einen
# TV-Pi nichts bringt. Vollständig umkehrbar:
#   ~/raspitv/boot/slim.sh          entschlacken (fragt nach dem sudo-Passwort)
#   ~/raspitv/boot/slim.sh --undo   alles wiederherstellen (auch Teil der Deinstallation)
#
# Bleibt bewusst erhalten: Desktop und Taskleiste, Bluetooth, WLAN, SSH, Tailscale, Raspberry Pi Connect,
# avahi (raspi.local), Ton (PipeWire), Schlüsselbund (Chromium-Logins), Firmware-Updates (rpi-eeprom).
set -uo pipefail

STATE="${XDG_CONFIG_HOME:-$HOME/.config}/raspitv/slim"
DIR="$(dirname "$(dirname "$(readlink -f "$0")")")"
say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }

# Programme, die RaspiTV nicht braucht (Drucken, Cloud-Einrichtung, zweiter Browser, Video-Player, alter
# VNC-Server für X11, Bildschirmtastatur für Touch, Entwicklungs-Werkzeuge, Kernel für den Pi 5)
PACKAGES="cloud-init rpi-cloud-init-mods cups cups-browsed cups-daemon cups-client hplip realvnc-vnc-server
  firefox rpi-firefox-mods vlc vlc-bin vlc-l10n rpi-imager rpi-userguide squeekboard thonny python3-mypy mypy
  mkvtoolnix linux-image-rpi-2712 linux-headers-rpi-v8 linux-headers-rpi-2712"
# Was RaspiTV (und der Desktop) braucht, darf beim Aufräumen der Abhängigkeiten nie mitgehen
KEEP="git python3 python3-pyqt5 python3-pyqt5.qtquick qml-module-qtquick2 qml-module-qtquick-window2
  qml-module-qtgraphicaleffects mpv chromium libwidevinecdm0 lxterminal libqrencode4 fonts-noto-color-emoji
  sound-theme-freedesktop libcanberra0 libadwaita-1-0 libaribb24-0t64 wlr-randr grim labwc wf-panel-pi pcmanfm
  rpi-connect tailscale"
# Dienste: Warten aufs Netz beim Start (RaspiTV wartet selbst höchstens 5 s), NFS, Pi-5-/X11-Tests, System-VNC,
# tägliche Paket-Downloads und Handbuch-Index im Hintergrund
UNITS="NetworkManager-wait-online.service rpcbind.service rpcbind.socket nfs-blkmap.service rp1-test.service
  glamor-test.service wayvnc-control.service apt-daily.timer apt-daily-upgrade.timer man-db.timer"
# Benutzerdienste: Geräte-Erkennung für iPhone, Online-Konten, Digitalkameras, Android-Handys (MTP)
USER_UNITS="gvfs-afc-volume-monitor.service gvfs-goa-volume-monitor.service gvfs-gphoto2-volume-monitor.service
  gvfs-mtp-volume-monitor.service"
CONFIG=/boot/firmware/config.txt
JOURNAL=/etc/systemd/journald.conf.d/raspitv.conf

if [ "${1:-}" = "--undo" ]; then
  [ -d "$STATE" ] || { echo "Nichts zurückzustellen (RaspiTV hat das System nicht entschlackt)."; exit 0; }
  say "Stelle das ursprüngliche Raspberry Pi OS wieder her (sudo-Passwort nötig)"
  sudo -v || exit 1
  if [ -s "$STATE/packages" ]; then
    say "Installiere die entfernten Programme wieder"
    sudo apt-get update -q
    # shellcheck disable=SC2046
    sudo apt-get install -y $(cat "$STATE/packages") || echo "!! Nicht alle Pakete ließen sich installieren"
  fi
  for u in $(cat "$STATE/units" 2>/dev/null); do sudo systemctl unmask "$u" 2>/dev/null; sudo systemctl enable "$u" 2>/dev/null; done
  for u in $(cat "$STATE/user-units" 2>/dev/null); do systemctl --user unmask "$u" 2>/dev/null; done
  [ -f "$STATE/config.txt" ] && sudo cp "$STATE/config.txt" "$CONFIG"
  sudo rm -f "$JOURNAL"
  sudo systemctl restart systemd-journald 2>/dev/null
  rm -rf "$STATE"
  say "Fertig – wirksam nach dem nächsten Neustart"
  exit 0
fi

say "Entschlacke Raspberry Pi OS für RaspiTV (umkehrbar mit: $0 --undo)"
sudo -v || exit 1
mkdir -p "$STATE"

# 1. Programme
INSTALLED=""
for p in $PACKAGES; do dpkg -s "$p" >/dev/null 2>&1 && INSTALLED="$INSTALLED $p"; done
if [ -n "$INSTALLED" ]; then
  say "Entferne:$INSTALLED"
  # merken (auch schon früher entfernte nicht vergessen), damit --undo sie wieder installiert
  { cat "$STATE/packages" 2>/dev/null; for p in $INSTALLED; do echo "$p"; done; } | sort -u > "$STATE/packages.new"
  mv "$STATE/packages.new" "$STATE/packages"
  NEEDED=""
  for p in $KEEP; do dpkg -s "$p" >/dev/null 2>&1 && NEEDED="$NEEDED $p"; done
  # shellcheck disable=SC2086
  sudo apt-mark manual $NEEDED >/dev/null
  # shellcheck disable=SC2086
  sudo apt-get remove --purge -y $INSTALLED && sudo apt-get autoremove --purge -y
  sudo apt-get clean
fi

# 2. Dienste
for u in $UNITS; do
  if systemctl is-enabled "$u" >/dev/null 2>&1; then
    echo "$u" >> "$STATE/units"
    sudo systemctl disable --now "$u" 2>/dev/null
  fi
done
for u in $USER_UNITS; do
  if [ "$(systemctl --user is-enabled "$u" 2>/dev/null)" != "masked" ]; then
    echo "$u" >> "$STATE/user-units"
    systemctl --user mask --now "$u" 2>/dev/null
  fi
done
sort -u -o "$STATE/units" "$STATE/units" 2>/dev/null
sort -u -o "$STATE/user-units" "$STATE/user-units" 2>/dev/null

# 3. Start: keine Suche nach Kamera und DSI-Bildschirm
if [ ! -f "$STATE/config.txt" ]; then
  cp "$CONFIG" "$STATE/config.txt"
  sudo sed -i 's/^camera_auto_detect=1/camera_auto_detect=0  # RaspiTV/; s/^display_auto_detect=1/display_auto_detect=0  # RaspiTV/' "$CONFIG"
fi

# 4. Protokolle nur im Arbeitsspeicher (schont die SD-Karte, weniger Schreiben im Betrieb)
sudo mkdir -p "$(dirname "$JOURNAL")"
printf '# RaspiTV (boot/slim.sh): Protokolle im Arbeitsspeicher\n[Journal]\nStorage=volatile\nRuntimeMaxUse=30M\n' | sudo tee "$JOURNAL" >/dev/null
sudo systemctl restart systemd-journald

say "Fertig. Ganz wirksam nach einem Neustart."
df -h / | tail -1 | awk '{print "   Freier Speicher jetzt: " $4}'
