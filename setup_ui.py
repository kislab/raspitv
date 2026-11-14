"""Einrichtungs-Assistent beim ersten Start (raspitv.py --setup, gestartet von install.sh).

Fernbedienung koppeln (zuerst – damit sich alles Weitere damit bedienen lässt) → Willkommen → Benutzer anlegen →
WLAN aussuchen → Auf Updates prüfen → Einrichten (Ladebalken: Programme, Startmenü, Autostart, Bootbild, Bluetooth,
Neustart-Recht, Entschlacken) → Homescreen. Ist in einem Schritt etwas eingerichtet, leuchtet „Weiter“ blau.
Bedienung wie überall in RaspiTV: Fernbedienung, Tastatur oder Handy; Texte über die Bildschirmtastatur.
Systemänderungen laufen über boot/setup.sh mit sudo – install.sh hat das Passwort vorher im Terminal abgefragt.
"""
import os
import re
import subprocess
import sys
import threading
from pathlib import Path

import network
from PyQt5.QtCore import QTimer

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
STEP_ORDER = ["remote", "welcome", "account", "wifi", "update", "install"]
MAC_NAME = re.compile(r"^([0-9A-F]{2}[-:]){5}[0-9A-F]{2}$", re.I)  # Geräte ohne Namen (meist keine Fernbedienung)


