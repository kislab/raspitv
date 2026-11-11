#!/bin/bash
# Erlaubt dem RaspiTV-Benutzer Neustart und Ausschalten ohne Passwort (Einstellungen → System).
#
# Ohne diese Regel verlangt das System ein Passwort, sobald noch eine andere Sitzung angemeldet ist
# (SSH, Fernzugriff) – RaspiTV kann keins eingeben, „Neu starten“/„Ausschalten“ täten dann nichts.
#   sudo boot/install-power-rule.sh [Benutzer]      Regel anlegen (Standard: der Benutzer, der sudo aufruft)
#   sudo boot/install-power-rule.sh --remove        Regel entfernen
set -e
RULE=/etc/polkit-1/rules.d/50-raspitv-power.rules

if [ "$1" = "--remove" ]; then
  rm -f "$RULE"
  exit 0
fi

USER_NAME="${1:-${SUDO_USER:-$USER}}"
case "$USER_NAME" in ''|*[!a-z0-9_-]*) echo "Ungültiger Benutzername: $USER_NAME" >&2; exit 1 ;; esac

mkdir -p "$(dirname "$RULE")"
cat > "$RULE" <<EOF
// Von RaspiTV angelegt (boot/install-power-rule.sh): Neustart/Ausschalten aus den RaspiTV-Einstellungen,
// auch wenn andere Sitzungen (SSH, Fernzugriff) angemeldet sind. Entfernen: install-power-rule.sh --remove
polkit.addRule(function (action, subject) {
  var actions = [
    "org.freedesktop.login1.reboot", "org.freedesktop.login1.reboot-multiple-sessions",
    "org.freedesktop.login1.power-off", "org.freedesktop.login1.power-off-multiple-sessions",
    "org.freedesktop.login1.reboot-ignore-inhibit", "org.freedesktop.login1.power-off-ignore-inhibit"
  ];
  if (subject.user == "$USER_NAME" && actions.indexOf(action.id) >= 0) {
    return polkit.Result.YES;
  }
});
EOF
chmod 644 "$RULE"
echo "Neustart/Ausschalten für $USER_NAME freigegeben ($RULE)"
