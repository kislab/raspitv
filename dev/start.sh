#!/bin/bash
# Startet RaspiTV im Entwicklungsmodus (Player mit DevTools-Port 9222) und öffnet optional eine App.
#   dev/start.sh            nur RaspiTV starten
#   dev/start.sh netflix    zusätzlich eine App öffnen (ID aus apps.json, z. B. netflix, disney) und warten, bis sie geladen ist
export XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0
ROOT="$(dirname "$(dirname "$(readlink -f "$0")")")"
python3 -m py_compile "$ROOT/raspitv.py" "$ROOT/player.py" || exit 1
pkill -x lxterminal; pkill -x -f "python3 ($ROOT/)?raspitv\.py"; sleep 4
RASPITV_DEBUG=1 setsid lxterminal --title=RaspiTV -e bash -c "python3 $ROOT/raspitv.py; exec bash" >/dev/null 2>&1 &
sleep 6
[ -z "$1" ] && exit 0
# Kachel der App anwählen (Reihenfolge wie in apps.json) und öffnen
# Position wie in RaspiTV: Reihenfolge und ausgeblendete Apps aus den Einstellungen des zuletzt benutzten Kontos
INDEX=$(python3 - "$1" <<PY
import json, sys
from pathlib import Path
apps = json.load(open("$ROOT/apps.json"))
cfg = Path.home() / ".config/raspitv"
try:
    last = json.loads((cfg / "accounts.json").read_text()).get("last") or "main"
except (OSError, ValueError):
    last = "main"
s = {}
for f in (cfg / "settings.json", cfg / "accounts" / f"{last}.json"):
    try:
        s.update(json.loads(f.read_text()))
    except (OSError, ValueError):
        pass
known = set(s.get("known", []))
hidden = set(s.get("hidden", [])) | {a["id"] for a in apps if a.get("store") and a["id"] not in known}
order = {i: n for n, i in enumerate(s.get("order", []))}
ordered = sorted(apps, key=lambda a: order.get(a["id"], len(order) + apps.index(a)))
shown = [a["id"] for a in ordered if a["id"] not in hidden]
print(shown.index(sys.argv[1]))
PY
) || exit 1
DOMAIN=$(python3 -c "import json,sys,urllib.parse; a={a['id']: a for a in json.load(open('$ROOT/apps.json'))}[sys.argv[1]]; print(urllib.parse.urlparse(a['url']).hostname)" "$1")
for _ in $(seq 12); do curl -s -d '{"key":"left"}' localhost:8765/key >/dev/null; sleep 0.1; done
for _ in $(seq "$INDEX"); do curl -s -d '{"key":"right"}' localhost:8765/key >/dev/null; sleep 0.3; done
curl -s -d '{"key":"ok"}' localhost:8765/key >/dev/null
for _ in $(seq 40); do sleep 1; curl -s -m 1 http://127.0.0.1:9222/json 2>/dev/null | grep -q "$DOMAIN" && break; done
sleep 12
curl -s localhost:8765/status; echo
