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
import remote
import settings as cfg
from profiles_ui import AccountsUI

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


class Home(AccountsUI, QObject):
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
        self.ticks = 0
        self.volume = None
        self.dialog = None             # {"text", "buttons": [(label, fn)], "index", "app"?}
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
        dialog = self.dialog and {"text": self.dialog["text"], "buttons": [label for label, _ in self.dialog["buttons"]],
                                  "index": self.dialog["index"],
                                  "app": self.info[self.dialog["app"]["id"]] if self.dialog.get("app") else None}
        state = {
            "view": self.view, "row": self.row, "col": self.col, "storeCol": self.store_col,
            "headCol": self.head_col, "moving": self.moving, "wifiName": self.wifi_name,
            "animations": s["animations"], "clock24": s["clock_24h"], "tileScale": cfg.TILE_SIZES[s["tile_size"]],
            "account": self.account_info(self.account),
            "apps": [self.info[a["id"]] for a in self.apps],
            "store": [self.info[a["id"]] for a in self.store],
            "allApps": [self.info[a["id"]] for a in self.all_apps],
            "hero": self.focused_app()["id"],
            "menu": menu, "dialog": dialog,
            "covered": bool(self.running and time.monotonic() - self.started > COVERED_AFTER),
            "settings": {"cats": [{k: c[k] for k in ("label", "icon", "desc")} for c in self.cats],
                         "cat": self.cat, "pane": self.pane, "item": self.item, "sub": self.sub_info(),
                         "items": [self.item_info(it) for it in self.items]},
            "profiles": {"list": [self.account_info(a) for a in self.acc_data["accounts"]], "prof": self.prof},
            "osk": dict({k: self.osk[k] for k in ("title", "value", "mode", "row", "col", "error", "shift")},
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
        if self.running:
            if key == "home":  # alle anderen Tasten gehören der Seite im Player
                self.go_home()
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
            self.dialog = None
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
        def run():
            self.dialog = {"text": f"{label} …", "buttons": [], "index": 0}
            subprocess.Popen(["systemctl", verb])
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
        self.ticks += 1
        self.push()  # u. a. „covered“: Lade-Animation anhalten, sobald der Player vorne liegt

    def update_wifi_name(self):
        def done(name):
            self.wifi_name = name
        self.run_bg(network.wifi_current, done)

    # ---------- Einstellungen ----------

    def open_settings(self):
        self.view = "settings"
        self.volume = cfg.get_volume()
        self.build_items()
        self.pane, self.cat = "cats", 0
        self.select_cat(0)

    def close_settings(self):
        self.view = "home"

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

        def volume(step):
            cfg.change_volume(5 * step)
            self.volume = cfg.get_volume()

        apps = []
        for app in self.apps:
            apps.append({"kind": "action", "label": app["name"], "hint": "Deinstallieren" if len(self.apps) > 1 else "",
                         "run": (lambda app=app: self.ask_uninstall(app)) if len(self.apps) > 1 else (lambda: None)})
        sound = ([{"kind": "range", "label": "Lautstärke", "value": lambda: f"{self.volume} %", "change": volume}]
                 if self.volume is not None else [{"kind": "info", "label": "Lautstärke", "value": "kein Audiogerät gefunden"}])

        self.cats = [
            {"label": "Konto", "icon": "account", "desc": "Wer gerade schaut und eigene Logins",
             "items": [
                 {"kind": "info", "label": "Aktives Konto", "value": self.account["name"]},
                 {"kind": "action", "label": "Konto wechseln", "run": self.open_profiles},
             ]},
            {"label": "Darstellung", "icon": "display", "desc": "Aussehen der Startseite",
             "items": [
                 {"kind": "choice", "label": "Kachelgröße", "value": lambda: s["tile_size"].capitalize(), "change": cycle_size},
                 {"kind": "choice", "label": "Uhrzeit", "value": lambda: "24 Stunden" if s["clock_24h"] else "12 Stunden",
                  "change": lambda step: self.set("clock_24h", not s["clock_24h"])},
                 {"kind": "toggle", "label": "Animationen", "value": lambda: s["animations"],
                  "change": lambda step: self.set("animations", not s["animations"])},
             ]},
            {"label": "Apps", "icon": "apps", "desc": "Installierte Apps löschen – neue gibt es unter „Verfügbare Apps“",
             "items": apps},
            {"label": "Jellyfin", "icon": "server", "desc": "Eigener Mediaserver im Heimnetz",
             "items": [
                 {"kind": "choice", "label": "Server (OK = neu suchen)",
                  "value": lambda: (s["jellyfin_url"] or "nicht gefunden").replace("http://", ""),
                  "change": lambda step: self.server_url("jellyfin_url", search=True)},
             ]},
            {"label": "Ton", "icon": "sound", "desc": "Lautstärke des Geräts", "items": sound},
            {"label": "System", "icon": "power", "desc": "Netzwerk, Start, Updates und Ausschalten",
             "items": [
                 {"kind": "header", "label": "Verbindungen"},
                 {"kind": "action", "label": "WLAN", "hint": network.wifi_current() or
                  ("nicht verbunden" if network.wifi_enabled() else "aus"), "run": lambda: self.open_sub("wifi")},
                 {"kind": "action", "label": "Bluetooth", "hint": self.bt_hint(), "run": lambda: self.open_sub("bt")},
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

        def done(result):
            ok, message = result
            self.notice(f"{dev['name']}: {message}")
            self.bt["found"] = [d for d in self.bt["found"] if d["mac"] != dev["mac"]] if ok else self.bt["found"]
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
        remote.start(on_key, player.running)
    except OSError:
        sys.exit("RaspiTV läuft bereits (Port 8765 ist belegt).")

    app.aboutToQuit.connect(player.stop)
    # Auch beim Beenden von außen (kill, Abmelden) den Player mit schließen
    signal.signal(signal.SIGTERM, lambda *_: app.quit())
    signal.signal(signal.SIGINT, lambda *_: app.quit())
    signal.signal(signal.SIGHUP, lambda *_: app.quit())  # Terminal wurde geschlossen
    QTimer(app, interval=200, timeout=lambda: None).start()  # Python-Signale auch während Qt läuft annehmen
    view.showFullScreen()
    sys.exit(app.exec_())


if __name__ == "__main__":
    main()
