#!/usr/bin/env python3
"""RaspiTV – native TV-Oberfläche im Google-TV-Stil.

Aufbau: Python hält Zustand und Logik (Tasten, Konten, Einstellungen, Player); die Oberfläche ist in
QML/Qt Quick geschrieben (qml/) und wird von der Grafikeinheit gezeichnet. Python gibt nach jeder
Änderung einen Schnappschuss des Zustands (`state`, JSON) an QML, QML zeichnet und animiert ihn.

Bedienung: Pfeiltasten, Enter = OK, Esc/Backspace = Zurück, Pos1 = Home.
Fernbedienungen speisen dieselben Tasten über remote.py ein.
"""
import json
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

from player import Player, gui_env

os.environ.update(gui_env())
if os.environ.get("WAYLAND_DISPLAY"):
    os.environ.setdefault("QT_QPA_PLATFORM", "wayland;xcb")

from PyQt5.QtCore import QObject, Qt, QTimer, QUrl, pyqtProperty, pyqtSignal
from PyQt5.QtGui import QColor, QFont, QGuiApplication, QImage, QPainter

try:
    from PyQt5.QtQuick import QQuickView
except ImportError:
    sys.exit("RaspiTV braucht Qt Quick. Bitte installieren:\n"
             "  sudo apt-get install -y python3-pyqt5.qtquick qml-module-qtquick2 "
             "qml-module-qtquick-window2 qml-module-qtgraphicaleffects")

import network
import phone
import remote
import remote_input
import settings as cfg
from jellyfin_ui import JellyfinUI
from profiles_ui import MAX_LEN, PIN_LEN, AccountsUI

ROOT = Path(__file__).resolve().parent
CACHE = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "raspitv" / "logos"

KEYMAP = {
    Qt.Key_Up: "up", Qt.Key_Down: "down", Qt.Key_Left: "left", Qt.Key_Right: "right",
    Qt.Key_Return: "ok", Qt.Key_Enter: "ok", Qt.Key_Space: "ok", Qt.Key_Select: "ok",
    Qt.Key_Escape: "back", Qt.Key_Backspace: "back", Qt.Key_Back: "back",
    Qt.Key_Home: "home", Qt.Key_HomePage: "home",
}
HEADER, APPS, STORE = 0, 1, 2                         # Zeilen der Startseite
FOCUSABLE = ("choice", "toggle", "action", "range")   # wählbare Einstellungs-Zeilen
LONG_PRESS = 0.6                                      # Sekunden OK halten für das Kachel-Menü
COVERED_AFTER = 8                                     # Sekunden nach dem Start: Player liegt sicher vorn


def logo_url(app, variant):
    """Datei-URL des Logos (logos/<id>.png bzw. <id>_hero.png); einfarbige Logos werden einmal
    umgefärbt und im Cache abgelegt. Leer, wenn die App kein Logo hat."""
    files = [ROOT / "logos" / f"{app['id']}.png"]
    if variant == "hero":
        files.insert(0, ROOT / "logos" / f"{app['id']}_hero.png")
    source = next((f for f in files if f.exists()), None)
    if source is None:
        return ""
    if not app.get("tint"):
        return QUrl.fromLocalFile(str(source)).toString()
    target = CACHE / f"{source.stem}-{app['tint'].lstrip('#')}.png"
    if not target.exists() or target.stat().st_mtime < source.stat().st_mtime:
        image = QImage(str(source)).convertToFormat(QImage.Format_ARGB32_Premultiplied)
        painter = QPainter(image)
        painter.setCompositionMode(QPainter.CompositionMode_SourceIn)
        painter.fillRect(image.rect(), QColor(app["tint"]))
        painter.end()
        CACHE.mkdir(parents=True, exist_ok=True)
        image.save(str(target))
    return QUrl.fromLocalFile(str(target)).toString()


