#!/bin/bash
# RaspiTV vollständig entfernen und alles zurückstellen, was RaspiTV am System geändert hat.
#   ~/raspitv/uninstall.sh                 (oder Doppelklick auf „RaspiTV deinstallieren“ auf dem Desktop)
#   ~/raspitv/uninstall.sh --desktop-icon  nur das Desktop-Symbol zum Deinstallieren anlegen
#   ~/raspitv/uninstall.sh --yes           ohne Rückfrage (RaspiTV → Einstellungen → Entwicklermodus)
#
# Rückgängig gemacht wird (Gegenstück zu install.sh):
#   - RaspiTV, Player (Chromium) und mpv beenden
#   - Autostart, Startmenü-Eintrag und Desktop-Symbole entfernen
#   - Bootbild: vorheriges Plymouth-Thema, cmdline.txt und config.txt wie vorher
#   - Bluetooth: /etc/bluetooth/main.conf aus der Sicherung (Privacy-Einstellung)
#   - Regel für Neustart/Ausschalten ohne Passwort (/etc/polkit-1/rules.d/50-raspitv-power.rules)
#   - Pakete, die RaspiTV nachinstalliert hat (nicht Chromium, git usw., die schon da waren)
#   - Entschlackung (boot/slim.sh): entfernte Programme, abgeschaltete Dienste, config.txt, Protokoll-Einstellung
#   - Einstellungen, Konten, Profilbilder und Logins (Netflix, Disney+, Jellyfin …), Zwischenspeicher (~/.cache)
#     sowie den Ordner ~/raspitv
# Gekoppelte Bluetooth-Geräte (z. B. die Fernbedienung) und WLAN-Verbindungen bleiben erhalten.
set -uo pipefail

# Paketverwaltung nie nachfragen lassen: Rückfragen (z. B. „Standard-Wörterbuch?“ beim Entfernen von wbritish)
# erscheinen sonst unsichtbar im Terminal hinter dem Einrichtungs-Assistenten, und alles bleibt stehen.
# sudo verwirft DEBIAN_FRONTEND – darum über env weiterreichen; im Assistenten (RASPITV_SUDO_N) nie nach dem
# Passwort fragen (gleiches Problem).
export DEBIAN_FRONTEND=noninteractive
sudo() {
  local n=()
  [ -n "${RASPITV_SUDO_N:-}" ] && n=(-n)
  case "${1:-}" in
    -*) command sudo "${n[@]}" "$@" ;;
    apt-get) shift; command sudo "${n[@]}" env DEBIAN_FRONTEND=noninteractive apt-get \
               -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold "$@" ;;
    *) command sudo "${n[@]}" env DEBIAN_FRONTEND=noninteractive "$@" ;;
  esac
}

SELF="$(readlink -f "$0")"
DIR="${RASPITV_DIR:-$(dirname "$SELF")}"  # beim Lauf aus der Kopie: Ordner vom Original
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
# Pakete, die RaspiTV auf Raspberry Pi OS üblicherweise nachinstalliert (falls install.sh sie
# noch nicht mitgeschrieben hat – ältere Installationen)
DEFAULT_PACKAGES="python3-pyqt5.qtquick qml-module-qtquick2 qml-module-qtquick-window2 qml-module-qtgraphicaleffects mpv"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*"; }

if [ "${1:-}" = "--desktop-icon" ]; then
  mkdir -p "$DESKTOP_DIR"
  cat > "$DESKTOP_DIR/RaspiTV-deinstallieren.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=RaspiTV deinstallieren
Comment=Entfernt RaspiTV und stellt alle Änderungen am System wieder her
Exec=lxterminal --title="RaspiTV deinstallieren" -e bash -c "'$SELF'; echo; read -rp 'Enter drücken zum Schließen …'"
Icon=edit-delete
Terminal=false
EOF
  chmod +x "$DESKTOP_DIR/RaspiTV-deinstallieren.desktop"
  gio set "$DESKTOP_DIR/RaspiTV-deinstallieren.desktop" metadata::trusted true 2>/dev/null || true
  exit 0
fi

# Sicherheitsprüfung: nur einen echten RaspiTV-Ordner entfernen
if [ ! -f "$DIR/raspitv.py" ] || [ ! -f "$DIR/install.sh" ] || [ "$DIR" = "$HOME" ] || [ "$DIR" = "/" ]; then
  echo "Abbruch: $DIR sieht nicht nach einem RaspiTV-Ordner aus." >&2
  exit 1
fi

# Aus einer Kopie laufen: der Ordner mit diesem Skript wird am Ende gelöscht
if [ -z "${RASPITV_UNINSTALL_COPY:-}" ]; then
  COPY="$(mktemp --suffix=-raspitv-uninstall.sh)"
  cp "$SELF" "$COPY"
  RASPITV_UNINSTALL_COPY=1 RASPITV_DIR="$DIR" exec bash "$COPY" "$@"
fi
trap 'rm -f "$SELF"' EXIT  # die Kopie in /tmp aufräumen

