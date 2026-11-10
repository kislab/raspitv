#!/usr/bin/env python3
"""RaspiTV – native TV-Oberfläche im Google-TV-Stil (PyQt5, komplett selbst gezeichnet).

Bedienung: Pfeiltasten, Enter = OK, Esc/Backspace = Zurück, Pos1 = Home.
Fernbedienungen speisen dieselben Tasten über remote.py ein.
"""
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

from player import Player, gui_env

os.environ.update(gui_env())
if os.environ.get("WAYLAND_DISPLAY"):
    os.environ.setdefault("QT_QPA_PLATFORM", "wayland;xcb")

from PyQt5.QtCore import QLocale, QDateTime, QPointF, QRectF, Qt, QTimer, pyqtSignal
from PyQt5.QtGui import QColor, QFont, QFontMetricsF, QLinearGradient, QPainter, QPen, QPixmap, QRadialGradient
from PyQt5.QtWidgets import QApplication, QWidget

import remote
import settings as cfg

ROOT = Path(__file__).resolve().parent
BG = QColor("#0e1013")
PANEL = QColor("#1b1d22")
CARD = QColor("#22252b")
TEXT = QColor("#e8eaed")
SOFT = QColor("#c4c7cc")
MUTED = QColor("#9aa0a6")
DARK = QColor("#202124")
BLUE = QColor("#8ab4f8")

KEYMAP = {
    Qt.Key_Up: "up", Qt.Key_Down: "down", Qt.Key_Left: "left", Qt.Key_Right: "right",
    Qt.Key_Return: "ok", Qt.Key_Enter: "ok", Qt.Key_Space: "ok", Qt.Key_Select: "ok",
    Qt.Key_Escape: "back", Qt.Key_Backspace: "back", Qt.Key_Back: "back",
    Qt.Key_Home: "home", Qt.Key_HomePage: "home",
}
HEADER, APPS = 0, 1                                   # Zeilen der Startseite
FOCUSABLE = ("choice", "toggle", "action", "range")   # wählbare Einstellungs-Zeilen
FOCUS_SCALE = 1.12


def ease(t):
    return 1 - (1 - t) ** 3


def alpha(color, a):
    c = QColor(color)
    c.setAlphaF(max(0.0, min(1.0, a)))
    return c


