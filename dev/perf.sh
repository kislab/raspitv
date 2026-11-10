#!/bin/bash
# Misst während der Wiedergabe: CPU-Last je Prozessgruppe, Temperatur, Takt und Video-Statistik.
#   dev/perf.sh [sekunden]   (RaspiTV im Entwicklungsmodus, Video muss laufen)
DEV="$(dirname "$(readlink -f "$0")")"
SECS="${1:-20}"
q() { python3 "$DEV/cdp.py" '(() => { const v = document.querySelector("video"); if (!v) return "kein Video"; const q = v.getVideoPlaybackQuality(); return `${v.videoWidth}x${v.videoHeight} frames=${q.totalVideoFrames} dropped=${q.droppedVideoFrames} t=${v.currentTime.toFixed(1)} paused=${v.paused}`; })()'; }
echo "vorher:  $(q)"
top -b -d "$SECS" -n 2 -w 250 | awk -v n=0 '/^top -/{n++} n==2' > /tmp/raspitv-top.txt
echo "nachher: $(q)"
awk 'NR>7 {cpu[$12]+=$9} END {for (c in cpu) if (cpu[c] > 1) printf "  %-18s %6.1f %%\n", c, cpu[c]}' /tmp/raspitv-top.txt | sort -k2 -nr
grep -E '^%Cpu|^MiB Mem' /tmp/raspitv-top.txt | sed 's/^/  /'
echo "  Temperatur: $(vcgencmd measure_temp 2>/dev/null)  Takt: $(vcgencmd measure_clock arm 2>/dev/null)  Drosselung: $(vcgencmd get_throttled 2>/dev/null)"
echo "  Chromium-Typen (CPU):"
for pid in $(pgrep -f 'user-data-dir=.*raspitv/'); do
  type=$(tr '\0' ' ' < /proc/$pid/cmdline | grep -o -- '--type=[a-z-]*' | head -1); type=${type:-browser}
  util=$(tr '\0' ' ' < /proc/$pid/cmdline | grep -o -- '--utility-sub-type=[a-zA-Z.]*' | sed 's/.*=//')
  c=$(awk -v p=$pid 'NR>7 && $1==p {print $9}' /tmp/raspitv-top.txt)
  [ -n "$c" ] && [ "${c%.*}" -ge 1 ] 2>/dev/null && echo "    $c %  $type $util"
done | sort -nr | head -8
