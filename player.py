"""Startet einen Streaming-Dienst als randloses Vollbild-Fenster.

Netflix, Disney+ & Co. sind DRM-geschützt (Widevine) und laufen unter Linux nur in einer
Browser-Engine. Chromium dient hier deshalb als reiner Videoplayer ohne sichtbare
Browser-Elemente; Oberfläche und Steuerung liegen komplett im eigenen Programm.
"""
import glob
import json
import os
import signal
import subprocess
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / "raspitv"

# YouTube liefert die fernbedienbare TV-Oberfläche nur an TV-Geräte aus.
USER_AGENTS = {
    "tv": "Mozilla/5.0 (PS4; Leanback Shell) Gecko/20100101 Firefox/65.0 "
          "LeanbackShell/01.00.01.75 Sony PS4/ (PS4, , no, CH)",
}


def gui_env():
    """Umgebung mit Zugriff auf den Bildschirm – auch beim Start über SSH oder systemd."""
    env = dict(os.environ)
    runtime = env.setdefault("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
    if not env.get("WAYLAND_DISPLAY") and not env.get("DISPLAY"):
        sockets = sorted(p for p in glob.glob(f"{runtime}/wayland-*") if not p.endswith(".lock"))
        if sockets:
            env["WAYLAND_DISPLAY"] = os.path.basename(sockets[0])
    return env


def disable_translate(prefs_file):
    """Schaltet in den Profil-Einstellungen das Übersetzen-Popup ab (Schalter allein reichen nicht)."""
    try:
        prefs = json.loads(prefs_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        prefs = {}
    if prefs.get("translate", {}).get("enabled") is False:
        return
    prefs.setdefault("translate", {})["enabled"] = False
    prefs_file.parent.mkdir(parents=True, exist_ok=True)
    prefs_file.write_text(json.dumps(prefs), encoding="utf-8")


CHROMIUM = "/usr/lib/chromium/chromium"

# Sparsamer Betrieb auf dem Pi: nur was ein Fernseher braucht
PERFORMANCE_FLAGS = [
    "--use-angle=gles",                 # Grafik über OpenGL ES (wie das Raspberry-Pi-Startskript)
    "--enable-gpu-rasterization",       # Seiten auf der GPU zeichnen
    "--enable-zero-copy",               # Bilder ohne Umkopieren an die GPU übergeben
    "--disable-background-networking",  # keine Hintergrund-Abfragen
    "--disable-component-update",       # Widevine kommt aus dem Systempaket
    "--disable-sync",
    "--disable-breakpad",
    "--disable-domain-reliability",
    "--disable-client-side-phishing-detection",
    "--disable-default-apps",
    "--disable-pings",
    "--media-router=0",                 # kein Chromecast-Suchen
    "--no-default-browser-check",
    "--disable-smooth-scrolling",
]


# Hintergrunddienste, die beim Video nicht mit dem Player um die CPU kämpfen sollen
# (Fernzugriff kostet sonst bis zu einer ganzen CPU-Kern-Leistung)
BACKGROUND = ("wayvnc", "rpi-connectd", "rpi-connect", "lxpanel", "wf-panel-pi", "pcmanfm", "pcmanfm-pi")


def calm_background():
    """Hintergrunddienste des Benutzers auf niedrige Priorität setzen (nice 10)."""
    for name in BACKGROUND:
        try:
            pids = subprocess.run(["pgrep", "-u", str(os.getuid()), "-x", name],
                                  capture_output=True, text=True, timeout=2).stdout.split()
        except (OSError, subprocess.SubprocessError):
            continue
        for pid in pids:
            try:
                if os.getpriority(os.PRIO_PROCESS, int(pid)) < 10:
                    os.setpriority(os.PRIO_PROCESS, int(pid), 10)
            except (OSError, ValueError):
                pass


class Player:
    """Hält höchstens einen laufenden Dienst (eigenes Profil, Logins bleiben erhalten)."""

    def __init__(self):
        self.lock = threading.Lock()
        self.proc = None
        self.app_id = None

    def running(self):
        with self.lock:
            if self.proc and self.proc.poll() is not None:
                self.proc = self.app_id = None
            return self.app_id

    def launch(self, app, width, height, profile=None):
        """Startet einen Dienst im Browser-Profil `profile` (je RaspiTV-Konto eigene Logins)."""
        self.stop()
        profile = Path(profile or DATA / "player")
        # Verwaiste Player (z. B. nach einem Absturz) würden den Start an sich reißen:
        # Chromium übergibt die Adresse dann an den alten Prozess und beendet sich sofort.
        subprocess.run(["pkill", "-f", "--", f"--user-data-dir={DATA}/"])
        env = gui_env()
        cmd = [
            # Direkt starten statt über /usr/bin/chromium: das Startskript von Raspberry Pi OS
            # setzt u. a. --force-renderer-accessibility, das bei Netflix spürbar Leistung kostet.
            CHROMIUM if os.path.exists(CHROMIUM) else "chromium",
            f"--user-data-dir={profile}",
            *PERFORMANCE_FLAGS,
            # mit Vergrößerung („scale“) zählt Chromium die Fenstergröße in vergrößerten Punkten
            "--kiosk", "--window-position=0,0",
            f"--window-size={round(width / float(app.get('scale') or 1))},{round(height / float(app.get('scale') or 1))}",
            "--no-first-run", "--noerrdialogs",
            "--password-store=basic",  # sonst blockiert ein Schlüsselbund-Dialog den Start
            "--lang=de", "--accept-lang=de-DE,de,en",  # Seiten auf Deutsch anfordern
            # kein Übersetzen-Popup; eigene TV-Erweiterung per Kommandozeile zulassen
            "--disable-features=Translate,TranslateUI,DisableLoadExtensionCommandLineSwitch,"
            "OptimizationHints,MediaRouter,GlobalMediaControls,HardwareMediaKeyHandling,"
            "AutofillServerCommunication,CertificateTransparencyComponentUpdater",
            f"--load-extension={ROOT / 'tv-extension'}",  # TV-Bedienung für die Webseiten
            "--hide-crash-restore-bubble", "--disable-session-crashed-bubble",
            "--autoplay-policy=no-user-gesture-required",
        ]
        if env.get("WAYLAND_DISPLAY"):
            cmd.append("--ozone-platform=wayland")  # sonst versucht Chromium X11
        if os.environ.get("RASPITV_DEBUG"):
            # Nur für die Entwicklung: Seite im Player per DevTools-Protokoll untersuchen
            cmd.append("--remote-debugging-port=9222")
        if app.get("scale"):  # Seite für den Fernseher vergrößern (Schrift/Knöpfe aus der Entfernung lesbar)
            cmd.append(f"--force-device-scale-factor={app['scale']}")
        if app.get("ua") in USER_AGENTS:
            cmd.append(f"--user-agent={USER_AGENTS[app['ua']]}")
        cmd.append(app["url"])
        DATA.mkdir(parents=True, exist_ok=True)
        disable_translate(profile / "Default" / "Preferences")
        # Im Entwicklungsmodus Chromium-Ausgaben (u. a. des Widevine-Zwischensteckers) mitschreiben
        log = open(DATA / "player.log", "wb") if os.environ.get("RASPITV_DEBUG") else subprocess.DEVNULL
        with self.lock:
            self.proc = subprocess.Popen(
                cmd, env=env, start_new_session=True,
                stdout=log, stderr=log,
            )
            self.app_id = app["id"]
        calm_background()

    def stop(self):
        with self.lock:
            proc, self.proc, self.app_id = self.proc, None, None
        if not proc or proc.poll() is not None:
            return
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
