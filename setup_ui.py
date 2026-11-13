"""Einrichtungs-Assistent beim ersten Start (raspitv.py --setup, gestartet von install.sh).

Willkommen → Benutzer anlegen → WLAN aussuchen → Auf Updates prüfen → Einrichten (Ladebalken: Programme,
Startmenü, Autostart, Bootbild, Bluetooth, Neustart-Recht, Entschlacken) → Homescreen.
Bedienung wie überall in RaspiTV: Fernbedienung, Tastatur oder Handy; Texte über die Bildschirmtastatur.
Systemänderungen laufen über boot/setup.sh mit sudo – install.sh hat das Passwort vorher im Terminal abgefragt.
"""
import os
import subprocess
import sys
import threading
from pathlib import Path

import network

ROOT = Path(__file__).resolve().parent
FOCUSABLE = ("toggle", "choice", "action", "range")

# Einrichtungsschritte (boot/setup.sh) mit Anteil am Ladebalken
INSTALL_STEPS = [
    ("packages", "Programme installieren", 25),
    ("entries", "Startmenü und Desktop-Symbole", 2),
    ("autostart", "Start beim Hochfahren", 2),
    ("bootlogo", "RaspiTV-Bootbild", 18),
    ("bluetooth", "Bluetooth für Fernbedienungen", 3),
    ("power", "Neustart und Ausschalten erlauben", 2),
    ("slim", "System entschlacken", 48),
]
STEP_ORDER = ["welcome", "account", "wifi", "update", "install"]


