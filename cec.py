"""HDMI-CEC: den Fernseher über das HDMI-Kabel ein- und ausschalten (cec-ctl aus v4l-utils).

RaspiTV meldet sich am Fernseher als Abspielgerät „RaspiTV“ an. Schläft RaspiTV, geht der Fernseher in
Standby. Wacht RaspiTV auf, schaltet es den Fernseher ein und auf den eigenen HDMI-Eingang
(Image View On + Active Source, wie bei Fire TV & Co.).

In die andere Richtung hört RaspiTV mit: Schaltet man den Fernseher mit seiner eigenen Fernbedienung aus,
schläft RaspiTV auch ein. Wählt man am Fernseher den HDMI-Eingang von RaspiTV, wacht es auf.
Ohne CEC (z. B. an einem Monitor) passiert einfach nichts.
"""
import re
import subprocess
import threading
import time
from pathlib import Path

TV = 0  # logische Adresse des Fernsehers
OPS = {0x36: "standby", 0x86: "stream", 0x80: "routing", 0x81: "routing", 0x8F: "power?"}


def _run(*args, timeout=8):
    try:
        r = subprocess.run(["cec-ctl", *args], capture_output=True, text=True, timeout=timeout)
        return r.returncode == 0, r.stdout
    except (OSError, subprocess.SubprocessError):
        return False, ""


class Cec:
    def __init__(self, on_standby=None, on_select=None, is_awake=lambda: True):
        self.on_standby = on_standby   # Fernseher ging aus
        self.on_select = on_select     # am Fernseher wurde der Eingang von RaspiTV gewählt
        self.is_awake = is_awake
        self.dev = None
        self.addr = None               # Physikalische Adresse, z. B. "2.0.0.0" (HDMI-Anschluss 2)
        self.lock = threading.Lock()
        self.quiet_until = 0.0         # eigene Befehle: Antworten des Fernsehers kurz nicht auswerten
        threading.Thread(target=self.listen, daemon=True).start()

    # ---------- Anschluss finden und anmelden ----------

    def find(self):
        """Den CEC-Anschluss suchen, an dem ein Gerät hängt, und RaspiTV dort als Abspielgerät anmelden."""
        for dev in sorted(Path("/dev").glob("cec[0-9]*")):
            ok, out = _run("-d", str(dev))
            m = re.search(r"Physical Address\s*:\s*([0-9a-f.]+)", out)
            if not ok or not m or m.group(1) == "f.f.f.f":
                continue
            if "Playback" not in out or "RaspiTV" not in out:
                _run("-d", str(dev), "--playback", "--osd-name", "RaspiTV")
            self.dev, self.addr = str(dev), m.group(1)
            return True
        self.dev = self.addr = None
        return False

    def send(self, *args):
        with self.lock:
            for _ in range(2):  # Kabel umgesteckt / Anschluss neu angemeldet: einmal neu suchen
                if self.dev or self.find():
                    ok, _ = _run("-d", self.dev, *args)
                    if ok:
                        return True
                self.dev = None
            return False

    # ---------- Fernseher schalten ----------

    def tv_off(self):
        self.quiet_until = time.monotonic() + 5
        return self.send("--to", str(TV), "--standby")

    def tv_on(self):
        """Fernseher einschalten und auf RaspiTV umschalten."""
        self.quiet_until = time.monotonic() + 5
        ok = self.send("--to", str(TV), "--image-view-on")
        return self.send("--active-source", f"phys-addr={self.addr}") and ok

    # ---------- Mithören ----------

    def listen(self):
        """Nachrichten vom Fernseher lesen (cec-ctl -W läuft dauerhaft; bricht es ab, nach 10 s neu)."""
        while True:
            with self.lock:
                found = self.dev or self.find()
            if not found:
                time.sleep(30)
                continue
            try:
                proc = subprocess.Popen(["stdbuf", "-oL", "cec-ctl", "-d", self.dev, "-W", "-r"],
                                        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
                for line in proc.stdout:
                    m = re.match(r"\s*Raw:\s*((?:0x[0-9a-f]{2}\s*)+)", line)
                    if m:
                        self.message([int(b, 16) for b in m.group(1).split()])
                proc.wait()
            except OSError:
                pass
            self.dev = None
            time.sleep(10)

    def message(self, raw):
        if len(raw) < 2 or raw[0] >> 4 != TV:
            return
        what, params = OPS.get(raw[1]), raw[2:]
        addr = ".".join(f"{x:x}" for b in params[:2] for x in (b >> 4, b & 15)) if len(params) >= 2 else ""
        if raw[1] == 0x80:  # Routing Change: alte Adresse, neue Adresse
            addr = ".".join(f"{x:x}" for b in params[2:4] for x in (b >> 4, b & 15)) if len(params) >= 4 else ""
        if what == "power?":
            # Der Fernseher fragt, ob RaspiTV an ist (0 = an, 1 = Standby)
            threading.Thread(target=self.send, args=("--to", "0", "--report-power-status",
                                                     f"pwr-state={0 if self.is_awake() else 1}"), daemon=True).start()
        elif time.monotonic() < self.quiet_until:
            return
        elif what == "standby" and self.on_standby:
            self.on_standby()
        elif what in ("stream", "routing") and addr == self.addr and self.on_select:
            self.on_select()
