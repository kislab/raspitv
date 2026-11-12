#!/usr/bin/env python3
"""Was kostet die Seite im Player? Rendering-Trace bzw. JS-Profil über die DevTools (Entwicklungsmodus).

  dev/trace.py [Sekunden]            Hauptthread-Arbeit nach Art (Stil, Layout, Paint, Skripte …)
  dev/trace.py --js [Sekunden]       JavaScript-Profil: teuerste Funktionen (Eigenzeit)

Tipp: während der Messung Tasten schicken, z. B.
  (sleep 1; dev/keys.sh down down down) & dev/trace.py 5
"""
import collections
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cdp  # noqa: E402


def connect():
    ws = cdp.WS(cdp.page()["webSocketDebuggerUrl"])
    ws.s.settimeout(90)
    return ws


def trace(secs):
    ws = connect()
    ws.call("Tracing.start", {"categories": "devtools.timeline,disabled-by-default-devtools.timeline", "transferMode": "ReportEvents"})
    time.sleep(secs)
    ws.send("Tracing.end")
    events = []
    while True:
        m = ws.recv()
        if m.get("method") == "Tracing.dataCollected":
            events += m["params"]["value"]
        elif m.get("method") == "Tracing.tracingComplete":
            break
    dur, cnt = collections.Counter(), collections.Counter()
    for e in events:
        if e.get("ph") == "X" and "dur" in e:
            dur[e["name"]] += e["dur"]
            cnt[e["name"]] += 1
    print(f"{secs:.0f} s aufgezeichnet")
    for k, d in dur.most_common(14):
        print(f"{d / 1000:8.0f} ms {cnt[k]:6d}x  {k}")


def profile(secs):
    ws = connect()
    ws.call("Profiler.enable")
    ws.call("Profiler.setSamplingInterval", {"interval": 1000})
    ws.call("Profiler.start")
    time.sleep(secs)
    prof = ws.call("Profiler.stop")["profile"]
    nodes = {n["id"]: n for n in prof["nodes"]}
    own = collections.Counter()
    for sid, d in zip(prof["samples"], prof["timeDeltas"]):
        cf = nodes[sid]["callFrame"]
        own[f'{cf["functionName"] or "(anon)"} {cf["url"].split("/")[-1][:40]}:{cf["lineNumber"]}'] += d
    total = sum(own.values()) or 1
    print(f"{total / 1000:.0f} ms in {secs:.0f} s")
    for k, t in own.most_common(20):
        print(f"{t / 1000:8.0f} ms {100 * t / total:5.1f}%  {k}")


if __name__ == "__main__":
    args = sys.argv[1:]
    js = "--js" in args
    args = [a for a in args if a != "--js"]
    secs = float(args[0]) if args else 4
    profile(secs) if js else trace(secs)
