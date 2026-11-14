#!/bin/bash
# Raspberry Pi OS für RaspiTV entschlacken – alles, was nur Leistung, Startzeit oder Platz kostet und für einen
# TV-Pi nichts bringt. Vollständig umkehrbar:
#   ~/raspitv/boot/slim.sh          entschlacken (fragt nach dem sudo-Passwort)
#   ~/raspitv/boot/slim.sh --undo   alles wiederherstellen (auch Teil der Deinstallation)
#   ~/raspitv/boot/slim.sh --dry-run  nur anzeigen, welche Pakete entfernt würden
#
# Bleibt bewusst erhalten: der Kern-Desktop (labwc, Taskleiste, Dateimanager, Terminal – für „Zurück zum Desktop“
# im Entwicklermodus), Bootbild (plymouth) und Pi-Grundeinstellungen, Bluetooth, WLAN, SSH, Tailscale, Raspberry Pi
# Connect, avahi (raspi.local), Ton (PipeWire), Schlüsselbund (Chromium-Logins), Firmware-Updates (rpi-eeprom).
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

STATE="${XDG_CONFIG_HOME:-$HOME/.config}/raspitv/slim"
DIR="$(dirname "$(dirname "$(readlink -f "$0")")")"
say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }

# Programme, die RaspiTV nicht braucht (Drucken, Cloud-Einrichtung, zweiter Browser, Video-Player, alter
# VNC-Server für X11, Bildschirmtastatur für Touch, Entwicklungs-Werkzeuge, Kernel für den Pi 5)
PACKAGES="cloud-init rpi-cloud-init-mods cups cups-browsed cups-daemon cups-client hplip realvnc-vnc-server
  firefox rpi-firefox-mods vlc vlc-bin vlc-l10n rpi-imager rpi-userguide squeekboard thonny python3-mypy mypy
  mkvtoolnix linux-image-rpi-2712 linux-headers-rpi-v8 linux-headers-rpi-2712
  geany galculator eom evince mousepad rp-bookshelf agnostics xarchiver lxtask piclone rp-prefapps piwiz
  gcc g++ build-essential python3-dev gdb pocketsphinx-en-us
  firmware-atheros firmware-mediatek firmware-realtek firmware-libertas
  rpd-applications rpd-developer rpd-graphics rpd-utilities rpd-preferences rpd-wayland-extras
  rpd-x-core rpd-x-extras openbox lxpanel-pi xcompmgr xinit gldriver-test
  mesa-vulkan-drivers chromium-l10n gcc-14 cpp-14 sq ghostscript sane-utils colord rpd-wallpaper rpd-wallpaper-trixie"
# Was RaspiTV (und der Desktop) braucht, darf beim Aufräumen der Abhängigkeiten nie mitgehen
KEEP="git python3 python3-pyqt5 python3-pyqt5.qtquick qml-module-qtquick2 qml-module-qtquick-window2
  qml-module-qtgraphicaleffects mpv chromium libwidevinecdm0 lxterminal libqrencode4 fonts-noto-color-emoji
  sound-theme-freedesktop libcanberra0 libadwaita-1-0 libaribb24-0t64 wlr-randr grim labwc wf-panel-pi pcmanfm-pi
  rpi-connect tailscale rpd-wayland-core rpd-common rpd-plym-splash rpd-theme plymouth raspberrypi-sys-mods
  xwayland gnome-keyring libpam-gnome-keyring"
# Dienste: Warten aufs Netz beim Start (RaspiTV wartet selbst höchstens 5 s), NFS, Pi-5-/X11-Tests, System-VNC,
# tägliche Paket-Downloads und Handbuch-Index im Hintergrund
UNITS="upower.service packagekit.service nfs-client.target rpc-statd.service NetworkManager-wait-online.service rpcbind.service rpcbind.socket nfs-blkmap.service rp1-test.service
  glamor-test.service wayvnc-control.service apt-daily.timer apt-daily-upgrade.timer man-db.timer"
# Benutzerdienste: Geräte-Erkennung für iPhone, Online-Konten, Digitalkameras, Android-Handys (MTP)
USER_UNITS="mpris-proxy.service gvfs-afc-volume-monitor.service gvfs-goa-volume-monitor.service gvfs-gphoto2-volume-monitor.service
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
    # nur, was es im Paketarchiv noch gibt (z. B. alte Kernel verschwinden) – sonst bräche apt alles ab
    # shellcheck disable=SC2046
    AVAIL="$(apt-cache policy $(cat "$STATE/packages") 2>/dev/null |
      awk '/^[^ ]/{p=$1; sub(":$","",p)} /Candidate:/{if ($2 != "(none)") print p}')"
    # shellcheck disable=SC2086
    if ! sudo apt-get install -y $AVAIL; then
      echo "!! Gemeinsam ging es nicht – einzeln:"
      for p in $AVAIL; do sudo apt-get install -y "$p" >/dev/null 2>&1 || echo "   nicht installiert: $p"; done
    fi
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

if [ "${1:-}" != "--dry-run" ]; then
  say "Entschlacke Raspberry Pi OS für RaspiTV (umkehrbar mit: $0 --undo)"
  sudo -v || exit 1
  mkdir -p "$STATE"