class SetupUI:
    """Teil von Home (raspitv.py): Ablauf, Zustand für die Oberfläche (qml/Setup.qml) und Tasten."""

    def init_setup(self):
        self.setup = None
        if "--setup" in sys.argv:
            skip = set(os.environ.get("RASPITV_SETUP_SKIP", "").split())
            self.setup = {"step": "remote", "item": 0, "update": None, "updated": False,
                          "steps": [{"id": i, "label": l, "weight": w, "state": "skip" if i in skip else "wait"}
                                    for i, l, w in INSTALL_STEPS],
                          "progress": 0.0, "line": "", "error": ""}
            self.view = "setup"
            QTimer.singleShot(800, self.setup_enter_remote)

    # ---------- Zeilen je Schritt ----------

    def setup_items(self):
        st = self.setup
        step = st["step"]
        nxt = {"kind": "action", "label": "Weiter", "hint": "", "run": self.setup_next, "primary": True}
        if step == "welcome":
            return [{"kind": "action", "label": "Los geht's", "hint": "", "run": self.setup_next, "primary": True}]
        if step == "account":
            account = self.acc_data["accounts"][0]
            return [{"kind": "action", "label": account["name"], "hint": "Name ändern",
                     "run": lambda: self.setup_rename(account)},
                    {"kind": "action", "label": "Profilbild", "hint": "Ändern",
                     "run": lambda: self.open_avatar_pick(account, lambda: self.setup.update(named=True))},
                    dict(nxt, primary=st.get("named", False))]  # blau, sobald der Name eingetragen ist
        if step == "wifi":
            # ohne den WLAN-Schalter (aus Versehen ausschalten wäre hier nur hinderlich, außer es ist aus)
            items = [it for it in self.wifi_items() if not (it["kind"] == "toggle" and self.wifi["on"])]
            connected = bool(network.wifi_current())
            items.append({"kind": "action", "label": "Weiter" if connected else "Ohne WLAN weiter",
                          "hint": "", "run": self.setup_next, "primary": connected})
            return items
        if step == "update":
            u = st["update"]
            if u is None:
                return [{"kind": "info", "label": "Suche nach Updates …", "value": ""}]
            return [{"kind": "info", "label": u, "value": ""}, nxt]
        if step == "remote":
            items = [{"kind": "header", "label": "Gekoppelt"}]
            if self.remote_name:  # Liste aus set_remotes (kein bluetoothctl bei jedem Bildaufbau)
                items.append({"kind": "info", "label": self.remote_name,
                              "value": "Verbunden" if self.remote_input and self.remote_input.open else "Gekoppelt"})
            else:
                items.append({"kind": "info", "label": "Noch keine Fernbedienung", "value": ""})
            items.append({"kind": "header", "label": "Gefunden" + (" – suche …" if self.bt["scanning"] else "")})
            found = [d for d in self.bt["found"] if not MAC_NAME.match(d["name"])]
            for dev in found:
                items.append({"kind": "action", "label": dev["name"], "hint": "Koppeln",
                              "run": lambda dev=dev: self.bt_pair(dev)})
            if not found:
                items.append({"kind": "info", "label": "Noch nichts gefunden", "value": ""})
            items.append({"kind": "action", "label": "Weiter" if self.remote_name else "Ohne Fernbedienung weiter",
                          "hint": "", "run": self.setup_next, "primary": bool(self.remote_name)})
            return items
        if step == "install":
            if st["error"]:
                return [{"kind": "action", "label": "Nochmal versuchen", "hint": "", "run": self.setup_install},
                        {"kind": "action", "label": "Schritt überspringen", "hint": "", "run": self.setup_skip_failed}]
            return []
        return []

    TEXTS = {
        "remote": ("Fernbedienung koppeln",
                   "Halte die Home-Taste deiner Fernbedienung etwa 10 Sekunden, bis sie blinkt. "
                   "Sie erscheint dann unter „Gefunden“ – mit OK koppeln."),
        "welcome": ("Willkommen bei RaspiTV", "In ein paar Schritten ist dein Raspberry Pi ein Fernseher-Zuspieler: "
                    "Netflix, Disney+, YouTube, Mediatheken und mehr – bedienbar mit der Fernbedienung."),
        "account": ("Wie heißt du?", "Name und Profilbild erscheinen oben im Homescreen. Weitere Personen mit eigenen "
                    "Logins kannst du später unter „Konto“ anlegen."),
        "wifi": ("WLAN aussuchen", "Wähle dein WLAN. Mit Kabel oder bestehender Verbindung kannst du einfach weiter."),
        "update": ("Auf Updates prüfen", "RaspiTV holt sich die neueste Version."),
        "install": ("RaspiTV wird eingerichtet", "Das dauert ein paar Minuten. Danach geht es direkt zum Homescreen."),
    }

    def setup_keep_selection(self, items, focusable):
        """Auswahl auf derselben Zeile halten, wenn sich die Liste ändert (z. B. neue Geräte bei der Suche)."""
        st = self.setup
        sel = st.get("sel")
        if sel and not (0 <= st["item"] < len(items) and items[st["item"]]["label"] == sel):
            same = [i for i in focusable if items[i]["label"] == sel]
            if same:
                st["item"] = same[0]
        # Wird „Weiter“ blau (etwas eingerichtet), springt die Auswahl einmal darauf
        primary = next((i for i in focusable if items[i].get("primary")), None)
        if primary is not None and not st.get("jumped"):
            st["jumped"] = True
            if st["step"] not in ("welcome", "update"):
                st["item"] = primary
        if 0 <= st["item"] < len(items):
            st["sel"] = items[st["item"]]["label"]

    def setup_state(self):
        st = self.setup
        if not st:
            return None
        items = self.setup_items()
        focusable = [i for i, it in enumerate(items) if it["kind"] in FOCUSABLE]
        self.setup_keep_selection(items, focusable)
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
        self.setup_keep_selection(items, focusable)
        if key in ("up", "down") and focusable:
            pos = focusable.index(st["item"]) if st["item"] in focusable else 0
            pos = max(0, min(len(focusable) - 1, pos + (1 if key == "down" else -1)))
            st["item"] = focusable[pos]
            st["sel"] = items[st["item"]]["label"]
        elif key == "ok" and st["item"] < len(items):
            it = items[st["item"]]
            if it["kind"] == "action":
                it["run"]()
            elif it["kind"] == "toggle":
                it["change"](1)
        elif key == "back" and st["step"] in ("welcome", "account", "wifi", "update"):
            st["step"] = STEP_ORDER[STEP_ORDER.index(st["step"]) - 1]
            st["item"], st["sel"], st["jumped"] = 0, None, False
            if st["step"] == "remote":
                self.setup_scan_remotes()

    # ---------- Ablauf ----------

    def setup_next(self):
        st = self.setup
        st["step"] = STEP_ORDER[STEP_ORDER.index(st["step"]) + 1]
        st["item"], st["sel"], st["jumped"] = 0, None, False
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

    def setup_rename(self, account):
        """Name eintragen; nach dem Bestätigen (auch unverändert) gilt der Schritt als erledigt."""
        self.rename_account(account)
        inner = self.osk["done"]

        def done(name):
            inner(name)
            if self.osk is None and self.setup:  # angenommen (sonst steht ein Fehler in der Tastatur)
                self.setup["named"] = True
        self.osk["done"] = done

    def setup_enter_remote(self):
        """Erster Schritt: Bluetooth für Amazon-/Fire-TV-Fernbedienungen einstellen (Privacy, sonst lehnen sie
        das Koppeln ab – boot/setup.sh bluetooth) und dann gleich nach Fernbedienungen suchen."""
        st = self.setup
        step = next(s for s in st["steps"] if s["id"] == "bluetooth")

        def work():
            if step["state"] in ("done", "skip"):
                return True
            try:
                return subprocess.run(["bash", str(ROOT / "boot" / "setup.sh"), "bluetooth"], capture_output=True,
                                      timeout=60, env={**os.environ, "RASPITV_SUDO_N": "1"}).returncode == 0
            except (OSError, subprocess.SubprocessError):
                return False

        def done(ok):
            if ok and step["state"] == "wait":
                step["state"] = "done"   # beim Einrichten nicht noch einmal
            self.bt["found"] = []
            self.setup_scan_remotes()
        self.run_bg(work, done)

    def setup_scan_remotes(self):
        """Im Schritt „Fernbedienung“ ständig nach Geräten suchen (je 8 s), bis es weitergeht."""
        if not self.setup or self.setup["step"] != "remote" or self.bt["scanning"]:
            return
        if not network.bt_enabled():
            network.set_bluetooth(True)
        self.bt["scanning"] = True

        def done(found):
            self.bt.update(found=found, scanning=False)
            # weitersuchen, bis eine Fernbedienung gekoppelt ist (danach darf sie sich in Ruhe verbinden)
            if not self.remote_name:
                QTimer.singleShot(500 if self.dialog is None else 3000, self.setup_scan_remotes)
        self.run_bg(lambda: network.bt_scan(8, le_only=True), done)

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
        if not self.setup:
            return
        updated = self.setup["updated"]
        self.setup = None
        if updated:
            # neue Version geladen: RaspiTV in diesem Prozess neu laden, damit der Homescreen schon die neue ist
            os.execv(sys.executable, [sys.executable, str(ROOT / "raspitv.py"), "--after-setup"])
        self.view = "home"
        self.show_toast("RaspiTV ist eingerichtet – ganz wirksam nach dem nächsten Neustart", 8)
