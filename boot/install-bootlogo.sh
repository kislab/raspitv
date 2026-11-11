#!/bin/bash
# Richtet das RaspiTV-Logo als Bootbild ein (statt Regenbogen, Himbeeren und Raspberry-Pi-Bild).
#   sudo boot/install-bootlogo.sh            einrichten bzw. aktualisieren
#   sudo boot/install-bootlogo.sh --remove   wieder das Standardbild von Raspberry Pi OS
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Bitte mit sudo starten." >&2; exit 1; }
HERE="$(dirname "$(readlink -f "$0")")"
THEME=/usr/share/plymouth/themes/raspitv
FW=/boot/firmware; [ -d "$FW" ] || FW=/boot
CMDLINE="$FW/cmdline.txt"
CONFIG="$FW/config.txt"

command -v plymouth-set-default-theme >/dev/null || { echo "Plymouth fehlt – kein Bootbild möglich." >&2; exit 1; }

if [ "${1:-}" = "--remove" ]; then
  # Vorheriges Thema (beim Einrichten gemerkt), sonst das Standardthema von Raspberry Pi OS
  PREVIOUS="$(cat "$THEME/.previous-theme" 2>/dev/null || echo pix)"
  [ -d "/usr/share/plymouth/themes/$PREVIOUS" ] || PREVIOUS=pix
  if [ -f "$THEME/.added-splash" ]; then
    sed -i 's/ quiet splash plymouth\.ignore-serial-consoles//' "$CMDLINE"
  fi
  sed -i 's/ logo\.nologo//' "$CMDLINE"
  sed -i '/^disable_splash=1  # RaspiTV$/d' "$CONFIG"
  rm -rf "$THEME"
  plymouth-set-default-theme -R "$PREVIOUS"
  echo "Bootbild wiederhergestellt ($PREVIOUS)."
  exit 0
fi

# 1. Plymouth-Thema (Bild beim Hochfahren und Ausschalten)
mkdir -p "$THEME"
# Bisheriges Thema merken, damit die Deinstallation es zurückholen kann
CURRENT="$(plymouth-set-default-theme)"
[ "$CURRENT" = raspitv ] || [ -f "$THEME/.previous-theme" ] || echo "$CURRENT" > "$THEME/.previous-theme"
install -m 644 "$HERE/plymouth/raspitv.plymouth" "$HERE/plymouth/raspitv.script" "$THEME/"
install -m 644 "$HERE/../logos/raspitv-boot.png" "$THEME/logo.png"
if [ "$(plymouth-set-default-theme)" = raspitv ]; then
  update-initramfs -u             # Thema steckt in der initramfs: Bild dort erneuern
else
  plymouth-set-default-theme -R raspitv
fi

# 2. Kernel: keine Himbeeren oben links; Plymouth einschalten, falls es fehlt
grep -q 'logo\.nologo' "$CMDLINE" || sed -i '1 s/$/ logo.nologo/' "$CMDLINE"
if ! grep -qw splash "$CMDLINE"; then
  sed -i '1 s/$/ quiet splash plymouth.ignore-serial-consoles/' "$CMDLINE"
  touch "$THEME/.added-splash"  # nur dann nimmt die Deinstallation es wieder heraus
fi

# 3. Firmware: kein Regenbogen-Bild ganz am Anfang
grep -q '^disable_splash=1' "$CONFIG" || echo 'disable_splash=1  # RaspiTV' >> "$CONFIG"

echo "RaspiTV-Bootbild eingerichtet (wirkt ab dem nächsten Neustart)."