echo
echo "RaspiTV wird vollständig entfernt:"
echo "  • Programm-Ordner $DIR"
echo "  • Autostart (auch das Startbild beim Hochfahren), Startmenü-Eintrag, Desktop-Symbole"
echo "  • Bootbild (wieder das Original), Bluetooth-Einstellung (wieder das Original)"
echo "  • von RaspiTV installierte Pakete"
echo "  • Einstellungen, Konten und Logins (Netflix, Disney+, Prime, Jellyfin …)"
echo
if [ "${1:-}" != "--yes" ]; then  # --yes: schon in RaspiTV bestätigt (Einstellungen → Entwicklermodus)
  read -rp "Wirklich alles entfernen? Zum Bestätigen „ja“ eingeben: " answer
  [ "$answer" = "ja" ] || { echo "Abgebrochen – nichts wurde verändert."; exit 0; }
fi

# 1. Laufende Teile beenden (Muster treffen nur RaspiTV, nicht diese Shell)
say "Beende RaspiTV"
pkill -f -- "--user-data-dir=$DATA/raspitv/" 2>/dev/null
pkill -f "raspitv-mpv-" 2>/dev/null
pkill -f "python3 ($DIR/)?raspitv\.py" 2>/dev/null
sleep 2

# 2. Paketliste lesen, bevor die Einstellungen gelöscht werden
PACKAGES="$(cat "$CONFIG/raspitv/installed-packages" 2>/dev/null | tr '\n' ' ')"
[ -n "${PACKAGES// /}" ] || PACKAGES="$DEFAULT_PACKAGES"

# 3. Einträge im Benutzerkonto
say "Entferne Autostart, Startbild, Startmenü-Eintrag und Desktop-Symbole"
# Startbild beim Sitzungsstart: labwc-Autostart und Fensterregel zurücknehmen (vorheriges Autostart wiederherstellen)
python3 -c "import sys; sys.path.insert(0, sys.argv[1]); import settings; settings.set_autostart(False)" "$DIR" || true
rm -f "$CONFIG/autostart/raspitv.desktop" \
      "$DATA/applications/raspitv.desktop" \
      "$DESKTOP_DIR/RaspiTV.desktop" \
      "$DESKTOP_DIR/RaspiTV-deinstallieren.desktop"
update-desktop-database "$DATA/applications" 2>/dev/null || true

# 4. Systemänderungen (brauchen sudo)
say "Für die Systemänderungen wird jetzt das sudo-Passwort gebraucht"
if sudo -v; then
  if [ -d /usr/share/plymouth/themes/raspitv ]; then
    say "Stelle das ursprüngliche Bootbild wieder her (dauert etwas: initramfs wird neu gebaut)"
    if [ -x "$DIR/boot/install-bootlogo.sh" ]; then
      sudo "$DIR/boot/install-bootlogo.sh" --remove || warn "Bootbild konnte nicht zurückgestellt werden"
    fi
  fi

  BTCONF=/etc/bluetooth/main.conf
  if [ -f "$BTCONF.raspitv-backup" ]; then
    say "Stelle die Bluetooth-Einstellungen wieder her"
    sudo mv "$BTCONF.raspitv-backup" "$BTCONF"
    sudo systemctl restart bluetooth || true
  elif grep -q '^Privacy = device$' "$BTCONF" 2>/dev/null; then
    sudo sed -i '/^Privacy = device$/d' "$BTCONF"
    sudo systemctl restart bluetooth || true
  fi

  sudo "$DIR/boot/install-power-rule.sh" --remove || warn "Regel für Neustart/Ausschalten blieb bestehen"

  # Entschlacktes System (boot/slim.sh) wiederherstellen: entfernte Programme, Dienste, config.txt
  if [ -d "$CONFIG/raspitv/slim" ]; then
    say "Stelle das entschlackte Raspberry Pi OS wieder her"
    "$DIR/boot/slim.sh" --undo || warn "Entschlackung konnte nicht vollständig zurückgenommen werden"
  fi

  INSTALLED=""
  for p in $PACKAGES; do
    dpkg -s "$p" >/dev/null 2>&1 && INSTALLED="$INSTALLED $p"
  done
  if [ -n "$INSTALLED" ]; then
    say "Entferne Pakete, die RaspiTV installiert hat:$INSTALLED"
    # Nur diese Pakete und ihre dadurch überflüssigen Abhängigkeiten
    sudo apt-get remove --purge -y $INSTALLED && sudo apt-get autoremove --purge -y
  fi
else
  warn "Ohne sudo bleiben Bootbild, Bluetooth-Einstellung und Pakete unverändert."
fi

# 5. Daten, Logins und Programm
say "Lösche Einstellungen, Konten und Logins"
rm -rf "$CONFIG/raspitv" "$DATA/raspitv"
# Zwischenspeicher: umgefärbte Logos und Qts vorübersetzte Oberfläche
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}"
rm -rf "$CACHE/raspitv" "$CACHE/raspitv.py"
rm -f /tmp/raspitv-mpv.log /tmp/raspitv-mpv-*.sock /tmp/raspitv-top.txt
say "Lösche den Programm-Ordner $DIR"
rm -rf "$DIR"

echo
say "RaspiTV ist entfernt. Das Bootbild ändert sich beim nächsten Neustart."
