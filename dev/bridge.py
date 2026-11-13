#!/usr/bin/env python3
"""Brücke einer Seite im Player aufrufen (Entwicklung): dev/bridge.py <tvsp|tvdp> <op> ['{"json":"args"}']

Schickt {<kanal>: "req", op, args} per postMessage an die Brücke (spotify-main.js: tvsp, disney-bridge.js: tvdp)
und gibt die Antwort aus. Zeitlimit über CDP_TIMEOUT.
"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import cdp  # noqa: E402

channel, op = sys.argv[1], sys.argv[2]  # tvsp, tvdp, tvnf
args = sys.argv[3] if len(sys.argv) > 3 else "{}"
js = f"""(async()=>{{const id=Math.random(); return await new Promise(res=>{{const h=(e)=>{{if(e.data&&e.data.{channel}==="res"&&e.data.id===id){{removeEventListener("message",h);res(JSON.stringify(e.data.ok?e.data.data:{{error:e.data.error}}))}}}}; addEventListener("message",h); postMessage({{{channel}:"req",id,op:{json.dumps(op)},args:{args}}},"*"); setTimeout(()=>res("Zeitüberschreitung"),15000)}})}})()"""
print(cdp.evaluate(js))
