#!/bin/bash
# Schickt Fernbedienungs-Tasten an RaspiTV und zeigt danach, was in der Seite gewählt ist.
#   dev/keys.sh down right ok      (Pause zwischen den Tasten: KEY_DELAY, Standard 0.5 s)
DEV="$(dirname "$(readlink -f "$0")")"
for key in "$@"; do
  curl -s -o /dev/null -d "{\"key\":\"$key\"}" localhost:8765/key
  sleep "${KEY_DELAY:-0.5}"
done
sleep 0.8
python3 "$DEV/cdp.py" '(() => { const e = document.querySelector(".tv-focus"); if (!e) return "kein Fokus | " + location.pathname + location.search.slice(0, 30); const r = e.getBoundingClientRect(); return (e.getAttribute("aria-label") || e.dataset.uia || e.textContent.trim().slice(0, 40)) + " @" + Math.round(r.left) + "," + Math.round(r.top) + " | " + location.pathname + location.search.slice(0, 30); })()'