class Home(AccountsUI, JellyfinUI, QObject):
    """Zustand und Logik der Oberfläche. QML liest `state` und zeichnet danach."""
    key = pyqtSignal(str)       # auch aus dem Fernbedienungs-Thread auslösbar
    stateChanged = pyqtSignal()
    bgDone = pyqtSignal(object)  # Ergebnis einer Hintergrund-Aufgabe (Funktion, die im Hauptthread läuft)

    def __init__(self, apps, player):
        super().__init__()
        self.all_apps = apps
        self.player = player
        self.window = None             # QQuickView, wird in main() gesetzt
        self._state = "{}"
        self.info = {a["id"]: dict(
            id=a["id"], name=a["name"], tag=a.get("tag", "App"), desc=a.get("desc", ""),
            bg=a["bg"], heroBg=a.get("hero_bg", a["bg"]), fg=a["fg"], accent=a["accent"],
            logo=logo_url(a, "tile"), heroLogo=logo_url(a, "hero")) for a in apps}
        self.init_accounts()           # Konto (eigene Logins und Einstellungen) und dessen Einstellungen
        self.init_jellyfin()           # Jellyfin als eigene App (jellyfin_ui.py)
        self.row = APPS
        self.col = 0                   # gewählte App
        self.store_col = 0             # gewählte App in „Verfügbare Apps“
        self.view = self.start_view    # "home" | "settings" | "profiles" („Wer schaut?“)
        self.cats, self.cat = [], 0    # Einstellungs-Kategorien und gewählte Kategorie
        self.items, self.item = [], 0  # Zeilen der gewählten Kategorie und gewählte Zeile
        self.pane = "cats"             # Fokus in den Einstellungen: "cats" (links) | "items" (rechts)
        self.sub = None                # Unterseite in den Einstellungen: None | "wifi" | "bt"
        self.sub_parent = 0            # Zeile, von der aus die Unterseite geöffnet wurde
        self.wifi = {"on": False, "nets": [], "scanning": False}
        self.bt = {"on": False, "paired": [], "found": [], "scanning": False}
        self.wifi_name = ""            # verbundenes WLAN für die Kopfzeile (alle 15 s im Hintergrund geprüft)
        self.remote_name = ""          # gekoppelte Bluetooth-Fernbedienung (Kopfzeile)
        self.remote_macs = []          # Adressen gekoppelter Fernbedienungen (für remote_input)
        self.remote_battery = None     # Akkustand der Fernbedienung in Prozent (falls sie ihn meldet)
        self.battery_warned = False    # Hinweis „Akku fast leer“ schon gezeigt
        self.remote_input = None       # liest Fernbedienungen direkt (in main() gesetzt)
        self.pairing_until = 0.0       # bis wann der Bluetooth-Agent Kopplungen annimmt
        self.ticks = 0
        self.volume = None
        self.outputs = []  # Audio-Ausgänge (für Einstellungen → Ton)
        self.modes = []    # Auflösungen des Bildschirms (für Einstellungen → Darstellung)
        self.mode_pending = None  # gerade umgeschaltet, Antwort auf „Bild in Ordnung?“ steht aus
        self.rate_restore = None  # Bildraten-Anpassung: (Ausgang, Modus) zum Zurückstellen nach dem Video
        self.base_mode = None     # Grund-Bildrate (beim Start bzw. nach Wahl in den Einstellungen)
        self.rate_lock = threading.Lock()
        self.vol = {"value": 0, "muted": False, "seq": 0}  # Lautstärke-Anzeige (seq zählt Tastendrücke)
        self.last_input = time.monotonic()  # letzter Tastendruck (Bildschirmschoner, Bildschirm aus)
        self.saver = None              # None | "clock" (Bildschirmschoner) | "off" (Bildschirm aus)
        self.sleep_min = 0             # Sleep-Timer: gewählte Minuten (0 = aus)
        self.sleep_at = None           # … und wann er abläuft (monotonic)
        self.sleep_warned = False      # Warnung „gleich wird ausgeschaltet“ ist zu sehen
        self.phone = None              # Handy als Fernbedienung (phone.PhoneServer, in main() gesetzt)
        self.phone_pair = None         # Seite „Handy verbinden“: {"url", "code", "qr"}
        self.toast = None              # Hinweis oben: {"text", "seq"}
        self.toast_until = 0.0
        self.dialog = None            # {"text", "buttons": [(label, fn)], "index", "app"?}
        self.menu = None               # Kachel-Menü: {"items": [(label, fn)], "index", "title", "anchor", "at"}
        self.moving = False            # Kachel wird gerade verschoben
        self.ok_down = None            # Zeitpunkt, seit dem OK gedrückt gehalten wird
        self.running = None            # gestarteter Dienst, solange der Player läuft
        self.started = 0.0
        self.refresh_apps()

        self.key.connect(self.handle)
        self.bgDone.connect(lambda done: (done(), self.push()))
        QTimer(self, interval=1000, timeout=self.tick).start()
        self.push()

    # ---------- Zustand für QML ----------

    @pyqtProperty(str, notify=stateChanged)
    def state(self):
        return self._state

    def width(self):
        return self.window.width() if self.window else 1920

    def height(self):
        return self.window.height() if self.window else 1080

    def push(self):
        """Schnappschuss des Zustands an QML geben (nur wenn sich etwas geändert hat)."""
        s = self.settings
        menu = self.menu and {"title": self.menu.get("title", ""), "items": [label for label, _ in self.menu["items"]],
                              "index": self.menu["index"], "anchor": self.menu.get("anchor", "tile"),
                              "at": self.menu.get("at", self.col)}
        dialog = self.dialog and {"text": self.dialog["text"], "sub": self.dialog.get("sub", ""),
                                  "buttons": [label for label, _ in self.dialog["buttons"]],
                                  "index": self.dialog["index"],
                                  "app": self.info[self.dialog["app"]["id"]] if self.dialog.get("app") else None}
        state = {
            "view": self.view, "row": self.row, "col": self.col, "storeCol": self.store_col,
            "headCol": self.head_col, "moving": self.moving, "wifiName": self.wifi_name,
            "remote": {"name": self.remote_name, "battery": self.remote_battery, "low": self.battery_low(),
                       "connected": bool(self.remote_input and self.remote_input.open)} if self.remote_name else None,
            "animations": s["animations"], "clock24": s["clock_24h"], "tileScale": cfg.TILE_SIZES[s["tile_size"]],
            "account": self.account_info(self.account),
            "apps": [self.info[a["id"]] for a in self.apps],
            "store": [self.info[a["id"]] for a in self.store],
            "allApps": [self.info[a["id"]] for a in self.all_apps],
            "hero": self.focused_app()["id"],
            "menu": menu, "dialog": dialog, "jf": self.jf_state(), "vol": self.vol,
            "saver": self.saver, "sleep": self.sleep_left(), "toast": self.toast, "phone": self.phone_pair,
            "covered": bool(self.running and time.monotonic() - self.started > COVERED_AFTER),
            "settings": {"cats": [{k: c[k] for k in ("label", "icon", "desc")} for c in self.cats],
                         "cat": self.cat, "pane": self.pane, "item": self.item, "sub": self.sub_info(),
                         "items": [self.item_info(it) for it in self.items]},
            "profiles": {"list": [self.account_info(a) for a in self.acc_data["accounts"]], "prof": self.prof},
            "osk": dict({k: self.osk[k] for k in ("title", "value", "mode", "row", "col", "error", "shift", "hint")},
                        rows=self.osk_rows()) if self.osk else None,
        }
        text = json.dumps(state, ensure_ascii=False)
        if text != self._state:
            self._state = text
            self.stateChanged.emit()

    @staticmethod
    def account_info(account):
        return {"id": account["id"], "name": account["name"], "color": account["color"],
                "initial": account["name"][:1].upper(), "pin": bool(account.get("pin"))}

    @staticmethod
    def item_info(item):
        kind = item["kind"]
        info = {"kind": kind, "label": item["label"], "hint": item.get("hint")}
        if kind == "toggle":
            info["on"] = bool(item["value"]())
        elif kind in ("choice", "range"):
            info["value"] = str(item["value"]())
        elif kind == "info":
            info["value"] = str(item["value"])
        return info

    # ---------- Apps ----------

    def refresh_apps(self):
        """Installierte und verfügbare Apps neu bestimmen (nach Änderungen in den Einstellungen)."""
        known = set(self.settings["known"])
        new = [a["id"] for a in self.all_apps if a["id"] not in known]
        if new:  # neue Apps im Katalog: Store-Apps erst einmal nicht installieren
            self.settings["hidden"] = sorted(set(self.settings["hidden"]) | {
                a["id"] for a in self.all_apps if a["id"] in new and a.get("store")})
            self.settings["known"] = sorted(known | set(new))
            self.save_settings()
        hidden = set(self.settings["hidden"])
        order = {app_id: i for i, app_id in enumerate(self.settings["order"])}
        ordered = sorted(self.all_apps, key=lambda a: order.get(a["id"], len(order) + self.all_apps.index(a)))
        self.apps = [a for a in ordered if a["id"] not in hidden] or ordered[:1]
        self.store = [a for a in self.all_apps if a not in self.apps]
        self.col = min(self.col, len(self.apps) - 1)
        self.store_col = min(self.store_col, max(len(self.store) - 1, 0))
        if self.row == STORE and not self.store:
            self.row = APPS

    def focused_app(self):
        """App, die gerade im Banner gezeigt wird (gewählte Kachel der Startseite oder des Stores)."""
        if self.row == STORE and self.store:
            return self.store[self.store_col]
        return self.apps[self.col]

    # ---------- Eingabe ----------

    def key_press(self, event):
        if self.activity():  # Taste weckt nur den Bildschirm auf
            self.push()
            return
        if self.osk_type(event):  # echte Tastatur tippt in die Bildschirmtastatur
            self.push()
            return
        key = KEYMAP.get(event.key())
        if key == "ok" and self.long_press_possible():
            if not event.isAutoRepeat() and self.ok_down is None:
                self.ok_down = time.monotonic()
                QTimer.singleShot(int(LONG_PRESS * 1000), self.check_long_press)
            return
        if key and not (key == "ok" and event.isAutoRepeat()):
            self.handle(key)

    def key_release(self, event):
        if KEYMAP.get(event.key()) != "ok" or event.isAutoRepeat() or self.ok_down is None:
            return
        self.ok_down = None  # kurz gedrückt: normales OK
        self.handle("ok")

    def long_press_possible(self):
        """Langes Drücken gibt es nur auf einer Kachel der Startseite und in „Wer schaut?“."""
        return (not self.running and not self.dialog and not self.menu and not self.moving and not self.osk
                and (self.view == "home" and self.row == APPS or self.view == "profiles"))

    def check_long_press(self):
        if self.ok_down is not None and time.monotonic() - self.ok_down >= LONG_PRESS - 0.05:
            self.ok_down = None
            self.handle("menu")

    def handle(self, key):
        if key in ("volumeup", "volumedown", "mute"):  # z. B. über POST /key (CEC, Handy)
            threading.Thread(target=self.remote_extra, args=(key,), daemon=True).start()
            return
        if self.activity():  # Taste weckt nur den Bildschirm auf
            self.push()
            return
        if self.running:
            if key == "home":  # alle anderen Tasten gehören der Seite im Player
                self.go_home()
        elif self.phone_pair:
            if key in ("back", "ok", "home"):
                self.close_phone_pair()
        elif self.dialog:
            self.dialog_key(key)
        elif self.osk:
            self.osk_key(key)
        elif self.menu:
            self.menu_key(key)
        elif self.moving:
            self.move_key(key)
        elif self.view == "profiles":
            self.profiles_key(key)
        elif self.view == "jellyfin":
            self.jellyfin_key(key)
        elif key == "menu":
            if self.view == "home" and self.row == APPS:
                self.open_menu()
        elif self.view == "settings":
            self.settings_key(key)
        elif key in ("left", "right") and self.row == APPS:
            step = -1 if key == "left" else 1
            self.col = min(max(self.col + step, 0), len(self.apps) - 1)
        elif key in ("left", "right") and self.row == STORE:
            step = -1 if key == "left" else 1
            self.store_col = min(max(self.store_col + step, 0), len(self.store) - 1)
        elif key in ("left", "right"):  # Kopfzeile: Konto | Einstellungen
            self.head_col = 0 if key == "left" else 1
        elif key == "up":
            self.row = max(self.row - 1, HEADER)
        elif key == "down":
            self.row = STORE if self.row == APPS and self.store else APPS
        elif key == "ok":
            if self.row == APPS:
                self.launch(self.apps[self.col])
            elif self.row == STORE:
                self.ask_install(self.store[self.store_col])
            elif self.head_col == 0:
                self.open_profiles()
            else:
                self.open_settings()
        self.push()

    def dialog_key(self, key):
        buttons = self.dialog["buttons"]
        if key in ("back", "home"):
            cancel = self.dialog.get("cancel")
            self.dialog = None
            if cancel:
                cancel()
        elif key in ("left", "right") and buttons:
            step = -1 if key == "left" else 1
            self.dialog["index"] = min(max(self.dialog["index"] + step, 0), len(buttons) - 1)
        elif key == "ok" and buttons:
            buttons[self.dialog["index"]][1]()

    # ---------- Kachel-Menü und Verschieben ----------

    def open_menu(self):
        app = self.apps[self.col]
        items = [("Öffnen", lambda: self.launch(app)), ("Verschieben", self.start_moving)]
        if len(self.apps) > 1:
            items.append(("Deinstallieren", lambda: self.ask_uninstall(app)))
        self.menu = {"items": items, "index": 0, "title": app["name"], "anchor": "tile", "at": self.col}

    def menu_key(self, key):
        items = self.menu["items"]
        if key in ("back", "home", "menu"):
            self.menu = None
        elif key in ("up", "down"):
            step = -1 if key == "up" else 1
            self.menu["index"] = min(max(self.menu["index"] + step, 0), len(items) - 1)
        elif key == "ok":
            run = items[self.menu["index"]][1]
            self.menu = None
            run()

    def start_moving(self):
        self.moving = True

    def move_key(self, key):
        if key in ("left", "right"):
            j = self.col + (-1 if key == "left" else 1)
            if 0 <= j < len(self.apps):
                a = self.apps
                a[self.col], a[j] = a[j], a[self.col]
                self.col = j
        elif key in ("ok", "back", "home", "menu", "up", "down"):
            self.moving = False
            self.save_order()

    def save_order(self):
        """Reihenfolge merken: sichtbare Apps wie angeordnet, ausgeblendete an ihrem alten Platz."""
        visible = iter(self.apps)
        shown_ids = {a["id"] for a in self.apps}
        order = {app_id: i for i, app_id in enumerate(self.settings["order"])}
        full = sorted(self.all_apps, key=lambda a: order.get(a["id"], len(order) + self.all_apps.index(a)))
        self.set("order", [next(visible)["id"] if a["id"] in shown_ids else a["id"] for a in full])

    # ---------- App-Store ----------

    def ask_install(self, app):
        self.dialog = {"text": f"{app['name']} installieren?", "index": 1,
                       "buttons": [("Abbrechen", self.close_dialog), ("Installieren", lambda: self.install(app))]}

    def install(self, app):
        """App aus dem Store auf die Startseite holen (hinten in „Deine Apps“)."""
        self.set("hidden", sorted(set(self.settings["hidden"]) - {app["id"]}))
        order = [i for i in self.settings["order"] if i != app["id"]] or [a["id"] for a in self.apps]
        self.set("order", order + [app["id"]])
        self.refresh_apps()
        self.refresh_settings_items()
        self.dialog = {"text": f"{app['name']} ist installiert", "index": 0,
                       "buttons": [("OK", self.close_dialog), ("Jetzt öffnen", lambda: self.open_installed(app))]}

    def open_installed(self, app):
        self.dialog = None
        self.view = "home"
        self.row, self.col = APPS, self.apps.index(app)
        self.launch(app)

    def ask_uninstall(self, app):
        self.confirm(f"{app['name']} deinstallieren?", "Deinstallieren", lambda: self.uninstall(app))

    def uninstall(self, app):
        """App von der Startseite entfernen; sie steht danach wieder unter „Verfügbare Apps“."""
        self.dialog = None
        hidden = set(self.settings["hidden"]) | {app["id"]}
        if len(hidden) < len(self.all_apps):
            self.set("hidden", sorted(hidden))
            self.refresh_apps()
            self.refresh_settings_items()

    def refresh_settings_items(self):
        """Nach Installieren/Deinstallieren die Liste in den Einstellungen neu aufbauen, Auswahl behalten."""
        if self.view != "settings":
            return
        cat, item = self.cat, self.item
        self.build_items()
        self.items = self.cats[cat]["items"]
        focusable = [i for i, it in enumerate(self.items) if it["kind"] in FOCUSABLE]
        self.item = min(focusable, key=lambda i: abs(i - item)) if focusable else 0

    # ---------- Dienste starten ----------

    def launch(self, app):
        if app["id"] == "jellyfin":  # eigene App in RaspiTV statt Webseite im Player
            return self.open_jellyfin()
        if app.get("server"):  # Adresse kommt aus den Einstellungen (z. B. eigener Jellyfin-Server)
            url = self.server_url(app["server"])
            if not url:
                self.dialog = {"text": f"Kein {app['name']}-Server im Netz gefunden",
                               "buttons": [("OK", self.close_dialog)], "index": 0}
                return
            app = dict(app, url=url)
        self.dialog = {"text": "wird gestartet …", "buttons": [], "index": 0, "app": app}
        try:
            self.player.launch(app, self.width(), self.height(), self.profile_path())
        except OSError:
            return self.launch_failed(app)
        self.running, self.started = app, time.monotonic()

    def launch_failed(self, app):
        self.running = None
        self.dialog = {
            "text": f"{app['name']} konnte nicht gestartet werden",
            "buttons": [("OK", self.close_dialog)], "index": 0,
        }

    def server_url(self, name, search=False):
        """Gespeicherte Serveradresse; fehlt sie oder antwortet der Server nicht, im Netz suchen."""
        url = self.settings.get(name)
        if search or not url or not cfg.reachable(url):
            found = cfg.discover_jellyfin()
            if found:
                self.set(name, found)
                url = found
        return url

    def show_now(self):
        """Zustand sofort zeichnen, bevor eine lange Aktion die Oberfläche blockiert."""
        self.push()
        QGuiApplication.processEvents()

    def run_update(self):
        """Neueste Version von GitHub holen; wenn es eine gibt, RaspiTV damit neu starten."""
        self.dialog = {"text": "Suche nach Updates …", "buttons": [], "index": 0}
        self.show_now()
        changed, message = cfg.update()
        if not changed:
            self.dialog = {"text": message, "buttons": [("OK", self.close_dialog)], "index": 0}
            return
        self.dialog = {"text": f"{message} – RaspiTV startet neu …", "buttons": [], "index": 0}
        self.show_now()
        self.player.stop()
        # Prozess durch die neue Version ersetzen (Port 8765 wird dabei freigegeben)
        os.execv(sys.executable, [sys.executable, str(ROOT / "raspitv.py")])

    def activate_window(self):
        if self.window:
            self.window.requestActivate()

    def go_home(self):
        self.player.stop()
        self.running = self.dialog = None
        self.activate_window()

    def close_dialog(self):
        self.dialog = None

    def confirm(self, question, label, action):
        self.dialog = {"text": question, "buttons": [("Abbrechen", self.close_dialog), (label, action)], "index": 0}

    def system(self, label, verb):
        """Neu starten / Ausschalten. Scheitert es (z. B. fehlt die Freigabe aus install.sh, dann will das
        System ein Passwort), eine Meldung zeigen statt still nichts zu tun."""
        def run():
            self.dialog = {"text": f"{label} …", "buttons": [], "index": 0}

            def work():
                try:
                    r = subprocess.run(["systemctl", verb, "--no-ask-password"], capture_output=True, text=True, timeout=20)
                    return r.returncode, (r.stderr or r.stdout).strip()
                except (OSError, subprocess.SubprocessError) as error:
                    return 1, str(error)

            def done(result):
                code, out = result
                if code != 0:
                    print(f"systemctl {verb}: {out}", flush=True)
                    self.notice(f"{label} ging nicht", None)
                    self.dialog["sub"] = ("Es fehlt die Freigabe – einmal im Terminal ausführen: "
                                          "sudo ~/raspitv/boot/install-power-rule.sh")
            self.run_bg(work, done)
        self.confirm(f"{label}?", label, run)

    def tick(self):
        """Sekundentakt: merken, wenn der Player beendet wurde (die Uhr läuft in QML selbst)."""
        if self.running and not self.player.running():
            app, quick = self.running, time.monotonic() - self.started < 3
            self.running = self.dialog = None
            if quick:
                self.launch_failed(app)
            self.activate_window()
        if self.ticks % 15 == 0 and not self.running:
            self.update_wifi_name()
        if self.rate_restore and not self.player.running() and not self.mpv.running():
            self.restore_rate()
        now = time.monotonic()
        self.check_sleep(now)
        self.check_saver(now)
        if self.toast and now > self.toast_until:
            self.toast = None
        self.ticks += 1
        self.push()  # u. a. „covered“: Lade-Animation anhalten, sobald der Player vorne liegt

    def update_wifi_name(self):
        def done(result):
            self.wifi_name, remotes = result
            self.set_remotes(remotes)
        self.run_bg(lambda: (network.wifi_current(), network.bt_remotes()), done)

    def set_remotes(self, remotes):
        self.remote_name = remotes[0]["name"] if remotes else ""
        self.remote_macs = [r["mac"] for r in remotes]
        battery = remotes[0].get("battery") if remotes else None
        if battery is not None:  # getrennt: letzten Stand behalten
            self.remote_battery = battery
        if self.battery_low() and not self.battery_warned:
            self.battery_warned = True
            self.show_toast(f"Akku der Fernbedienung fast leer ({self.remote_battery} %)", 8)
        elif self.remote_battery is not None and self.remote_battery > 30:
            self.battery_warned = False  # neue Batterien: später wieder warnen

    def battery_low(self):
        return self.remote_battery is not None and self.remote_battery <= 15

    def bt_busy(self):
        """Läuft in den Einstellungen gerade eine Bluetooth-Suche oder Kopplung?"""
        return self.bt["scanning"] or time.monotonic() < self.pairing_until

    def bt_allow(self):
        """Darf der Bluetooth-Agent eine Kopplung annehmen? Nur auf der Bluetooth-Seite bzw. beim Koppeln."""
        return self.sub == "bt" or time.monotonic() < self.pairing_until

    def remote_extra(self, key):
        """Tasten der Fernbedienung, die RaspiTV selbst erledigt (aus dem Lese-Thread)."""
        self.bgDone.emit(self.activity)  # Lautstärke usw. zählen auch als Tastendruck
        if key in ("volumeup", "volumedown", "mute"):
            volume, muted = cfg.volume_key(key)
            if volume is not None:
                self.show_volume(volume, muted)
        elif key == "playpause":
            if self.mpv.running():
                self.mpv.key("playpause")
            else:
                remote.press("playpause")

    def show_volume(self, volume, muted):
        """Lautstärke-Anzeige dort zeigen, wo man gerade ist (aus jedem Thread aufrufbar):
        im Jellyfin-Player (mpv), in Netflix & Co. (TV-Erweiterung) und in RaspiTV selbst."""
        if self.mpv.running():
            self.mpv.show_volume(volume, muted)
        if self.player.running():
            remote.notify(f"volume:{volume}:{int(muted)}")

        def update():
            self.volume = volume  # Lautstärke-Zeile in den Einstellungen zieht mit
            self.vol = {"value": volume, "muted": muted, "seq": self.vol["seq"] + 1}
        self.bgDone.emit(update)

    # ---------- Ruhezustand: Sleep-Timer, Bildschirmschoner, Bildschirm aus ----------

    def activity(self):
        """Eine Taste wurde gedrückt. Weckt den Bildschirm (dann True: die Taste ist damit verbraucht)
        und verlängert den Sleep-Timer, wenn er gerade warnt."""
        self.last_input = time.monotonic()
        if self.sleep_warned:
            self.sleep_at = time.monotonic() + 15 * 60
            self.sleep_warned = False
            self.show_toast("Sleep-Timer um 15 Minuten verlängert")
        if not self.saver:
            return False
        if self.saver == "off":
            threading.Thread(target=cfg.screen_power, args=(True,), daemon=True).start()
        self.saver = None
        return True

    def remote_connected(self):
        """Fernbedienung hat sich wieder verbunden – das war ein Tastendruck (siehe remote_input)."""
        if self.activity():
            self.push()

    def sleep_left(self):
        """Verbleibende Minuten des Sleep-Timers (aufgerundet), 0 = aus."""
        if not self.sleep_at:
            return 0
        return max(1, -int(-(self.sleep_at - time.monotonic()) // 60))

    def set_sleep(self, step):
        times = cfg.SLEEP_TIMES
        self.sleep_min = times[(times.index(self.sleep_min) + step) % len(times)]
        self.sleep_at = time.monotonic() + self.sleep_min * 60 if self.sleep_min else None
        self.sleep_warned = False

    def check_sleep(self, now):
        if not self.sleep_at:
            return
        left = self.sleep_at - now
        if left <= 0:
            self.sleep_now()
        elif left <= 60 and not self.sleep_warned:
            self.sleep_warned = True
            self.show_toast("Sleep-Timer: Gleich geht RaspiTV schlafen – Taste drücken für 15 Minuten mehr", 60)

    def sleep_now(self):
        """Sleep-Timer abgelaufen: Wiedergabe beenden, zur Startseite, Bildschirm aus."""
        self.sleep_min, self.sleep_at, self.sleep_warned = 0, None, False
        self.hide_toast()
        if self.mpv.running():
            self.mpv.stop()
        if self.running:
            self.go_home()
        self.dialog = self.menu = None
        self.screen_off()

    def show_saver(self):
        self.last_input = time.monotonic()
        self.saver = "clock"

    def check_saver(self, now):
        if self.running or self.mpv.running():  # beim Schauen nie
            self.last_input = now
            return
        idle = now - self.last_input
        saver, off = self.settings["saver_min"], self.settings["screen_off_min"]
        if off and idle >= off * 60:
            if self.saver != "off":
                self.screen_off()
        elif saver and idle >= saver * 60 and not self.saver:
            self.saver = "clock"

    def screen_off(self):
        self.saver = "off"
        QTimer.singleShot(1300, lambda: self.saver == "off" and threading.Thread(
            target=cfg.screen_power, args=(False,), daemon=True).start())  # erst schwarz einblenden

    def show_toast(self, text, seconds=4):
        """Hinweis oben einblenden – in RaspiTV, im Jellyfin-Player und in Netflix & Co."""
        self.toast = {"text": text, "seq": (self.toast or {}).get("seq", 0) + 1}
        self.toast_until = time.monotonic() + seconds
        if self.player.running():
            remote.notify(f"toast:{seconds}:{text}")
        if self.mpv.running():
            self.mpv.show_toast(text, seconds)

    def hide_toast(self):
        self.toast = None
        if self.player.running():
            remote.notify("toast:0:")
        if self.mpv.running():
            self.mpv.show_toast("")

    # ---------- Handy als Fernbedienung ----------

    def set_phone_remote(self, on):
        self.set("phone_remote", on)
        if not on:
            self.phone.stop()
        elif not self.phone.start():
            self.notice("Handy-Fernbedienung ließ sich nicht starten", None)
            self.dialog["sub"] = f"Port {phone.PORT} ist belegt"

    def open_phone_pair(self):
        if not self.settings["phone_remote"]:
            self.set_phone_remote(True)
        if not self.phone.running():
            return
        url = f"http://{cfg.ip_address()}:{phone.PORT}"
        matrix = phone.qr_matrix(url)
        self.phone_pair = {"url": url, "code": self.phone.new_code(),
                           "qr": ["".join("1" if c else "0" for c in row) for row in matrix] if matrix else []}
        self.phone.on_paired = lambda: self.bgDone.emit(self.phone_paired)

    def close_phone_pair(self):
        self.phone_pair = None
        self.phone.code = self.phone.on_paired = None
        if self.view == "settings":
            self.build_items()
            self.items = self.cats[self.cat]["items"]

    def phone_paired(self):
        self.close_phone_pair()
        self.show_toast("Handy verbunden – es ist jetzt eine Fernbedienung")
        if self.osk:  # über die Handy-Taste der Bildschirmtastatur gekoppelt: gleich dort weitertippen
            self.osk_phone()

    def osk_phone(self):
        """Handy-Taste der Bildschirmtastatur: Text auf dem Handy eingeben. Ohne gekoppeltes Handy erst koppeln
        (die Tastatur bleibt dahinter offen und bekommt danach den Text vom Handy)."""
        if not self.settings["phone_tokens"] or not self.phone.running():
            self.open_phone_pair()
            return
        self.osk["hint"] = f"Jetzt auf dem Handy tippen – Handy-Fernbedienung: {cfg.ip_address()}:{phone.PORT}"

    def add_phone_token(self, token):
        """Aus dem Server-Thread: sofort gültig, gespeichert wird im Hauptthread."""
        self.settings["phone_tokens"] = (self.settings["phone_tokens"] + [token])[-phone.MAX_TOKENS:]
        self.bgDone.emit(self.save_settings)

    def forget_phones(self):
        self.set("phone_tokens", [])
        self.build_items()
        self.items = self.cats[self.cat]["items"]
        self.notice("Alle Handys entfernt", None)
        self.dialog["sub"] = "Zum erneuten Verbinden „Handy verbinden“ wählen"

    def phone_state(self):
        """Für die Handy-Seite (Server-Thread): ist gerade ein Textfeld offen?"""
        osk, running = self.osk, self.running
        return {"typing": bool(osk), "title": osk["title"] if osk else "",
                "app": running["name"] if running else "Jellyfin" if self.view == "jellyfin" else ""}

    def phone_text(self, text, submit):
        """Text vom Handy: in die Bildschirmtastatur von RaspiTV bzw. in das Textfeld der Seite im Player."""
        text = text.replace("\n", " ").replace("\r", "")
        o = self.osk
        if o:
            if o["mode"] == "pin":
                text = "".join(c for c in text if c.isdigit())
            o["value"] = text[:MAX_LEN[o["mode"]]]
            o["error"] = ""
            if submit or (o["mode"] == "pin" and len(o["value"]) == PIN_LEN):
                o["done"](o["value"])
        elif self.player.running():
            remote.notify(f"text:{int(submit)}:{text}")

    # ---------- Einstellungen ----------

    def open_settings(self):
        self.view = "settings"
        self.volume = cfg.get_volume()
        self.outputs = cfg.audio_outputs()
        self.modes = cfg.display_modes()
        self.build_items()
        self.pane, self.cat = "cats", 0
        self.select_cat(0)

    def close_settings(self):
        self.view = "home"

    # ---------- Audio-Ausgang ----------

    # ---------- Auflösung ----------

    def choose_mode(self, mode):
        """Auflösung umschalten. Danach „Bild in Ordnung?“ – ohne Antwort nach 15 s zurück (falls der
        Fernseher die Auflösung nicht zeigt, sieht man die Frage ja nicht)."""
        if mode["current"]:
            return
        before = cfg.current_display_mode()

        def work():
            return cfg.set_display_mode(mode["output"], mode["mode"])

        def done(ok):
            self.refresh_modes()
            if not ok:
                self.notice("Diese Auflösung ging nicht")
                return
            token = object()
            self.mode_pending = token

            def keep():
                self.mode_pending = None
                self.set("display_mode", mode["mode"])
                self.base_mode = (mode["output"], mode["mode"])
                self.close_dialog()

            def revert():
                if self.mode_pending is not token:
                    return
                self.mode_pending = None
                self.busy("Stelle die vorige Auflösung wieder her …")
                self.run_bg(lambda: before[0] and cfg.set_display_mode(*before), lambda _: (self.refresh_modes(), self.close_dialog()))

            self.dialog = {"text": "Bild in Ordnung?", "sub": "Ohne Antwort geht es in 15 Sekunden zurück",
                           "buttons": [("Behalten", keep), ("Zurück", revert)], "index": 0}
            QTimer.singleShot(15000, revert)
        self.busy(f"Stelle {mode['label']} ein …")
        self.run_bg(work, done)

    def video_rate(self, fps):
        """Ein Video läuft mit `fps` Bildern/s (aus jedem Thread): Fernseher auf eine passende Bildrate
        schalten (25 → 50 Hz, 24 → 24 Hz …), damit jedes Bild gleich lang steht. Zurück, wenn das Video endet."""
        if fps <= 0:  # Video vorbei (Player verlassen, die App läuft weiter)
            self.bgDone.emit(self.restore_rate)
            return

        def apply():
            with self.rate_lock:
                if not self.settings["match_rate"] or not (self.player.running() or self.mpv.running()):
                    return
                target = cfg.mode_for_rate(fps)
                current = cfg.current_display_mode()
                if not target or target[1] == current[1]:
                    return
                if self.base_mode is None:
                    self.base_mode = current
                self.rate_restore = self.base_mode
                cfg.set_display_mode(*target)
        threading.Thread(target=apply, daemon=True).start()

    def restore_rate(self):
        """Nach dem Video: zurück zur Grund-Bildrate (die beim Start bzw. die gewählte – nie eine angepasste)."""
        if not self.rate_restore:
            return
        self.rate_restore = None

        def work():
            with self.rate_lock:
                base = self.base_mode
                if base and base[0] and cfg.current_display_mode()[1] != base[1]:
                    cfg.set_display_mode(*base)
        threading.Thread(target=work, daemon=True).start()

    def refresh_modes(self):
        self.modes = cfg.display_modes()
        if self.view != "settings" or self.sub:
            return
        label = self.items[self.item]["label"] if self.items else None
        self.build_items()
        self.items = self.cats[self.cat]["items"]
        self.item = next((i for i, it in enumerate(self.items) if it["label"] == label and it["kind"] in FOCUSABLE),
                         min(self.item, len(self.items) - 1))

    def choose_output(self, out):
        """Ausgang in den Einstellungen gewählt: umschalten, merken, Testton, Lautstärke des Ausgangs zeigen."""
        self.set("audio_output", out["name"])

        def work():
            cfg.set_audio_output(out["id"])
            return cfg.audio_outputs(), cfg.get_audio()

        def done(result):
            self.outputs, (volume, muted) = result
            self.refresh_sound()
            if volume is not None:
                self.show_volume(volume, muted)
        self.run_bg(work, done)

    def refresh_sound(self):
        """Ton-Seite neu aufbauen (falls offen), Auswahl in der Liste behalten."""
        self.volume = cfg.get_volume()
        if self.view != "settings" or self.sub or self.cats[self.cat]["label"] != "Ton":
            return
        label = self.items[self.item]["label"] if self.items else None
        self.build_items()
        self.items = self.cats[self.cat]["items"]
        self.item = next((i for i, it in enumerate(self.items) if it["label"] == label and it["kind"] in FOCUSABLE),
                         min(self.item, len(self.items) - 1))

    def watch_audio(self):
        """Hintergrund: neue Bluetooth-/USB-Geräte (Kopfhörer, Lautsprecher) automatisch verwenden und
        zum selbst gewählten Ausgang zurückkehren, wenn so ein Gerät wieder weg ist."""
        known = {o["name"] for o in cfg.audio_outputs()}
        while True:
            time.sleep(2)
            outputs = cfg.audio_outputs()
            names = {o["name"] for o in outputs}
            if not outputs or names == known:
                continue
            new = [o for o in outputs if o["name"] not in known and o["kind"] in ("Bluetooth", "USB")]
            gone = known - names
            known = names
            target = None
            if new and self.settings["audio_auto"]:
                target = new[0]
            elif gone and not any(o["active"] for o in outputs if o["kind"] in ("Bluetooth", "USB")):
                target = next((o for o in outputs if o["name"] == self.settings["audio_output"]), None)
            if target and not target["active"]:
                cfg.set_audio_output(target["id"], sound=False)
                outputs = cfg.audio_outputs()
            volume, muted = cfg.get_audio()

            def update(outputs=outputs):
                self.outputs = outputs
                self.refresh_sound()
            self.bgDone.emit(update)
            if target and volume is not None:
                self.show_volume(volume, muted)  # zeigt, dass (und wie laut) jetzt dort Ton kommt

    def select_cat(self, index):
        """Kategorie wählen: rechts deren Zeilen zeigen, oben beginnen."""
        self.cat = index
        self.sub = None
        self.items = self.cats[index]["items"]
        self.item = next((i for i, it in enumerate(self.items) if it["kind"] in FOCUSABLE), 0)

    def set(self, name, value):
        self.settings[name] = value
        self.save_settings()

    def build_items(self):
        s = self.settings
        sizes = list(cfg.TILE_SIZES)

        def cycle_size(step):
            self.set("tile_size", sizes[(sizes.index(s["tile_size"]) + step) % len(sizes)])

        def cycle(name, times, step):
            value = s[name] if s[name] in times else times[0]
            self.set(name, times[(times.index(value) + step) % len(times)])
            self.last_input = time.monotonic()

        def minutes(value, zero):
            return zero if not value else f"{value // 60} Std" if value % 60 == 0 else f"{value} Min"

        def volume(step):
            cfg.change_volume(5 * step)
            self.volume = cfg.get_volume()

        apps = []
        for app in self.apps:
            apps.append({"kind": "action", "label": app["name"], "hint": "Deinstallieren" if len(self.apps) > 1 else "",
                         "run": (lambda app=app: self.ask_uninstall(app)) if len(self.apps) > 1 else (lambda: None)})
        sound = ([{"kind": "range", "label": "Lautstärke", "value": lambda: f"{self.volume} %", "change": volume}]
                 if self.volume is not None else [{"kind": "info", "label": "Lautstärke", "value": "kein Audiogerät gefunden"}])
        outputs = self.outputs
        if outputs:
            sound.append({"kind": "header", "label": "Ton ausgeben über"})
            for out in outputs:
                sound.append({"kind": "action", "label": out["label"],
                              "hint": "✓  Aktiv" if out["active"] else out["kind"] or "Auswählen",
                              "run": lambda out=out: self.choose_output(out)})
            sound.append({"kind": "toggle", "label": "Neue Geräte automatisch verwenden",
                          "value": lambda: s["audio_auto"],
                          "change": lambda step: self.set("audio_auto", not s["audio_auto"])})
            sound.append({"kind": "action", "label": "Testton abspielen", "hint": "", "run": cfg.play_test_sound})

        display = []
        if getattr(self, "modes", None):
            display.append({"kind": "header", "label": "Auflösung"})
            display.append({"kind": "toggle", "label": "Bildrate an Videos anpassen",
                            "value": lambda: s["match_rate"],
                            "change": lambda step: self.set("match_rate", not s["match_rate"])})
            for mode in self.modes:
                hint = ("✓  " if mode["current"] else "") + (mode["note"] or ("Aktiv" if mode["current"] else ""))
                display.append({"kind": "action", "label": mode["label"], "hint": hint.strip(),
                                "run": lambda mode=mode: self.choose_mode(mode)})
        model = cfg.pi_model().split(" Rev ")[0].replace(" Model B", "")

        self.cats = [
            {"label": "Konto", "icon": "account", "desc": "Wer gerade schaut und eigene Logins",
             "items": [
                 {"kind": "info", "label": "Aktives Konto", "value": self.account["name"]},
                 {"kind": "action", "label": "Konto wechseln", "run": self.open_profiles},
             ]},
            {"label": "Darstellung", "icon": "display", "desc": f"Aussehen und Auflösung – Empfehlung passend zum {model}" if model else "Aussehen und Auflösung",
             "items": [
                 {"kind": "choice", "label": "Kachelgröße", "value": lambda: s["tile_size"].capitalize(), "change": cycle_size},
                 {"kind": "choice", "label": "Uhrzeit", "value": lambda: "24 Stunden" if s["clock_24h"] else "12 Stunden",
                  "change": lambda step: self.set("clock_24h", not s["clock_24h"])},
                 {"kind": "toggle", "label": "Animationen", "value": lambda: s["animations"],
                  "change": lambda step: self.set("animations", not s["animations"])},
             ] + display},
            {"label": "Apps", "icon": "apps", "desc": "Installierte Apps löschen – neue gibt es unter „Verfügbare Apps“",
             "items": apps},
            {"label": "Ton", "icon": "sound", "desc": "Lautstärke und Ausgang: HDMI, Klinke, Bluetooth", "items": sound},
            {"label": "Ruhezustand", "icon": "moon", "desc": "Sleep-Timer, Bildschirmschoner und Bildschirm aus",
             "items": [
                 {"kind": "choice", "label": "Sleep-Timer",
                  "value": lambda: f"noch {self.sleep_left()} Min" if self.sleep_at else "Aus",
                  "change": self.set_sleep},
                 {"kind": "header", "label": "Wenn keine Taste gedrückt wird"},
                 {"kind": "choice", "label": "Bildschirmschoner nach",
                  "value": lambda: minutes(s["saver_min"], "Aus"),
                  "change": lambda step: cycle("saver_min", cfg.SAVER_TIMES, step)},
                 {"kind": "choice", "label": "Bildschirm ausschalten nach",
                  "value": lambda: minutes(s["screen_off_min"], "Nie"),
                  "change": lambda step: cycle("screen_off_min", cfg.SCREEN_OFF_TIMES, step)},
                 {"kind": "action", "label": "Bildschirmschoner jetzt zeigen", "run": self.show_saver},
             ]},
            {"label": "System", "icon": "power", "desc": "Netzwerk, Start, Updates und Ausschalten",
             "items": [
                 {"kind": "header", "label": "Verbindungen"},
                 {"kind": "action", "label": "WLAN", "hint": network.wifi_current() or
                  ("nicht verbunden" if network.wifi_enabled() else "aus"), "run": lambda: self.open_sub("wifi")},
                 {"kind": "action", "label": "Bluetooth", "hint": self.bt_hint(), "run": lambda: self.open_sub("bt")},
                 {"kind": "header", "label": "Handy"},
                 {"kind": "toggle", "label": "Handy als Fernbedienung", "value": lambda: s["phone_remote"],
                  "change": lambda step: self.set_phone_remote(not s["phone_remote"])},
                 {"kind": "action", "label": "Handy verbinden", "hint": "QR-Code", "run": self.open_phone_pair},
                 {"kind": "action", "label": "Verbundene Handys entfernen",
                  "hint": f"{len(s['phone_tokens'])} verbunden" if s["phone_tokens"] else "keine",
                  "run": self.forget_phones},
                 {"kind": "header", "label": "Start und Updates"},
                 {"kind": "toggle", "label": "Beim Hochfahren starten", "value": cfg.autostart_enabled,
                  "change": lambda step: cfg.set_autostart(not cfg.autostart_enabled())},
                 {"kind": "action", "label": "Nach Updates suchen", "run": self.run_update},
                 {"kind": "header", "label": "Beenden"},
                 {"kind": "action", "label": "Zurück zum Desktop",
                  "run": lambda: self.confirm("RaspiTV beenden?", "Zum Desktop", QGuiApplication.quit)},
                 {"kind": "action", "label": "Neu starten", "run": lambda: self.system("Neu starten", "reboot")},
                 {"kind": "action", "label": "Ausschalten", "run": lambda: self.system("Ausschalten", "poweroff")},
             ]},
            {"label": "Info", "icon": "info", "desc": "Über dieses Gerät",
             "items": [
                 {"kind": "info", "label": "Version", "value": cfg.version()},
                 {"kind": "info", "label": "IP-Adresse", "value": cfg.ip_address()},
                 {"kind": "info", "label": "Auflösung", "value": f"{self.width()} × {self.height()}"},
                 {"kind": "info", "label": "Oberfläche", "value": "Qt Quick (Grafikeinheit)"},
             ]},
        ]

    def settings_key(self, key):
        if key == "home":
            return self.close_settings()
        if self.pane == "cats":
            if key == "back":
                self.close_settings()
            elif key in ("up", "down"):
                self.select_cat(min(max(self.cat + (-1 if key == "up" else 1), 0), len(self.cats) - 1))
            elif key in ("right", "ok") and any(it["kind"] in FOCUSABLE for it in self.items):
                self.pane = "items"
            return

        item = self.items[self.item]
        changes = item["kind"] in ("choice", "range")
        if (key == "back" or (key == "left" and not changes)) and self.sub:
            self.close_sub()
        elif key == "back" or (key == "left" and not changes):
            self.pane = "cats"
        elif key in ("up", "down"):
            step = -1 if key == "up" else 1
            i = self.item + step
            while 0 <= i < len(self.items) and self.items[i]["kind"] not in FOCUSABLE:
                i += step
            if 0 <= i < len(self.items):
                self.item = i
        elif item["kind"] == "action":
            if key == "ok":
                item["run"]()
        elif key in ("left", "right") and changes:
            item["change"](-1 if key == "left" else 1)
        elif key == "ok" and item["kind"] != "range":
            item["change"](1)

    # ---------- Hintergrund-Aufgaben ----------

    def run_bg(self, work, done):
        """`work()` in einem eigenen Thread ausführen, danach `done(ergebnis)` im Hauptthread."""
        def run():
            result = work()
            self.bgDone.emit(lambda: done(result))
        threading.Thread(target=run, daemon=True).start()

    def busy(self, text):
        self.dialog = {"text": text, "buttons": [], "index": 0}

    def notice(self, text, buttons=None):
        self.dialog = {"text": text, "buttons": buttons or [("OK", self.close_dialog)], "index": 0}

    # ---------- Einstellungen: Unterseiten WLAN und Bluetooth ----------

    SUBS = {"wifi": ("WLAN", "Netz wählen – OK verbindet, beim verbundenen Netz: vergessen"),
            "bt": ("Bluetooth", "Kopfhörer, Lautsprecher und Controller koppeln")}

    def sub_info(self):
        if not self.sub:
            return None
        title, desc = self.SUBS[self.sub]
        return {"title": title, "desc": desc}

    def open_sub(self, name):
        self.sub, self.sub_parent = name, self.item
        if name == "wifi":
            self.wifi.update(on=network.wifi_enabled(), nets=network.wifi_scan(rescan=False))
            self.scan_wifi()
        else:
            self.bt.update(on=network.bt_enabled(), paired=network.bt_paired(), found=[])
        self.rebuild_sub(first=True)

    def close_sub(self):
        self.sub = None
        self.build_items()
        self.items = self.cats[self.cat]["items"]
        self.item = self.sub_parent

    def rebuild_sub(self, first=False):
        """Zeilen der Unterseite neu aufbauen; Auswahl möglichst auf derselben Zeile lassen."""
        if not self.sub:
            return
        label = None if first or not self.items or self.item >= len(self.items) else self.items[self.item]["label"]
        self.items = self.wifi_items() if self.sub == "wifi" else self.bt_items()
        focusable = [i for i, it in enumerate(self.items) if it["kind"] in FOCUSABLE]
        same = [i for i in focusable if self.items[i]["label"] == label]
        self.item = (same or focusable or [0])[0] if first or same else min(
            focusable, key=lambda i: abs(i - self.item)) if focusable else 0

    # WLAN

    def wifi_items(self):
        w = self.wifi
        items = [{"kind": "toggle", "label": "WLAN", "value": lambda: w["on"], "change": lambda step: self.toggle_wifi()}]
        if not w["on"]:
            return items
        items.append({"kind": "header", "label": "Netze in Reichweite" + (" – suche …" if w["scanning"] else "")})
        for net in w["nets"]:
            hint = ("Verbunden · " if net["active"] else "") + network.signal_bars(net["signal"])
            hint += "" if net["secure"] else " · offen"
            items.append({"kind": "action", "label": net["ssid"], "hint": hint,
                          "run": lambda net=net: self.wifi_select(net)})
        if not w["nets"] and not w["scanning"]:
            items.append({"kind": "info", "label": "Keine Netze gefunden", "value": ""})
        items.append({"kind": "action", "label": "Neu suchen", "run": self.scan_wifi})
        return items

    def scan_wifi(self):
        if self.wifi["scanning"]:
            return
        self.wifi["scanning"] = True
        self.rebuild_sub()

        def done(nets):
            self.wifi.update(nets=nets, scanning=False)
            if self.sub == "wifi":
                self.rebuild_sub()
        self.run_bg(lambda: network.wifi_scan(rescan=True), done)

    def toggle_wifi(self):
        on = not self.wifi["on"]
        self.busy("WLAN wird eingeschaltet …" if on else "WLAN wird ausgeschaltet …")

        def done(result):
            ok, message = result
            if ok:
                self.dialog = None
            else:
                self.notice(message)
            self.wifi.update(on=network.wifi_enabled(), nets=[])
            self.wifi_name = network.wifi_current()
            self.rebuild_sub()
            if self.wifi["on"]:
                self.scan_wifi()
        self.run_bg(lambda: network.set_wifi(on), done)

    def wifi_select(self, net):
        if net["active"]:
            self.notice(f"Mit {net['ssid']} verbunden", [
                ("OK", self.close_dialog),
                ("Netz vergessen", lambda: self.confirm(f"{net['ssid']} vergessen? Das Passwort wird gelöscht.",
                                                        "Vergessen", lambda: self.wifi_forget(net)))])
        elif net["ssid"] in network.wifi_known() or not net["secure"]:
            self.wifi_connect(net, None)
        else:
            self.ask_wifi_password(net)

    def ask_wifi_password(self, net):
        def done(password):
            if len(password) < 8:
                self.osk["error"] = "WLAN-Passwörter haben mindestens 8 Zeichen"
                return
            self.osk = None
            self.wifi_connect(net, password)
        self.open_osk(f"Passwort für {net['ssid']}", "password", done)

    def wifi_connect(self, net, password):
        self.busy(f"Verbinde mit {net['ssid']} …")

        def done(result):
            ok, message = result
            if ok:
                self.notice(message)
            elif message == "Falsches Passwort":
                self.notice("Falsches Passwort", [("Abbrechen", self.close_dialog),
                                                  ("Nochmal", lambda: self.retry_password(net))])
            else:
                self.notice(f"Verbindung fehlgeschlagen: {message}")
            self.wifi["nets"] = network.wifi_scan(rescan=False)
            self.wifi_name = network.wifi_current()
            self.rebuild_sub()
        self.run_bg(lambda: network.wifi_connect(net["ssid"], password), done)

    def retry_password(self, net):
        self.dialog = None
        self.ask_wifi_password(net)

    def wifi_forget(self, net):
        ok, message = network.wifi_forget(net["ssid"])
        self.notice(message)
        self.wifi["nets"] = network.wifi_scan(rescan=False)
        self.wifi_name = network.wifi_current()
        self.rebuild_sub()

    # Bluetooth

    @staticmethod
    def bt_hint():
        if not network.bt_enabled():
            return "aus"
        connected = [d["name"] for d in network.bt_paired() if d["connected"]]
        return connected[0] if len(connected) == 1 else f"{len(connected)} verbunden" if connected else "an"

    def bt_items(self):
        b = self.bt
        items = [{"kind": "toggle", "label": "Bluetooth", "value": lambda: b["on"], "change": lambda step: self.toggle_bt()}]
        if not b["on"]:
            return items
        items.append({"kind": "header", "label": "Gekoppelte Geräte"})
        for dev in b["paired"]:
            items.append({"kind": "action", "label": dev["name"], "hint": "Verbunden" if dev["connected"] else "Getrennt",
                          "run": lambda dev=dev: self.bt_device_menu(dev)})
        if not b["paired"]:
            items.append({"kind": "info", "label": "Noch keine Geräte gekoppelt", "value": ""})
        items.append({"kind": "header", "label": "Neue Geräte" + (" – suche …" if b["scanning"] else "")})
        for dev in b["found"]:
            items.append({"kind": "action", "label": dev["name"], "hint": "Koppeln",
                          "run": lambda dev=dev: self.bt_pair(dev)})
        items.append({"kind": "action", "label": "Nach Geräten suchen", "hint": None if not b["scanning"] else "…",
                      "run": self.scan_bt})
        return items

    def refresh_bt(self):
        self.bt.update(on=network.bt_enabled(), paired=network.bt_paired())
        self.rebuild_sub()

    def toggle_bt(self):
        on = not self.bt["on"]
        self.busy("Bluetooth wird eingeschaltet …" if on else "Bluetooth wird ausgeschaltet …")

        def done(result):
            self.dialog = None
            self.bt["found"] = []
            self.refresh_bt()
            if on and not self.bt["on"]:
                self.notice("Bluetooth ließ sich nicht einschalten")
        self.run_bg(lambda: network.set_bluetooth(on), done)

    def scan_bt(self):
        if self.bt["scanning"]:
            return
        self.bt["scanning"] = True
        self.rebuild_sub()

        def done(found):
            self.bt.update(found=found, scanning=False)
            if self.sub == "bt":
                self.refresh_bt()
        self.run_bg(lambda: network.bt_scan(10), done)

    def bt_pair(self, dev):
        self.busy(f"Kopple {dev['name']} …")
        self.pairing_until = time.monotonic() + 90

        def done(result):
            ok, message = result
            self.pairing_until = time.monotonic() + 5
            self.notice(f"{dev['name']}: {message}")
            self.bt["found"] = [d for d in self.bt["found"] if d["mac"] != dev["mac"]] if ok else self.bt["found"]
            self.set_remotes(network.bt_remotes())
            self.refresh_bt()
        self.run_bg(lambda: network.bt_pair(dev["mac"]), done)

    def bt_device_menu(self, dev):
        def toggle():
            self.busy(("Trenne " if dev["connected"] else "Verbinde ") + dev["name"] + " …")

            def done(result):
                ok, message = result
                if ok:
                    self.dialog = None
                else:
                    self.notice(message)
                self.refresh_bt()
            self.run_bg(lambda: network.bt_toggle_connection(dev["mac"], dev["connected"]), done)

        def remove():
            ok, message = network.bt_remove(dev["mac"])
            self.set_remotes(network.bt_remotes())
            self.notice(message)
            self.refresh_bt()
        self.notice(dev["name"], [("Abbrechen", self.close_dialog),
                                  ("Trennen" if dev["connected"] else "Verbinden", toggle),
                                  ("Entfernen", remove)])


class View(QQuickView):
    """Vollbild-Fenster mit der QML-Oberfläche; Tasten gehen an die Logik."""

    def __init__(self, home):
        super().__init__()
        self.home = home
        self.setTitle("RaspiTV")
        self.setColor(QColor("#0e1013"))
        self.setResizeMode(QQuickView.SizeRootObjectToView)
        self.setCursor(Qt.BlankCursor)
        self.rootContext().setContextProperty("backend", home)
        self.setSource(QUrl.fromLocalFile(str(ROOT / "qml" / "Main.qml")))
        if self.status() == QQuickView.Error:
            sys.exit("\n".join(e.toString() for e in self.errors()))

    def keyPressEvent(self, event):
        self.home.key_press(event)

    def keyReleaseEvent(self, event):
        self.home.key_release(event)


def main():
    apps = json.loads((ROOT / "apps.json").read_text(encoding="utf-8"))
    QGuiApplication.setAttribute(Qt.AA_UseOpenGLES)
    app = QGuiApplication(sys.argv)
    app.setFont(QFont("Nunito Sans"))  # Systemschrift von Raspberry Pi OS; sonst Qt-Ersatzschrift
    player = Player()
    home = Home(apps, player)
    view = View(home)
    home.window = view

    def on_key(key):
        if key == "home":
            player.stop()  # sofort, auch wenn die Oberfläche gerade verdeckt ist
        home.key.emit(key)

    try:
        remote.start(on_key, player.running, home.video_rate)
    except OSError:
        sys.exit("RaspiTV läuft bereits (Port 8765 ist belegt).")
    # Bluetooth-Fernbedienungen direkt lesen (auch während der Player vorne liegt)
    home.set_remotes(network.bt_remotes())
    # gewählte Auflösung setzen (z. B. Full HD statt 4K mit 30 Hz, das der Fernseher von sich aus nimmt)
    def start_mode():
        cfg.apply_display_mode(home.settings["display_mode"])
        home.base_mode = cfg.current_display_mode()  # Grund-Bildrate für die Bildraten-Anpassung
    threading.Thread(target=start_mode, daemon=True).start()
    home.remote_input = remote_input.RemoteInput(remote.press, home.remote_extra, lambda: home.remote_macs,
                                                   lambda: home.bgDone.emit(home.remote_connected))
    # Kopplungsanfragen beantwortet RaspiTV selbst – kein Desktop-Fenster über der Oberfläche
    agent = network.BtAgent(home.bt_allow)
    # Schlafende Fernbedienung beim nächsten Tastendruck sofort wieder verbinden
    network.RemoteKeeper(lambda: home.remote_macs, home.bt_busy)
    # Handy als Fernbedienung (Webseite im Heimnetz)
    def phone_key(key):
        if key in ("volumeup", "volumedown", "mute", "playpause"):
            home.remote_extra(key)
        else:
            remote.press(key)  # wie eine Bluetooth-Fernbedienung: an RaspiTV und an die Seite im Player
    home.phone = phone.PhoneServer(phone_key, lambda text, submit: home.bgDone.emit(lambda: home.phone_text(text, submit)),
                                   home.phone_state, lambda: home.settings["phone_tokens"], home.add_phone_token)
    if home.settings["phone_remote"]:
        home.phone.start()
    app.aboutToQuit.connect(home.phone.stop)
    # Neue Bluetooth-/USB-Audiogeräte automatisch verwenden (Einstellungen → Ton)
    threading.Thread(target=home.watch_audio, daemon=True).start()

    app.aboutToQuit.connect(player.stop)
    app.aboutToQuit.connect(agent.stop)
    app.aboutToQuit.connect(home.mpv.stop)
    # Auch beim Beenden von außen (kill, Abmelden) den Player mit schließen
    signal.signal(signal.SIGTERM, lambda *_: app.quit())
    signal.signal(signal.SIGINT, lambda *_: app.quit())
    signal.signal(signal.SIGHUP, lambda *_: app.quit())  # Terminal wurde geschlossen
    QTimer(app, interval=200, timeout=lambda: None).start()  # Python-Signale auch während Qt läuft annehmen
    view.showFullScreen()

    # Startbild (splash.py) schließen, sobald das erste Bild der Oberfläche zu sehen ist
    def ready():
        view.frameSwapped.disconnect(ready)
        runtime = Path(os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}"))
        try:
            (runtime / "raspitv-ready").touch()
        except OSError:
            pass
    view.frameSwapped.connect(ready)
    # Autostart-Eintrag nach Updates auf den neuen Stand bringen (z. B. Startbild)
    if cfg.autostart_enabled():
        cfg.set_autostart(True)
    sys.exit(app.exec_())


if __name__ == "__main__":
    main()