class SetupUI:
    """Teil von Home (raspitv.py): Ablauf, Zustand für die Oberfläche (qml/Setup.qml) und Tasten."""

    def init_setup(self):
        self.setup = None
        if "--setup" in sys.argv:
            skip = set(os.environ.get("RASPITV_SETUP_SKIP", "").split())
            self.setup = {"step": "welcome", "item": 0, "update": None, "updated": False,
                          "steps": [{"id": i, "label": l, "weight": w, "state": "skip" if i in skip else "wait"}
                                    for i, l, w in INSTALL_STEPS],
                          "progress": 0.0, "line": "", "error": ""}
            self.view = "setup"

    # ---------- Zeilen je Schritt ----------

    def setup_items(self):
        st = self.setup
        step = st["step"]
        nxt = {"kind": "action", "label": "Weiter", "hint": "", "run": self.setup_next}
        if step == "welcome":
            return [{"kind": "action", "label": "Los geht's", "hint": "", "run": self.setup_next}]
        if step == "account":
            account = self.acc_data["accounts"][0]
            return [{"kind": "action", "label": account["name"], "hint": "Name ändern",
                     "run": lambda: self.rename_account(account)}, nxt]
        if step == "wifi":
            # ohne den WLAN-Schalter (aus Versehen ausschalten wäre hier nur hinderlich, außer es ist aus)
            items = [it for it in self.wifi_items() if not (it["kind"] == "toggle" and self.wifi["on"])]
            items.append({"kind": "action", "label": "Weiter" if network.wifi_current() else "Ohne WLAN weiter",
                          "hint": "", "run": self.setup_next})
            return items
        if step == "update":
            u = st["update"]
            if u is None:
                return [{"kind": "info", "label": "Suche nach Updates …", "value": ""}]
            return [{"kind": "info", "label": u, "value": ""}, nxt]
        if step == "install":
            if st["error"]:
                return [{"kind": "action", "label": "Nochmal versuchen", "hint": "", "run": self.setup_install},
                        {"kind": "action", "label": "Schritt überspringen", "hint": "", "run": self.setup_skip_failed}]
            return []
        return []

    TEXTS = {
        "welcome": ("Willkommen bei RaspiTV", "In ein paar Schritten ist dein Raspberry Pi ein Fernseher-Zuspieler: "
                    "Netflix, Disney+, YouTube, Mediatheken und mehr – bedienbar mit der Fernbedienung."),
        "account": ("Wie heißt du?", "Dein Name erscheint oben im Homescreen. Weitere Personen mit eigenen Logins "
                    "kannst du später unter „Konto“ anlegen."),
        "wifi": ("WLAN aussuchen", "Wähle dein WLAN. Mit Kabel oder bestehender Verbindung kannst du einfach weiter."),
        "update": ("Auf Updates prüfen", "RaspiTV holt sich die neueste Version."),
        "install": ("RaspiTV wird eingerichtet", "Das dauert ein paar Minuten. Danach geht es direkt zum Homescreen."),
    }

    def setup_state(self):
        st = self.setup
        if not st:
            return None
        items = self.setup_items()
        focusable = [i for i, it in enumerate(items) if it["kind"] in FOCUSABLE]
        if focusable and st["item"] == -1:
            st["item"] = focusable[-1]   # z. B. „Weiter“ im WLAN-Schritt, wenn schon verbunden
        if focusable and st["item"] not in focusable:
            st["item"] = focusable[0]
        title, text = self.TEXTS[st["step"]]
        return {"step": st["step"], "index": STEP_ORDER.index(st["step"]), "count": len(STEP_ORDER),
                "title": title, "text": text, "item": st["item"],
                "items": [self.item_info(it) for it in items],
                "progress": st["progress"], "line": st["line"], "error": st["error"],
                "steps": [{"label": s["label"], "state": s["state"]} for s in st["steps"]]}

    # ---------- Tasten ----------

    def setup_key(self, key):
        st = self.setup
        items = self.setup_items()
        focusable = [i for i, it in enumerate(items) if it["kind"] in FOCUSABLE]
        if key in ("up", "down") and focusable:
            pos = focusable.index(st["item"]) if st["item"] in focusable else 0
            pos = max(0, min(len(focusable) - 1, pos + (1 if key == "down" else -1)))
            st["item"] = focusable[pos]
        elif key == "ok" and st["item"] < len(items):
            it = items[st["item"]]
            if it["kind"] == "action":
                it["run"]()
            elif it["kind"] == "toggle":
                it["change"](1)
        elif key == "back" and st["step"] in ("account", "wifi", "update"):
            st["step"] = STEP_ORDER[STEP_ORDER.index(st["step"]) - 1]
            st["item"] = 0

    # ---------- Ablauf ----------

    def setup_next(self):
        st = self.setup
        st["step"] = STEP_ORDER[STEP_ORDER.index(st["step"]) + 1]
        st["item"] = 0
        if st["step"] == "wifi":
            self.wifi.update(on=network.wifi_enabled(), nets=network.wifi_scan(rescan=False))
            self.scan_wifi()
            if network.wifi_current():
                st["item"] = -1
        elif st["step"] == "update":
            st["update"] = None
            self.run_bg(self.setup_check_update, self.setup_update_done)
        elif st["step"] == "install":
            self.setup_install()

    @staticmethod
    def setup_check_update():
        def git(*args):
            return subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True, timeout=60,
                                  env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})
        try:
            before = git("rev-parse", "HEAD").stdout.strip()
            pull = git("pull", "--ff-only", "-q")
            after = git("rev-parse", "HEAD").stdout.strip()
        except (OSError, subprocess.SubprocessError):
            return "Keine Verbindung – Updates gibt es später automatisch", False
        if pull.returncode != 0:
            return "Keine Verbindung – Updates gibt es später automatisch", False
        if before != after:
            return f"Neue Version geladen ({after[:7]})", True
        return "RaspiTV ist auf dem neuesten Stand", False

    def setup_update_done(self, result):
        text, updated = result
        self.setup.update(update=text, updated=self.setup["updated"] or updated)

    def setup_install(self):
        st = self.setup
        st["error"] = ""

        def work():
            total = sum(s["weight"] for s in st["steps"] if s["state"] != "skip") or 1
            done = sum(s["weight"] for s in st["steps"] if s["state"] == "done")
            for s in st["steps"]:
                if s["state"] in ("done", "skip"):
                    continue
                s["state"] = "run"
                lines = 0
                try:
                    proc = subprocess.Popen(["bash", str(ROOT / "boot" / "setup.sh"), s["id"]], stdout=subprocess.PIPE,
                                            stderr=subprocess.STDOUT, text=True, bufsize=1,
                                            env={**os.environ, "RASPITV_SUDO_N": "1", "DEBIAN_FRONTEND": "noninteractive"})
                except OSError as error:
                    s["state"] = "error"
                    st["error"] = f"„{s['label']}“ ging nicht: {error}"
                    self.bgDone.emit(lambda: None)
                    return
                for line in proc.stdout:
                    line = line.strip()
                    if not line:
                        continue
                    lines += 1
                    # innerhalb eines Schritts langsam vorrücken (Ausgaben zählen), nie ganz bis zum Ende
                    frac = 1 - 0.985 ** lines
                    st["progress"] = (done + s["weight"] * frac) / total
                    st["line"] = line[:120]
                    self.bgDone.emit(lambda: None)
                if proc.wait() != 0:
                    s["state"] = "error"
                    st["error"] = (f"„{s['label']}“ ging nicht. Läuft install.sh noch im Terminal? "
                                   "(Das sudo-Passwort ist dort nur eine Weile gültig.)")
                    self.bgDone.emit(lambda: None)
                    return
                s["state"] = "done"
                done += s["weight"]
                st["progress"] = done / total
                self.bgDone.emit(lambda: None)
            st["line"] = "Fertig"
            self.bgDone.emit(self.setup_finish)
        threading.Thread(target=work, daemon=True).start()

    def setup_skip_failed(self):
        for s in self.setup["steps"]:
            if s["state"] == "error":
                s["state"] = "skip"
        self.setup_install()

    def setup_finish(self):
        updated = self.setup["updated"]
        self.setup = None
        if updated:
            # neue Version geladen: RaspiTV in diesem Prozess neu laden, damit der Homescreen schon die neue ist
            os.execv(sys.executable, [sys.executable, str(ROOT / "raspitv.py"), "--after-setup"])
        self.view = "home"
        self.show_toast("RaspiTV ist eingerichtet – ganz wirksam nach dem nächsten Neustart", 8)
