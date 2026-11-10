#!/bin/bash
# RaspiTV installieren oder aktualisieren:
#   curl -fsSL https://raw.githubusercontent.com/kislab/raspitv/main/install.sh | bash
#
# Holt RaspiTV von GitHub nach ~/raspitv, installiert fehlende Pakete (fragt dafür einmal nach dem
# sudo-Passwort) und legt RaspiTV als Programm an: Startmenü, Symbol auf dem Desktop und Autostart.
# Optionen: --no-autostart (kein Start beim Hochfahren), --no-bootlogo (Standard-Bootbild behalten),
#           --dir PFAD (anderer Installationsordner)
set -euo pipefail

REPO="https://github.com/kislab/raspitv.git"
DIR="$HOME/raspitv"
AUTOSTART=1
BOOTLOGO=1
while [ $# -gt 0 ]; do
  case "$1" in
    --no-autostart) AUTOSTART=0 ;;
    --no-bootlogo) BOOTLOGO=0 ;;
    --dir) DIR="$2"; shift ;;
    *) echo "Unbekannte Option: $1" >&2; exit 1 ;;
  esac
  shift
done

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }

# 1. Pakete (nur fehlende installieren)
PACKAGES="git python3 python3-pyqt5 python3-pyqt5.qtquick qml-module-qtquick2 qml-module-qtquick-window2 qml-module-qtgraphicaleffects chromium libwidevinecdm0 lxterminal"
MISSING=""
for p in $PACKAGES; do
  dpkg -s "$p" >/dev/null 2>&1 || MISSING="$MISSING $p"
done
if [ -n "$MISSING" ]; then
  say "Installiere fehlende Pakete:$MISSING"
  sudo apt-get update
  sudo apt-get install -y $MISSING
else
  say "Alle Pakete sind schon installiert"
fi

# 2. Programm holen bzw. aktualisieren
if [ -d "$DIR/.git" ]; then
  say "Aktualisiere RaspiTV in $DIR"
  git -C "$DIR" pull --ff-only
elif [ -e "$DIR" ]; then
  echo "$DIR existiert schon, ist aber kein RaspiTV-Repository. Bitte umbenennen oder --dir angeben." >&2
  exit 1
else
  say "Lade RaspiTV nach $DIR"
  git clone "$REPO" "$DIR"
fi

# 3. Programm-Eintrag: Startmenü und Desktop-Symbol (vor dem Start wird kurz nach Updates gesucht)
ICON="$DIR/logos/raspitv-icon.png"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
mkdir -p "$APPS" "$DESKTOP_DIR"
ENTRY="[Desktop Entry]
Type=Application
Name=RaspiTV
Comment=TV-Oberfläche für Netflix, Disney+, YouTube, Prime Video, Jellyfin und mehr
Exec=bash -c \"cd '$DIR' && git pull --ff-only -q; exec python3 raspitv.py\"
Icon=$ICON
Terminal=false
Categories=AudioVideo;Video;
StartupNotify=false"
say "Lege Startmenü-Eintrag an"
printf '%s\n' "$ENTRY" > "$APPS/raspitv.desktop"
say "Lege Symbol auf dem Desktop an"
printf '%s\n' "$ENTRY" > "$DESKTOP_DIR/RaspiTV.desktop"
chmod +x "$DESKTOP_DIR/RaspiTV.desktop"
# Als vertrauenswürdig markieren, damit der Desktop nicht bei jedem Doppelklick nachfragt
gio set "$DESKTOP_DIR/RaspiTV.desktop" metadata::trusted true 2>/dev/null || true
update-desktop-database "$APPS" 2>/dev/null || true

# 4. Autostart: Terminal öffnen und darin RaspiTV laden (mit Update vorher)
if [ "$AUTOSTART" = 1 ]; then
  say "Schalte Autostart ein"
  python3 -c "import sys; sys.path.insert(0, sys.argv[1]); import settings; settings.set_autostart(True)" "$DIR"
fi

# 5. Bootbild: RaspiTV-Logo statt Regenbogen und Raspberry-Pi-Bild
if [ "$BOOTLOGO" = 1 ] && command -v plymouth-set-default-theme >/dev/null; then
  say "Richte das RaspiTV-Bootbild ein (dauert etwas: initramfs wird neu gebaut)"
  sudo "$DIR/boot/install-bootlogo.sh"
fi

say "Fertig! RaspiTV startest du über das Desktop-Symbol oder das Startmenü (Unterhaltung → RaspiTV)."
