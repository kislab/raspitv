"""Einstellungen von RaspiTV: Speichern/Laden sowie Systemfunktionen (Autostart, Lautstärke)."""
import json
import os
import re
import socket
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIG_HOME = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
FILE = CONFIG_HOME / "raspitv" / "settings.json"
AUTOSTART = CONFIG_HOME / "autostart" / "raspitv.desktop"

TILE_SIZES = {"klein": 0.85, "mittel": 1.0, "groß": 1.2}
DEFAULTS = {
    "tile_size": "mittel",
    "clock_24h": True,
    "animations": True,
    "hidden": [],  # IDs nicht installierter Apps
    "known": [],   # IDs aller Apps, die dieses Konto schon kennt (neue Store-Apps starten deinstalliert)
    "order": [],   # eigene Reihenfolge der Kacheln (App-IDs); fehlende Apps kommen hinten dran
    "jellyfin_url": "",  # Adresse des Jellyfin-Servers (wird im Netz gesucht)
}


# Diese Einstellungen gehören dem jeweiligen Konto, alle anderen gelten für das ganze Gerät
ACCOUNT_KEYS = ("tile_size", "clock_24h", "animations", "hidden", "known", "order")


def _read(path):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def load(account_file=None):
    """Einstellungen laden; mit `account_file` die des Kontos über die des Geräts legen.

    Hat ein Konto noch keine eigene Datei, übernimmt es die bisherigen Geräte-Einstellungen.
    """
    settings = dict(DEFAULTS)
    stored = _read(FILE)
    settings.update({k: v for k, v in stored.items() if k in DEFAULTS})
    if account_file is not None and Path(account_file).exists():
        own = _read(account_file)
        settings.update({k: own[k] for k in ACCOUNT_KEYS if k in own})
    if settings["tile_size"] not in TILE_SIZES:
        settings["tile_size"] = DEFAULTS["tile_size"]
    return settings


def defaults_for_new_account():
    return {k: DEFAULTS[k] for k in ACCOUNT_KEYS}


def save(settings, account_file=None):
    def write(path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    if account_file is None:
        write(FILE, settings)
        return
    device = _read(FILE)
    device.update({k: v for k, v in settings.items() if k not in ACCOUNT_KEYS})
    write(FILE, device)
    write(Path(account_file), {k: settings[k] for k in ACCOUNT_KEYS})


# ---------- Autostart ----------

def autostart_enabled():
    return AUTOSTART.exists()


def set_autostart(enabled):
    """Legt den Autostart-Eintrag an (Terminal öffnen, darin RaspiTV laden) oder entfernt ihn."""
    if not enabled:
        AUTOSTART.unlink(missing_ok=True)
        return
    AUTOSTART.parent.mkdir(parents=True, exist_ok=True)
    AUTOSTART.write_text(
        "[Desktop Entry]\n"
        "Type=Application\n"
        "Name=RaspiTV (Terminal)\n"
        "Comment=Öffnet ein Terminal und startet darin RaspiTV\n"
        "# Nach dem Beenden von RaspiTV bleibt das Terminal mit einer Shell offen.\n"
        # Vor dem Start die neueste Version von GitHub holen (ohne Netz geht es mit der alten weiter)
        f'Exec=lxterminal --title=RaspiTV -e bash -c "cd {ROOT} && git pull --ff-only || true; python3 raspitv.py; exec bash"\n'
        "Icon=video-display\n"
        "Terminal=false\n",
        encoding="utf-8",
    )


# ---------- Lautstärke (PipeWire) ----------

SINK = "@DEFAULT_AUDIO_SINK@"


def get_volume():
    """Lautstärke in Prozent oder None, wenn kein Audiogerät erreichbar ist."""
    try:
        out = subprocess.run(["wpctl", "get-volume", SINK], capture_output=True, text=True, timeout=2).stdout
        return round(float(re.search(r"[\d.]+", out).group()) * 100)
    except (OSError, subprocess.SubprocessError, AttributeError, ValueError):
        return None


def change_volume(step):
    """Ändert die Lautstärke um `step` Prozentpunkte (höchstens 100 %)."""
    try:
        subprocess.run(
            ["wpctl", "set-volume", "-l", "1.0", SINK, f"{abs(step)}%{'+' if step > 0 else '-'}"],
            timeout=2,
        )
    except (OSError, subprocess.SubprocessError):
        pass


# ---------- Updates (GitHub) ----------

def _git(*args, timeout=30):
    return subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True, timeout=timeout)


def version():
    """Aktueller Stand, z. B. "a1b2c3d vom 10.11.2026"."""
    try:
        out = _git("log", "-1", "--format=%h|%cd", "--date=format:%d.%m.%Y", timeout=5).stdout.strip()
        commit, date = out.split("|")
        return f"{commit} vom {date}"
    except (OSError, subprocess.SubprocessError, ValueError):
        return "unbekannt"


def update():
    """Neueste Version von GitHub holen. Gibt (geändert, Meldung) zurück."""
    try:
        before = _git("rev-parse", "HEAD", timeout=5).stdout.strip()
        result = _git("pull", "--ff-only", timeout=60)
        if result.returncode != 0:
            return False, "Update fehlgeschlagen: " + (result.stderr.strip().splitlines() or ["kein Netz?"])[-1][:80]
        after = _git("rev-parse", "HEAD", timeout=5).stdout.strip()
        return before != after, "Neue Version installiert" if before != after else "RaspiTV ist aktuell"
    except (OSError, subprocess.SubprocessError) as error:
        return False, f"Update fehlgeschlagen: {error}"[:100]


# ---------- Jellyfin ----------

def discover_jellyfin(timeout=2.0):
    """Sucht einen Jellyfin-Server im Heimnetz (UDP-Rundruf auf Port 7359); Adresse oder None."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            s.settimeout(timeout)
            s.sendto(b"who is JellyfinServer?", ("255.255.255.255", 7359))
            data, _ = s.recvfrom(4096)
            return json.loads(data).get("Address") or None
    except (OSError, ValueError):
        return None


def reachable(url, timeout=1.5):
    """Antwortet unter dieser Adresse ein Jellyfin-Server?"""
    import urllib.request
    try:
        with urllib.request.urlopen(url.rstrip("/") + "/System/Info/Public", timeout=timeout) as r:
            return r.status == 200
    except (OSError, ValueError):
        return False


# ---------- Info ----------

def ip_address():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 9))  # sendet nichts, ermittelt nur die ausgehende Adresse
            return s.getsockname()[0]
    except OSError:
        return "nicht verbunden"
