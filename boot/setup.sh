#!/bin/bash
# Einzelne Einrichtungsschritte von RaspiTV – aufgerufen vom grafischen Installer (installer.py) oder,
# ohne Bildschirm, von install.sh --no-gui nacheinander:
#   boot/setup.sh packages | entries | autostart | bootlogo | bluetooth | power | slim | all
# Systemänderungen laufen über sudo; install.sh hat das Passwort schon einmal abgefragt.
set -uo pipefail

DIR="$(dirname "$(dirname "$(readlink -f "$0")")")"
STATE="${XDG_CONFIG_HOME:-$HOME/.config}/raspitv"
say() { printf '==> %s\n' "$*"; }
SUDO="sudo"
[ -n "${RASPITV_SUDO_N:-}" ] && SUDO="sudo -n"  # im grafischen Installer: nie nach einem Passwort fragen

# alles, was RaspiTV braucht (install.sh installiert vorab schon das, was die Oberfläche selbst braucht)
PACKAGES="git python3 python3-pyqt5 python3-pyqt5.qtquick qml-module-qtquick2 qml-module-qtquick-window2
  qml-module-qtgraphicaleffects mpv chromium libwidevinecdm0 lxterminal libqrencode4 fonts-noto-color-emoji
  v4l-utils"

step_packages() {
  local missing=""
  for p in $PACKAGES; do dpkg -s "$p" >/dev/null 2>&1 || missing="$missing $p"; done
  if [ -z "$missing" ]; then say "Alle Programme sind schon da"; return 0; fi
  say "Installiere:$missing"
  $SUDO apt-get update -q || return 1
  # shellcheck disable=SC2086
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y $missing || return 1
  # merken, was RaspiTV nachinstalliert hat – nur das entfernt die Deinstallation wieder
  mkdir -p "$STATE"
  { cat "$STATE/installed-packages" 2>/dev/null; for p in $missing; do echo "$p"; done; } | sort -u > "$STATE/installed-packages.new"
  mv "$STATE/installed-packages.new" "$STATE/installed-packages"
}

step_entries() {
  local icon="$DIR/logos/raspitv-icon.png"
  local apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  local desktop
  desktop="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
  mkdir -p "$apps" "$desktop"
  local entry="[Desktop Entry]
Type=Application
Name=RaspiTV
Comment=TV-Oberfläche für Netflix, Disney+, YouTube, Prime Video, Jellyfin und mehr
Exec=bash -c \"cd '$DIR' && git pull --ff-only -q; exec python3 raspitv.py\"
Icon=$icon
Terminal=false
Categories=AudioVideo;Video;
StartupNotify=false"
  say "Startmenü-Eintrag und Desktop-Symbole"
  printf '%s\n' "$entry" > "$apps/raspitv.desktop"
  printf '%s\n' "$entry" > "$desktop/RaspiTV.desktop"
  chmod +x "$desktop/RaspiTV.desktop"
  gio set "$desktop/RaspiTV.desktop" metadata::trusted true 2>/dev/null || true
  "$DIR/uninstall.sh" --desktop-icon
  update-desktop-database "$apps" 2>/dev/null || true
}

step_autostart() {
  say "Start beim Hochfahren (ohne Desktop und Terminal)"
  python3 -c "import sys; sys.path.insert(0, sys.argv[1]); import settings; settings.set_autostart(True)" "$DIR"
}

step_bootlogo() {
  if ! command -v plymouth-set-default-theme >/dev/null; then say "Kein Bootbild-System (plymouth) – übersprungen"; return 0; fi
  say "RaspiTV-Bootbild (dauert etwas: initramfs wird neu gebaut)"
  $SUDO "$DIR/boot/install-bootlogo.sh"
}

step_bluetooth() {
  # Zufallsadresse („Privacy“) – sonst lehnen Amazon-/Fire-TV-Fernbedienungen das Koppeln ab
  local conf=/etc/bluetooth/main.conf
  if [ ! -f "$conf" ] || grep -q '^Privacy *= *device' "$conf"; then say "Bluetooth ist schon eingestellt"; return 0; fi
  say "Bluetooth für Fernbedienungen (Privacy = device)"
  $SUDO cp "$conf" "$conf.raspitv-backup" || return 1
  $SUDO sed -i '0,/^\[General\]/s//[General]\nPrivacy = device/' "$conf"
  $SUDO systemctl restart bluetooth || true
}

step_power() {
  # Neustart/Ausschalten aus den Einstellungen ohne Passwort
  if [ -f /etc/polkit-1/rules.d/50-raspitv-power.rules ]; then say "Neustart/Ausschalten ist schon erlaubt"; return 0; fi
  say "Neustart und Ausschalten aus RaspiTV erlauben"
  $SUDO "$DIR/boot/install-power-rule.sh" "$USER"
}

step_slim() {
  # Raspberry Pi OS entschlacken (umkehrbar, auch Teil der Deinstallation)
  "$DIR/boot/slim.sh"
}

case "${1:-}" in
  packages|entries|autostart|bootlogo|bluetooth|power|slim) "step_$1" ;;
  all) for s in packages entries autostart bootlogo bluetooth power; do "step_$s" || exit 1; done ;;
  *) echo "Aufruf: $0 packages|entries|autostart|bootlogo|bluetooth|power|slim|all" >&2; exit 2 ;;
esac
