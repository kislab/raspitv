#!/usr/bin/env python3
"""Entwicklungs-Werkzeug: drückt eine echte Taste im Player (wie eine Tastatur/Fernbedienung).
   dev/key.py Escape | Backspace | Home | ArrowLeft | Enter ..."""
import sys, importlib.util
spec = importlib.util.spec_from_file_location("cdp", __file__.replace("key.py", "cdp.py"))
cdp = importlib.util.module_from_spec(spec); spec.loader.exec_module(cdp)
CODES = {"Escape": 27, "Backspace": 8, "Home": 36, "Enter": 13, "ArrowLeft": 37, "ArrowUp": 38, "ArrowRight": 39, "ArrowDown": 40, "BrowserBack": 166, "BrowserHome": 172}
ws = cdp.WS(cdp.page()["webSocketDebuggerUrl"])
for key in sys.argv[1:]:
    for kind in ("rawKeyDown", "keyUp"):
        ws.call("Input.dispatchKeyEvent", {"type": kind, "key": key, "code": key, "windowsVirtualKeyCode": CODES.get(key, 0)})
print("ok")