class Home(QWidget):
    key = pyqtSignal(str)  # auch aus dem Fernbedienungs-Thread auslösbar

    def __init__(self, apps, player):
        super().__init__()
        self.all_apps = apps
        self.player = player
        self.settings = cfg.load()
        self.row = APPS
        self.col = 0                   # gewählte App
        self.view = "home"             # "home" | "settings"
        self.items, self.item = [], 0  # Einstellungs-Zeilen und gewählte Zeile
        self.volume = None
        self.dialog = None             # {"text", "buttons": [(label, fn)], "index"}
        self.running = None            # gestarteter Dienst, solange der Player läuft
        self.started = 0.0

        # animierte Werte
        self.scale = []
        self.scroll = 0.0
        self.hero = self.hero_prev = None
        self.hero_t = 1.0
        self.intro = 0.0               # Einblenden beim Start
        self.panel = 0.0               # Einstellungs-Leiste: 0 = zu, 1 = offen
        self.panel_scroll = 0.0
        self.gear = 0.0                # Fokus des Zahnrads
        self.last_step = time.monotonic()
        self.art_cache = {}            # fertig gezeichnete Banner je App und Fenstergröße
        self.logo_cache = {}           # geladene und skalierte Logos
        self.refresh_apps()

        self.setWindowTitle("RaspiTV")
        self.setCursor(Qt.BlankCursor)
        self.key.connect(self.handle)
        self.anim = QTimer(self, interval=16, timeout=self.step)
        self.anim.start()
        QTimer(self, interval=1000, timeout=self.tick).start()

    def refresh_apps(self):
        """Sichtbare Apps neu bestimmen (nach Änderungen in den Einstellungen)."""
        hidden = set(self.settings["hidden"])
        self.apps = [a for a in self.all_apps if a["id"] not in hidden] or self.all_apps[:1]
        self.scale = [1.0] * len(self.apps)
        self.col = min(self.col, len(self.apps) - 1)
        if self.hero not in self.apps:
            self.hero = self.hero_prev = self.apps[self.col]
            self.hero_t = 1.0

    # ---------- Eingabe ----------

    def keyPressEvent(self, event):
        key = KEYMAP.get(event.key())
        if key and not (key == "ok" and event.isAutoRepeat()):
            self.handle(key)

    def handle(self, key):
        if self.running:
            if key == "home":  # alle anderen Tasten gehören der Seite im Player
                self.go_home()
        elif self.dialog:
            self.dialog_key(key)
        elif self.view == "settings":
            self.settings_key(key)
        elif key in ("left", "right") and self.row == APPS:
            step = -1 if key == "left" else 1
            self.col = min(max(self.col + step, 0), len(self.apps) - 1)
        elif key == "up":
            self.row = HEADER
        elif key == "down":
            self.row = APPS
        elif key == "ok":
            if self.row == APPS:
                self.launch(self.apps[self.col])
            else:
                self.open_settings()

        if self.apps[self.col] is not self.hero:
            self.hero_prev, self.hero, self.hero_t = self.hero, self.apps[self.col], 0.0
        if not self.anim.isActive():
            self.last_step = time.monotonic()
            self.anim.start()
        self.update()

    def dialog_key(self, key):
        buttons = self.dialog["buttons"]
        if key in ("back", "home"):
            self.dialog = None
        elif key in ("left", "right") and buttons:
            step = -1 if key == "left" else 1
            self.dialog["index"] = min(max(self.dialog["index"] + step, 0), len(buttons) - 1)
        elif key == "ok" and buttons:
            buttons[self.dialog["index"]][1]()

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
            self.player.launch(app, self.width(), self.height())
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

    def run_update(self):
        """Neueste Version von GitHub holen; wenn es eine gibt, RaspiTV damit neu starten."""
        self.dialog = {"text": "Suche nach Updates …", "buttons": [], "index": 0}
        self.repaint()
        changed, message = cfg.update()
        if not changed:
            self.dialog = {"text": message, "buttons": [("OK", self.close_dialog)], "index": 0}
            return
        self.dialog = {"text": f"{message} – RaspiTV startet neu …", "buttons": [], "index": 0}
        self.repaint()
        self.player.stop()
        # Prozess durch die neue Version ersetzen (Port 8765 wird dabei freigegeben)
        os.execv(sys.executable, [sys.executable, str(ROOT / "raspitv.py")])

    def go_home(self):
        self.player.stop()
        self.running = self.dialog = None
        self.activateWindow()

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
        """Sekundentakt: Uhr aktualisieren und merken, wenn der Player beendet wurde."""
        if self.running and not self.player.running():
            app, quick = self.running, time.monotonic() - self.started < 3
            self.running = self.dialog = None
            if quick:
                self.launch_failed(app)
            self.activateWindow()
        self.update()

    # ---------- Einstellungen ----------

    def open_settings(self):
        self.view = "settings"
        self.volume = cfg.get_volume()
        self.build_items()
        self.item = next(i for i, it in enumerate(self.items) if it["kind"] in FOCUSABLE)
        self.panel_scroll = 0.0

    def close_settings(self):
        self.view = "home"

    def set(self, name, value):
        self.settings[name] = value
        cfg.save(self.settings)

    def build_items(self):
        s = self.settings
        sizes = list(cfg.TILE_SIZES)

        def cycle_size(step):
            self.set("tile_size", sizes[(sizes.index(s["tile_size"]) + step) % len(sizes)])

        def toggle_app(app):
            hidden = set(s["hidden"]) ^ {app["id"]}
            if len(hidden) < len(self.all_apps):  # mindestens eine App bleibt sichtbar
                self.set("hidden", sorted(hidden))
                self.refresh_apps()

        def volume(step):
            cfg.change_volume(5 * step)
            self.volume = cfg.get_volume()

        items = [
            {"kind": "header", "label": "Darstellung"},
            {"kind": "choice", "label": "Kachelgröße", "value": lambda: s["tile_size"].capitalize(), "change": cycle_size},
            {"kind": "choice", "label": "Uhrzeit", "value": lambda: "24 Stunden" if s["clock_24h"] else "12 Stunden",
             "change": lambda step: self.set("clock_24h", not s["clock_24h"])},
            {"kind": "toggle", "label": "Animationen", "value": lambda: s["animations"],
             "change": lambda step: self.set("animations", not s["animations"])},
            {"kind": "header", "label": "Apps anzeigen"},
        ]
        for app in self.all_apps:
            items.append({"kind": "toggle", "label": app["name"],
                          "value": lambda app=app: app["id"] not in s["hidden"],
                          "change": lambda step, app=app: toggle_app(app)})
        items += [
            {"kind": "header", "label": "Jellyfin"},
            {"kind": "choice", "label": "Server (OK = neu suchen)",
             "value": lambda: (s["jellyfin_url"] or "nicht gefunden").replace("http://", ""),
             "change": lambda step: self.server_url("jellyfin_url", search=True)},
        ]
        items.append({"kind": "header", "label": "System"})
        if self.volume is not None:
            items.append({"kind": "range", "label": "Lautstärke", "value": lambda: f"{self.volume} %", "change": volume})
        items += [
            {"kind": "toggle", "label": "Beim Hochfahren starten", "value": cfg.autostart_enabled,
             "change": lambda step: cfg.set_autostart(not cfg.autostart_enabled())},
            {"kind": "action", "label": "Nach Updates suchen", "run": self.run_update},
            {"kind": "action", "label": "Zurück zum Desktop",
             "run": lambda: self.confirm("RaspiTV beenden?", "Zum Desktop", QApplication.quit)},
            {"kind": "action", "label": "Neu starten", "run": lambda: self.system("Neu starten", "reboot")},
            {"kind": "action", "label": "Ausschalten", "run": lambda: self.system("Ausschalten", "poweroff")},
            {"kind": "header", "label": "Info"},
            {"kind": "info", "label": "Version", "value": cfg.version()},
            {"kind": "info", "label": "IP-Adresse", "value": cfg.ip_address()},
            {"kind": "info", "label": "Auflösung", "value": f"{self.width()} × {self.height()}"},
        ]
        self.items = items

    def settings_key(self, key):
        item = self.items[self.item]
        if key in ("back", "home"):
            self.close_settings()
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
        elif key in ("left", "right"):
            item["change"](-1 if key == "left" else 1)
        elif key == "ok" and item["kind"] != "range":
            item["change"](1)

    def settings_layout(self, u):
        """Liefert je Zeile (y, Höhe) relativ zum Listenanfang sowie die Gesamthöhe."""
        rows, y = [], 0.0
        for item in self.items:
            h = (3.0 if item["kind"] == "header" else 2.9) * u
            rows.append((y, h))
            y += h
        return rows, y

    # ---------- Animation ----------

    def step(self):
        # Zeitbasiert: Animationen dauern gleich lang, egal wie schnell der Pi zeichnet.
        now = time.monotonic()
        frames = min(now - self.last_step, 0.1) / 0.016
        self.last_step = now
        instant = not self.settings["animations"]
        moving = False

        def approach(value, target, speed, eps):
            nonlocal moving
            if instant or abs(target - value) <= eps:
                return target
            moving = True
            return value + (target - value) * (1 - (1 - speed) ** frames)

        home_focus = self.view == "home" and not self.dialog
        focus = self.col if home_focus and self.row == APPS else -1
        for i, s in enumerate(self.scale):
            self.scale[i] = approach(s, FOCUS_SCALE if i == focus else 1.0, 0.3, 0.001)
        self.gear = approach(self.gear, 1.0 if home_focus and self.row == HEADER else 0.0, 0.3, 0.01)
        self.scroll = approach(self.scroll, self.scroll_target(), 0.25, 0.5)
        self.hero_t = approach(self.hero_t, 1.0, 0.1, 0.01)
        self.intro = approach(self.intro, 1.0, 0.06, 0.01)
        self.panel = approach(self.panel, 1.0 if self.view == "settings" else 0.0, 0.22, 0.005)
        if self.view == "settings":
            self.panel_scroll = approach(self.panel_scroll, self.panel_scroll_target(), 0.25, 0.5)
        if self.running and time.monotonic() - self.started < 8:
            moving = True  # Lade-Kreis drehen, bis der Player das Bild übernimmt
        if not moving:
            self.anim.stop()
        self.update()

    def metrics(self):
        u = self.width() / 80  # Grundeinheit: 24 px bei 1080p
        tile_w = 13.5 * u * cfg.TILE_SIZES[self.settings["tile_size"]]
        return u, 4 * u, tile_w, tile_w * 9 / 16, u

    def scroll_target(self):
        """Gewählte Kachel mittig halten, ohne über die Ränder hinaus zu scrollen."""
        u, edge, tile_w, _, gap = self.metrics()
        n = len(self.apps)
        total = 2 * edge + n * tile_w + (n - 1) * gap + tile_w * (FOCUS_SCALE - 1)
        center = edge + self.col * (tile_w + gap) + tile_w / 2
        return min(max(center - self.width() / 2, 0), max(total - self.width(), 0))

    def panel_scroll_target(self):
        u = self.width() / 80
        rows, total = self.settings_layout(u)
        view = self.height() - 7.5 * u
        y, h = rows[self.item]
        return min(max(y + h / 2 - view / 2, 0), max(total - view, 0))

    # ---------- Zeichnen ----------

    def font_px(self, size, weight=QFont.Normal):
        f = QFont(self.font())
        f.setPixelSize(max(1, round(size)))
        f.setWeight(weight)
        return f

    def brush(self, colors, rect):
        if len(colors) == 1:
            return QColor(colors[0])
        g = QLinearGradient(rect.topLeft(), rect.bottomRight())
        g.setColorAt(0, QColor(colors[0]))
        g.setColorAt(1, QColor(colors[1]))
        return g

    def logo(self, app, variant, max_w, max_h):
        """Offizielles Logo einer App (logos/<id>.png), passend skaliert; None, wenn keins vorliegt.

        `variant="hero"` bevorzugt logos/<id>_hero.png – eine Fassung für dunkle Hintergründe.
        """
        key = (app["id"], variant, round(max_w), round(max_h))
        if key not in self.logo_cache:
            source = (app["id"], variant)
            if source not in self.logo_cache:
                files = [ROOT / "logos" / f"{app['id']}.png"]
                if variant == "hero":
                    files.insert(0, ROOT / "logos" / f"{app['id']}_hero.png")
                pixmap = next((QPixmap(str(f)) for f in files if f.exists()), QPixmap())
                if not pixmap.isNull() and app.get("tint"):  # einfarbiges Logo umfärben
                    painter = QPainter(pixmap)
                    painter.setCompositionMode(QPainter.CompositionMode_SourceIn)
                    painter.fillRect(pixmap.rect(), QColor(app["tint"]))
                    painter.end()
                self.logo_cache[source] = pixmap
            pixmap = self.logo_cache[source]
            self.logo_cache[key] = None if pixmap.isNull() else pixmap.scaled(
                max(1, round(max_w)), max(1, round(max_h)), Qt.KeepAspectRatio, Qt.SmoothTransformation)
        return self.logo_cache[key]

    def draw_logo(self, p, app, area, max_w, max_h, variant="tile", shrink=1.0):
        """Zeichnet das Logo mittig in `area`; gibt False zurück, wenn die App kein Logo hat."""
        pixmap = self.logo(app, variant, max_w, max_h)
        if pixmap is None:
            return False
        w, h = pixmap.width() * shrink, pixmap.height() * shrink
        target = QRectF(area.center().x() - w / 2, area.center().y() - h / 2, w, h)
        p.drawPixmap(target, pixmap, QRectF(pixmap.rect()))
        return True

    def text(self, p, rect, text, size, color, weight=QFont.Normal, align=Qt.AlignLeft | Qt.AlignVCenter, fit=None):
        """Zeichnet eine Textzeile; mit `fit` wird die Schrift verkleinert, bis sie in diese Breite passt."""
        font = self.font_px(size, weight)
        if fit:
            width = QFontMetricsF(font).horizontalAdvance(text)
            if width > fit:
                font = self.font_px(size * fit / width, weight)
        p.setFont(font)
        p.setPen(color)
        p.drawText(rect, align | Qt.TextSingleLine, text)

    def paintEvent(self, _event):
        p = QPainter(self)
        p.setRenderHints(QPainter.Antialiasing | QPainter.TextAntialiasing | QPainter.SmoothPixmapTransform)
        W, H = self.width(), self.height()
        u, edge, tile_w, tile_h, gap = self.metrics()
        p.fillRect(self.rect(), BG)

        self.paint_hero_art(p, W, H, u)
        self.paint_header(p, W, u, edge)

        # Hero-Text und App-Reihe, von unten nach oben verankert
        tiles_y = H - 4.4 * u - tile_h
        app = self.hero
        slide = (1 - ease(self.hero_t)) * 1.2 * u  # Text gleitet beim Wechsel leicht herein
        p.setOpacity(0.35 + 0.65 * ease(self.hero_t))
        y = tiles_y - 2.9 * u - 2.4 * u - 1.7 * u
        self.text(p, QRectF(edge + slide, y, W * 0.5, 1.7 * u), app.get("desc", ""), 1.15 * u, SOFT)
        y -= 0.2 * u + 4.4 * u
        self.text(p, QRectF(edge + slide, y, W * 0.5, 4.4 * u), app["name"], 3.6 * u, QColor("#ffffff"), QFont.DemiBold)
        y -= 1.6 * u
        tag = QFont(self.font_px(0.8 * u, QFont.Bold))
        tag.setLetterSpacing(QFont.AbsoluteSpacing, 0.14 * u)
        p.setFont(tag)
        p.setPen(QColor(app["accent"]).lighter(135))
        p.drawText(QRectF(edge + slide, y, W * 0.5, 1.6 * u), Qt.AlignLeft | Qt.AlignVCenter, app.get("tag", "App").upper())
        p.setOpacity(1.0)

        self.text(p, QRectF(edge, tiles_y - 2.9 * u, W, 1.5 * u), "Deine Apps", 1.1 * u, TEXT, QFont.DemiBold)
        self.paint_tiles(p, edge, tiles_y, tile_w, tile_h, gap, u)

        if self.panel > 0:
            self.paint_settings(p, W, H, u)
        if self.dialog:
            self.paint_dialog(p, W, H, u)
        if self.intro < 1:
            p.fillRect(self.rect(), alpha("#000000", 1 - ease(self.intro)))

    def paint_hero_art(self, p, W, H, u):
        """Banner rechts oben, das nach links und unten in den Hintergrund ausläuft."""
        x = round(W * 0.28)
        layers = [(self.hero_prev, 1.0), (self.hero, ease(self.hero_t))] if self.hero_t < 1 else [(self.hero, 1.0)]
        for app, opacity in layers:
            p.setOpacity(opacity)
            p.drawPixmap(x, 0, self.hero_pixmap(app, W - x, round(H * 0.7), u))
        p.setOpacity(1.0)
        top = QLinearGradient(0, 0, 0, 6 * u)  # Kopfleiste bleibt auf hellen Bannern lesbar
        top.setColorAt(0, alpha(BG, 0.7))
        top.setColorAt(1, alpha(BG, 0))
        p.fillRect(QRectF(0, 0, W, 6 * u), top)

    def hero_pixmap(self, app, w, h, u):
        """Banner einer App einmal zeichnen und merken – Verläufe sind auf dem Pi sonst zu langsam."""
        key = (app["id"], w, h)
        if key in self.art_cache:
            return self.art_cache[key]
        pixmap = QPixmap(w, h)
        p = QPainter(pixmap)
        p.setRenderHints(QPainter.Antialiasing | QPainter.TextAntialiasing)
        art = QRectF(0, 0, w, h)
        p.fillRect(art, self.brush(app.get("hero_bg", app["bg"]), art))
        glow = QRadialGradient(QPointF(w * 0.62, h * 0.42), w * 0.5)
        glow.setColorAt(0, alpha(app["accent"], 0.35))
        glow.setColorAt(1, alpha(app["accent"], 0))
        p.fillRect(art, glow)
        mark = QRectF(w * 0.22, 0, w * 0.78, h * 0.86)
        if not self.draw_logo(p, app, mark, mark.width() * 0.6, h * 0.34, "hero"):
            self.text(p, mark, app["name"], 7 * u, QColor(app["fg"]), QFont.ExtraBold, Qt.AlignCenter,
                      fit=mark.width() * 0.8)
        for start, end in (
            (art.topLeft(), QPointF(art.x() + art.width() * 0.6, 0)),                    # nach links
            (art.bottomLeft(), QPointF(art.x(), art.bottom() - art.height() * 0.65)),    # nach unten
        ):
            fade = QLinearGradient(start, end)
            fade.setColorAt(0, BG)
            fade.setColorAt(0.35, alpha(BG, 0.82))
            fade.setColorAt(1, alpha(BG, 0))
            p.fillRect(art, fade)
        p.end()
        self.art_cache[key] = pixmap
        return pixmap

    def paint_header(self, p, W, u, edge):
        now = QDateTime.currentDateTime()
        clock = now.toString("HH:mm" if self.settings["clock_24h"] else "h:mm AP")
        font = self.font_px(1.7 * u, QFont.DemiBold)
        clock_w = QFontMetricsF(font).horizontalAdvance(clock)
        y, h = 1.5 * u, 2.6 * u
        self.text(p, QRectF(edge, y, clock_w + u, h), clock, 1.7 * u, QColor("#ffffff"), QFont.DemiBold)
        date = QLocale(QLocale.German).toString(now, "dddd, d. MMMM")
        self.text(p, QRectF(edge + clock_w + 0.9 * u, y + 0.1 * u, W / 2, h), date, 1.0 * u, SOFT)

        # Schriftzug in der Mitte, schlicht in Weiß
        self.text(p, QRectF(0, y, W, h), "RaspiTV", 1.7 * u, QColor("#ffffff"), QFont.ExtraBold, Qt.AlignCenter)

        # Zahnrad: Einstellungen
        r = (1.3 + 0.15 * self.gear) * u
        c = QPointF(W - edge - 1.3 * u, y + h / 2)
        fill = QColor(
            *(round(a + (b - a) * self.gear) for a, b in zip((255, 255, 255, 36), (232, 234, 237, 255)))
        )
        p.setPen(Qt.NoPen)
        p.setBrush(fill)
        p.drawEllipse(c, r, r)
        icon = DARK if self.gear > 0.5 else TEXT
        p.save()
        p.translate(c)
        p.setBrush(icon)
        g = 0.62 * u
        for _ in range(8):
            p.rotate(45)
            p.drawRoundedRect(QRectF(-0.17 * g, -g, 0.34 * g, 0.5 * g), 0.08 * g, 0.08 * g)
        p.drawEllipse(QPointF(0, 0), 0.72 * g, 0.72 * g)
        p.setBrush(fill if self.gear > 0.5 else QColor("#3a3d42"))
        p.drawEllipse(QPointF(0, 0), 0.32 * g, 0.32 * g)
        p.restore()
        if self.gear > 0.05:
            p.setOpacity(self.gear)
            self.text(p, QRectF(c.x() - r - 12.8 * u, y, 12 * u, h), "Einstellungen", 1.0 * u, TEXT,
                      QFont.DemiBold, Qt.AlignRight | Qt.AlignVCenter)
            p.setOpacity(1.0)

    def paint_tiles(self, p, edge, y, tile_w, tile_h, gap, u):
        """Kachelreihe: die gewählte Kachel wächst und schiebt ihre Nachbarn zur Seite."""
        x = edge - self.scroll
        radius = 0.9 * u
        for i, app in enumerate(self.apps):
            s = self.scale[i]
            w, h = tile_w * s, tile_h * s
            rect = QRectF(x, y + (tile_h - h) / 2, w, h)
            x += w + gap
            if rect.right() < 0 or rect.left() > self.width():
                continue
            f = (s - 1) / (FOCUS_SCALE - 1)  # 0 = normal, 1 = gewählt
            p.setPen(Qt.NoPen)
            if f > 0.02:  # weicher Farbschein unter der gewählten Kachel
                p.setBrush(alpha(app["accent"], 0.05 * f))
                for k in range(1, 7):
                    d = k * 0.28 * u
                    p.drawRoundedRect(rect.adjusted(-d, -d + 0.5 * u, d, d + 0.5 * u), radius + d, radius + d)
            p.setBrush(self.brush(app["bg"], rect))
            p.drawRoundedRect(rect, radius, radius)
            sheen = QLinearGradient(rect.topLeft(), rect.bottomLeft())  # leichter Glanz von oben
            sheen.setColorAt(0, QColor(255, 255, 255, 26))
            sheen.setColorAt(0.5, QColor(255, 255, 255, 0))
            p.setBrush(sheen)
            p.drawRoundedRect(rect, radius, radius)
            # Logo einmal in Fokusgröße skalieren und beim Zeichnen nur leicht verkleinern
            box_w, box_h = tile_w * FOCUS_SCALE * 0.66, tile_h * FOCUS_SCALE * 0.5
            if not self.draw_logo(p, app, rect, box_w, box_h, shrink=s / FOCUS_SCALE):
                self.text(p, rect, app["name"], 1.55 * u * s * tile_w / (13.5 * u), QColor(app["fg"]),
                          QFont.ExtraBold, Qt.AlignCenter, fit=rect.width() * 0.8)
            if f > 0.02:
                d = 0.28 * u
                p.setPen(QPen(alpha("#ffffff", f), 0.16 * u))
                p.setBrush(Qt.NoBrush)
                p.drawRoundedRect(rect.adjusted(-d, -d, d, d), radius + d, radius + d)

    def pill(self, p, rect, label, size, focused):
        p.setPen(Qt.NoPen)
        p.setBrush(TEXT if focused else QColor(255, 255, 255, 31))
        p.drawRoundedRect(rect, rect.height() / 2, rect.height() / 2)
        self.text(p, rect, label, size, DARK if focused else TEXT, QFont.DemiBold, Qt.AlignCenter)

    def paint_settings(self, p, W, H, u):
        t = ease(self.panel)
        p.fillRect(self.rect(), alpha("#000000", 0.6 * t))
        width = 32 * u
        x = W - width * t
        p.setPen(Qt.NoPen)
        p.setBrush(PANEL)
        p.drawRoundedRect(QRectF(x, 0, width + 3 * u, H), 1.8 * u, 1.8 * u)
        self.text(p, QRectF(x + 2.6 * u, 1.6 * u, width, 3 * u), "Einstellungen", 1.9 * u, QColor("#ffffff"), QFont.DemiBold)
        if not self.items:
            return

        top = 6 * u
        p.save()
        p.setClipRect(QRectF(x, top, width, H - top - 1.5 * u))
        rows, _ = self.settings_layout(u)
        for i, (item, (ry, h)) in enumerate(zip(self.items, rows)):
            y = top + ry - self.panel_scroll
            if y + h < top or y > H:
                continue
            if item["kind"] == "header":
                head = QFont(self.font_px(0.78 * u, QFont.Bold))
                head.setLetterSpacing(QFont.AbsoluteSpacing, 0.12 * u)
                p.setFont(head)
                p.setPen(MUTED)
                p.drawText(QRectF(x + 2.6 * u, y, width, h - 0.5 * u), Qt.AlignLeft | Qt.AlignBottom, item["label"].upper())
                continue
            focused = i == self.item and self.view == "settings" and not self.dialog
            row = QRectF(x + 1.4 * u, y + 0.15 * u, width - 2.8 * u, h - 0.3 * u)
            if focused:
                p.setPen(Qt.NoPen)
                p.setBrush(TEXT)
                p.drawRoundedRect(row, row.height() / 2, row.height() / 2)
            inner = row.adjusted(1.3 * u, 0, -1.3 * u, 0)
            self.text(p, inner, item["label"], 1.1 * u, DARK if focused else TEXT,
                      QFont.DemiBold if focused else QFont.Normal)
            kind = item["kind"]
            if kind == "toggle":
                self.paint_switch(p, inner, item["value"](), focused, u)
            elif kind in ("choice", "range"):
                value = f"‹  {item['value']()}  ›" if focused else item["value"]()
                self.text(p, inner, value, 1.05 * u, DARK if focused else MUTED, QFont.Normal, Qt.AlignRight | Qt.AlignVCenter)
            elif kind == "info":
                self.text(p, inner, item["value"], 1.05 * u, MUTED, QFont.Normal, Qt.AlignRight | Qt.AlignVCenter)
        p.restore()

    def paint_switch(self, p, inner, on, focused, u):
        w, h = 2.5 * u, 1.3 * u
        track = QRectF(inner.right() - w, inner.center().y() - h / 2, w, h)
        p.setPen(Qt.NoPen)
        if on:
            p.setBrush(QColor("#1a73e8") if focused else BLUE)
        else:
            p.setBrush(QColor("#9aa0a6") if focused else QColor("#4a4d52"))
        p.drawRoundedRect(track, h / 2, h / 2)
        knob = track.right() - h / 2 if on else track.left() + h / 2
        p.setBrush(QColor("#ffffff") if on or focused else QColor("#c4c7cc"))
        p.drawEllipse(QPointF(knob, track.center().y()), h * 0.36, h * 0.36)

    def paint_dialog(self, p, W, H, u):
        buttons = self.dialog["buttons"]
        app = self.dialog.get("app")
        if app:  # Startbildschirm eines Dienstes
            p.fillRect(self.rect(), self.brush(app.get("hero_bg", app["bg"]), QRectF(self.rect())))
            p.fillRect(self.rect(), alpha("#000000", 0.3))
            mark = QRectF(0, H / 2 - 7 * u, W, 8 * u)
            if not self.draw_logo(p, app, mark, W * 0.3, 7 * u, "hero"):
                self.text(p, mark, app["name"], 6 * u, QColor(app["fg"]), QFont.ExtraBold, Qt.AlignCenter, fit=W * 0.6)
            self.text(p, QRectF(0, H / 2 + 5.2 * u, W, 2 * u), self.dialog["text"], 1.1 * u, SOFT, QFont.Normal, Qt.AlignCenter)
            p.setPen(QPen(QColor("#ffffff"), 0.22 * u, Qt.SolidLine, Qt.RoundCap))
            p.setBrush(Qt.NoBrush)
            spin = QRectF(W / 2 - 1.1 * u, H / 2 + 2.2 * u, 2.2 * u, 2.2 * u)
            p.drawArc(spin, int(-time.monotonic() * 300 * 16) % (360 * 16), 270 * 16)
            return

        p.fillRect(self.rect(), alpha("#000000", 0.7))
        size = 1.1
        font = self.font_px(size * u, QFont.DemiBold)
        widths = [QFontMetricsF(font).horizontalAdvance(label) + 3.2 * u for label, _ in buttons]
        gap = 0.8 * u
        row_w = sum(widths) + gap * max(len(buttons) - 1, 0)
        title_w = QFontMetricsF(self.font_px(1.7 * u, QFont.DemiBold)).horizontalAdvance(self.dialog["text"])
        card_w = max(row_w, title_w, 18 * u) + 6 * u
        card_h = (11.5 if buttons else 7) * u
        card = QRectF((W - card_w) / 2, (H - card_h) / 2, card_w, card_h)
        p.setPen(Qt.NoPen)
        p.setBrush(CARD)
        p.drawRoundedRect(card, 1.6 * u, 1.6 * u)
        title = QRectF(card.x(), card.y() + (2.4 if buttons else 2) * u, card_w, 3 * u)
        self.text(p, title, self.dialog["text"], 1.7 * u, QColor("#ffffff"), QFont.DemiBold, Qt.AlignCenter)
        x = (W - row_w) / 2
        for i, (label, _) in enumerate(buttons):
            self.pill(p, QRectF(x, card.bottom() - 5 * u, widths[i], 2.6 * u), label, size * u, i == self.dialog["index"])
            x += widths[i] + gap


def main():
    apps = json.loads((ROOT / "apps.json").read_text(encoding="utf-8"))
    app = QApplication(sys.argv)
    app.setFont(QFont("Nunito Sans"))  # Systemschrift von Raspberry Pi OS; sonst Qt-Ersatzschrift
    player = Player()
    home = Home(apps, player)

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
    home.showFullScreen()
    sys.exit(app.exec_())


if __name__ == "__main__":
    main()
