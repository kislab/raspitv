"""WLAN (NetworkManager/nmcli) und Bluetooth (bluetoothctl/rfkill) für die Einstellungen.

Alle Funktionen blockieren (Suchen und Verbinden dauern Sekunden) – RaspiTV ruft sie daher im
Hintergrund auf. Fehler werden als Text zurückgegeben, nie als Ausnahme.
"""
import re
import subprocess
import time

# ---------- Hilfen ----------


def _run(args, timeout=20, stdin=None):
    """Befehl ausführen; (Erfolg, Ausgabe bzw. Fehlermeldung)."""
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=timeout, input=stdin)
        out = (r.stdout if r.returncode == 0 else (r.stderr or r.stdout)).strip()
        return r.returncode == 0, out
    except FileNotFoundError:
        return False, f"{args[0]} fehlt"
    except subprocess.TimeoutExpired:
        return False, "Zeitüberschreitung"


def _fields(line):
    """Zeile von `nmcli -t` in Felder teilen (":" trennt, "\\:" ist ein Doppelpunkt im Text)."""
    return [f.replace("\\:", ":").replace("\\\\", "\\") for f in re.split(r"(?<!\\):", line)]


def _short_error(text):
    text = text.splitlines()[-1] if text else "unbekannter Fehler"
    text = re.sub(r"^Error: ", "", text)
    if "Secrets were required" in text or "802-11-wireless-security.psk" in text or "password" in text.lower():
        return "Falsches Passwort"
    if "not authorized" in text:
        return "Keine Berechtigung (NetworkManager)"
    return text[:70]


# ---------- WLAN ----------


def wifi_enabled():
    ok, out = _run(["nmcli", "-t", "radio", "wifi"], timeout=5)
    return ok and out == "enabled"


def set_wifi(on):
    return _run(["nmcli", "radio", "wifi", "on" if on else "off"], timeout=10)


def wifi_current():
    """Name des verbundenen WLANs oder ""."""
    ok, out = _run(["nmcli", "-t", "-f", "ACTIVE,SSID", "dev", "wifi", "list", "--rescan", "no"], timeout=5)
    if ok:
        for line in out.splitlines():
            f = _fields(line)
            if len(f) >= 2 and f[0] == "yes" and f[1]:
                return f[1]
    return ""


def wifi_scan(rescan=True):
    """Netze in Reichweite, stärkstes zuerst: [{"ssid", "signal", "secure", "active"}]."""
    ok, out = _run(["nmcli", "-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "dev", "wifi", "list",
                    "--rescan", "yes" if rescan else "no"], timeout=25)
    if not ok and rescan:  # Neu-Suchen nicht erlaubt: wenigstens die zuletzt gesehenen Netze
        ok, out = _run(["nmcli", "-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "dev", "wifi", "list",
                        "--rescan", "no"], timeout=10)
    nets = {}
    for line in out.splitlines() if ok else []:
        f = _fields(line)
        if len(f) < 4 or not f[1]:
            continue
        net = {"ssid": f[1], "signal": int(f[2] or 0), "secure": f[3] not in ("", "--"), "active": f[0] == "*"}
        old = nets.get(net["ssid"])
        if old is None or net["signal"] > old["signal"] or net["active"]:
            net["active"] = net["active"] or bool(old and old["active"])
            nets[net["ssid"]] = net
    return sorted(nets.values(), key=lambda n: (not n["active"], -n["signal"]))


def wifi_known():
    """Namen (SSIDs) gespeicherter WLAN-Verbindungen -> Verbindungsname."""
    ok, out = _run(["nmcli", "-t", "-f", "NAME,TYPE", "connection", "show"], timeout=5)
    known = {}
    for line in out.splitlines() if ok else []:
        name, kind = (_fields(line) + ["", ""])[:2]
        if kind != "802-11-wireless":
            continue
        ok2, ssid = _run(["nmcli", "-g", "802-11-wireless.ssid", "connection", "show", name], timeout=5)
        if ok2 and ssid:
            known[ssid] = name
    return known


