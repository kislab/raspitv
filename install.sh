#!/bin/bash
# RaspiTV installieren oder aktualisieren:
#   curl -fsSL https://raw.githubusercontent.com/kislab/raspitv/main/install.sh | bash
#
# Erstinstallation: fragt einmal nach dem sudo-Passwort, installiert, was die Oberfläche braucht (Python, Qt),
# holt RaspiTV von GitHub nach ~/raspitv und öffnet dann den Einrichtungs-Assistenten auf dem Bildschirm
# (bedienbar mit Fernbedienung, Tastatur oder Handy): Willkommen → Benutzer → WLAN → Updates → Einrichten
# (Programme, Autostart, Bootbild, Bluetooth, Entschlacken) → Homescreen.
# Ist RaspiTV schon installiert, wird es nur aktualisiert und die Einrichtung still im Terminal nachgezogen.
#
# Optionen: --no-autostart, --no-bootlogo, --no-slim (Schritte auslassen), --no-gui (alles im Terminal,
#           z. B. per SSH ohne Bildschirm), --setup (Assistent auch bei bestehender Installation),
#           --dir PFAD (anderer Installationsordner)
set -euo pipefail

# Alles in einer Funktion: Bei „curl … | bash“ liest Bash das Skript sonst stückweise aus der Leitung, während es
# läuft – und apt-get las aus derselben Leitung den Rest des Skripts weg (es endete dann nach den Grundpaketen und
# musste ein zweites Mal gestartet werden). Eine Funktion liest Bash erst ganz ein, dann läuft sie.
main() {

  REPO="https://github.com/kislab/raspitv.git"
  DIR="$HOME/raspitv"
  SKIP=""
  GUI=auto
  while [ $# -gt 0 ]; do
    case "$1" in
      --no-autostart) SKIP="$SKIP autostart" ;;
      --no-bootlogo) SKIP="$SKIP bootlogo" ;;
      --no-slim) SKIP="$SKIP slim" ;;
      --no-gui) GUI=no ;;
      --setup) GUI=yes ;;
      --dir) DIR="$2"; shift ;;
      *) echo "Unbekannte Option: $1" >&2; exit 1 ;;
    esac
    shift
  done

  say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
  STATE="${XDG_CONFIG_HOME:-$HOME/.config}/raspitv"

  # 0. sudo einmal hier im Terminal – der Assistent fragt nie nach einem Passwort
  say "Für die Einrichtung wird einmal das sudo-Passwort gebraucht"
  sudo -v
  # gültig halten, solange eingerichtet wird (höchstens 45 Minuten, danach läuft RaspiTV einfach weiter)
  ( for _ in $(seq 54); do sleep 50; sudo -n true 2>/dev/null || exit; done ) &
  KEEPALIVE=$!
  trap 'kill $KEEPALIVE 2>/dev/null' EXIT

  # 1. Was die Oberfläche (und damit der Assistent) braucht
  BASE="git python3 python3-pyqt5 python3-pyqt5.qtquick qml-module-qtquick2 qml-module-qtquick-window2
    qml-module-qtgraphicaleffects fonts-noto-color-emoji"
  MISSING=""
  for p in $BASE; do dpkg -s "$p" >/dev/null 2>&1 || MISSING="$MISSING $p"; done
  if [ -n "$MISSING" ]; then
    say "Installiere, was die Oberfläche braucht:$MISSING"
    sudo apt-get update -q
    # shellcheck disable=SC2086
    sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y $MISSING
    mkdir -p "$STATE"
    { cat "$STATE/installed-packages" 2>/dev/null; for p in $MISSING; do echo "$p"; done; } | sort -u > "$STATE/installed-packages.new"
    mv "$STATE/installed-packages.new" "$STATE/installed-packages"
  fi

  # 2. Programm holen bzw. aktualisieren
  FRESH=0
  if [ -d "$DIR/.git" ]; then
    say "Aktualisiere RaspiTV in $DIR"
    git -C "$DIR" pull --ff-only
  elif [ -e "$DIR" ]; then
    echo "$DIR existiert schon, ist aber kein RaspiTV-Repository. Bitte umbenennen oder --dir angeben." >&2
    exit 1
  else
    say "Lade RaspiTV nach $DIR"
    git clone "$REPO" "$DIR"
    FRESH=1
  fi

  # 3. Bildschirm für den Assistenten? (auch beim Aufruf per SSH, wenn auf dem Pi der Desktop läuft)
  RUNTIME="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
  if [ -z "${WAYLAND_DISPLAY:-}" ] && [ -S "$RUNTIME/wayland-0" ]; then
    export XDG_RUNTIME_DIR="$RUNTIME" WAYLAND_DISPLAY=wayland-0
  fi
  if [ "$GUI" = auto ]; then
    if [ "$FRESH" = 1 ] && [ -n "${WAYLAND_DISPLAY:-}${DISPLAY:-}" ]; then GUI=yes; else GUI=no; fi
  fi

  if [ "$GUI" = yes ]; then
    # laufendes RaspiTV beenden (der Assistent ist RaspiTV im Einrichtungsmodus)
    pkill -x -f "python3 ($DIR/)?raspitv\.py( --[a-z-]+)?" 2>/dev/null || true
    sleep 1
    say "Öffne den Einrichtungs-Assistenten auf dem Bildschirm – weiter geht es dort"
    cd "$DIR"
    RASPITV_SETUP_SKIP="$SKIP" python3 raspitv.py --setup
  else
    say "Richte RaspiTV ein"
    for step in packages entries autostart bootlogo bluetooth power slim; do
      case " $SKIP " in *" $step "*) continue ;; esac
      "$DIR/boot/setup.sh" "$step"
    done
    say "Fertig! RaspiTV startest du über das Desktop-Symbol oder das Startmenü (Unterhaltung → RaspiTV)."
  fi
}

main "$@" </dev/null