fi

# 1. Programme
# dazu: Kernel und Header für den Pi 5, alle Kernel-Header, der X11-Server (der Pi läuft unter Wayland),
# Panel-Erweiterungen des alten X11-Panels
EXTRA="$(dpkg-query -Wf '${Package} ${Status}\n' 2>/dev/null | awk '/ installed$/{print $1}' |
  grep -E '^linux-(image|headers)-.*-rpi-2712$|^linux-headers-|^xserver-xorg|^lpplug-')
$(dpkg-query -Wf '${Package} ${Status}\n' 2>/dev/null | awk '/ installed$/{print $1}' |
  grep -E '^linux-image-[0-9].*-rpi-v8$' | grep -v "^linux-image-$(uname -r)$")"
# Schutzliste: alles, was der Kern-Desktop, das Bootbild und die Pi-Grundeinstellungen brauchen
CORE="$(apt-cache depends --installed rpd-wayland-core rpd-common rpd-plym-splash 2>/dev/null |
  awk '/Depends|Recommends/{print $2}' | grep -v '^<')"
INSTALLED=""
# Teile der Desktop-Sammelpakete (Paket-Aktualisierer, NFS …) werden nie entfernt: sonst nimmt apt die
# Sammelpakete rpd-wayland-core/rpd-common mit, und darin steckt der Start der Desktop-Sitzung (labwc-pi,
# Sitzungsdatei, labwc-Grundeinstellungen). Solche Teile werden unten nur abgeschaltet.
for p in $PACKAGES $EXTRA; do
  case " $KEEP $CORE " in *" $p "*) continue ;; esac
  dpkg -s "$p" >/dev/null 2>&1 && INSTALLED="$INSTALLED $p"
done
if [ "${1:-}" = "--dry-run" ]; then  # nur zeigen, was passieren würde
  NEEDED=""
  for p in $KEEP $CORE; do case " $INSTALLED " in *" $p "*) ;; *) NEEDED="$NEEDED $p" ;; esac; done
  # Schutz (apt-mark manual) an einer Kopie der apt-Markierungen nachstellen
  STATES="$(mktemp)"
  cp /var/lib/apt/extended_states "$STATES"
  python3 - "$STATES" $NEEDED <<'EOF'
import sys
path, keep = sys.argv[1], set(sys.argv[2:])
out, cur = [], None
for line in open(path).read().split("\n"):
    if line.startswith("Package: "):
        cur = line.split(": ", 1)[1]
    if line.startswith("Auto-Installed: 1") and cur in keep:
        line = "Auto-Installed: 0"
    out.append(line)
open(path, "w").write("\n".join(out))
EOF
  # shellcheck disable=SC2086
  apt-get -s -o Dir::State::extended_states="$STATES" remove --purge --auto-remove $INSTALLED 2>/dev/null |
    awk '/^Purg/{print $2}' | tr '\n' ' '
  rm -f "$STATES"
  echo
  exit 0
fi
if [ -n "$INSTALLED" ]; then
  say "Entferne:$INSTALLED"
  # merken (auch schon früher entfernte nicht vergessen), damit --undo sie wieder installiert
  { cat "$STATE/packages" 2>/dev/null; for p in $INSTALLED; do echo "$p"; done; } | sort -u > "$STATE/packages.new"
  mv "$STATE/packages.new" "$STATE/packages"
  NEEDED=""
  for p in $KEEP $CORE; do
    case " $INSTALLED " in *" $p "*) continue ;; esac  # ausdrücklich zu entfernende nicht schützen
    dpkg -s "$p" >/dev/null 2>&1 && NEEDED="$NEEDED $p"
  done
  # shellcheck disable=SC2086
  sudo apt-mark manual $NEEDED >/dev/null
  # Sicherheitsprüfung: würde apt dabei etwas Geschütztes mitnehmen, gar nichts entfernen
  # shellcheck disable=SC2086
  HIT="$(apt-get -s remove --purge --auto-remove $INSTALLED 2>/dev/null | awk '/^Purg|^Remv/{print $2}' |
    grep -xF -f <(printf '%s\n' $KEEP $CORE rpd-wayland-core rpd-common) | tr '\n' ' ')"
  if [ -n "$HIT" ]; then
    echo "!! Abbruch: apt würde auch Wichtiges entfernen: $HIT"
    exit 1
  fi
  sudo dpkg --configure -a  # falls ein früherer Lauf mittendrin abbrach (sonst verweigert apt alles)
  # shellcheck disable=SC2086
  sudo apt-get remove --purge -y $INSTALLED && sudo apt-get autoremove --purge -y
  sudo apt-get clean
fi

# 2. Dienste
for u in $UNITS; do
  # maskieren statt nur abschalten: manche (packagekit, rpcbind) werden sonst bei Bedarf doch gestartet
  if [ "$(systemctl is-enabled "$u" 2>/dev/null)" != "masked" ] && systemctl cat "$u" >/dev/null 2>&1; then
    echo "$u" >> "$STATE/units"
    sudo systemctl disable --now "$u" 2>/dev/null
    sudo systemctl mask "$u" 2>/dev/null
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