def wifi_connect(ssid, password=None):
    """Mit einem WLAN verbinden (gespeichertes Profil oder neu mit Passwort). (Erfolg, Meldung)."""
    known = wifi_known()
    if ssid in known and password is None:
        ok, out = _run(["nmcli", "connection", "up", "id", known[ssid]], timeout=45)
    else:
        args = ["nmcli", "dev", "wifi", "connect", ssid]
        if password:
            args += ["password", password]
        ok, out = _run(args, timeout=45)
        if not ok:  # fehlgeschlagenes neues Profil nicht liegen lassen
            _run(["nmcli", "connection", "delete", "id", ssid], timeout=10)
    return ok, f"Verbunden mit {ssid}" if ok else _short_error(out)


def wifi_forget(ssid):
    known = wifi_known()
    if ssid not in known:
        return False, "Kein gespeichertes Netz"
    ok, out = _run(["nmcli", "connection", "delete", "id", known[ssid]], timeout=10)
    return ok, f"{ssid} vergessen" if ok else _short_error(out)


def signal_bars(signal):
    return "▂▄▆█"[: max(1, min(4, (signal + 12) // 25))]


# ---------- Bluetooth ----------


def bt_enabled():
    ok, out = _run(["bluetoothctl", "show"], timeout=5)
    return ok and "Powered: yes" in out


def set_bluetooth(on):
    if on:
        _run(["rfkill", "unblock", "bluetooth"], timeout=5)
        for _ in range(10):  # nach dem Freigeben braucht der Chip einen Moment
            ok, out = _run(["bluetoothctl", "power", "on"], timeout=10)
            if ok and bt_enabled():
                return True, "Bluetooth an"
            time.sleep(0.7)
        return False, "Bluetooth ließ sich nicht einschalten"
    _run(["bluetoothctl", "power", "off"], timeout=10)
    return _run(["rfkill", "block", "bluetooth"], timeout=5)


def _devices(*filter_):
    ok, out = _run(["bluetoothctl", "devices", *filter_], timeout=5)
    devices = []
    for line in out.splitlines() if ok else []:
        m = re.match(r"Device ([0-9A-F:]{17}) (.*)", line)
        if m and not re.fullmatch(r"([0-9A-F]{2}-){5}[0-9A-F]{2}", m.group(2)):  # Geräte ohne Namen weglassen
            devices.append({"mac": m.group(1), "name": m.group(2)})
    return devices


def bt_paired():
    """Gekoppelte Geräte mit Verbindungsstatus."""
    connected = {d["mac"] for d in _devices("Connected")}
    return [dict(d, connected=d["mac"] in connected) for d in _devices("Paired")]


def bt_scan(seconds=10):
    """Nach neuen Geräten suchen; gefundene, noch nicht gekoppelte Geräte."""
    _run(["bluetoothctl", "--timeout", str(seconds), "scan", "on"], timeout=seconds + 10)
    paired = {d["mac"] for d in _devices("Paired")}
    return [d for d in _devices() if d["mac"] not in paired]


def bt_pair(mac):
    """Koppeln, vertrauen, verbinden – ohne PIN-Abfrage (Kopfhörer, Lautsprecher, Controller)."""
    _run(["bluetoothctl", "--agent", "NoInputNoOutput", "--timeout", "20", "pair", mac], timeout=30)
    if not any(d["mac"] == mac for d in _devices("Paired")):
        return False, "Koppeln fehlgeschlagen – Gerät im Kopplungsmodus?"
    _run(["bluetoothctl", "trust", mac], timeout=10)
    ok, out = _run(["bluetoothctl", "connect", mac], timeout=25)
    return True, "Gekoppelt und verbunden" if ok else "Gekoppelt (noch nicht verbunden)"


def bt_toggle_connection(mac, connected):
    ok, out = _run(["bluetoothctl", "disconnect" if connected else "connect", mac], timeout=25)
    if ok:
        return True, "Getrennt" if connected else "Verbunden"
    return False, "Verbinden fehlgeschlagen" if not connected else "Trennen fehlgeschlagen"


def bt_remove(mac):
    ok, out = _run(["bluetoothctl", "remove", mac], timeout=10)
    return ok, "Gerät entfernt" if ok else "Entfernen fehlgeschlagen"
