#!/usr/bin/env python3
"""Startbild beim Hochfahren: deckt Desktop und Terminal mit dem RaspiTV-Logo ab (gleiches Bild wie
das Bootbild), bis RaspiTV sein erstes Bild gezeichnet hat. Unter dem Logo steht, was gerade passiert:
„Starte …“, „Suche nach Updates …“, dann „Update installiert“ bzw. „RaspiTV ist aktuell“.

Ablauf beim Hochfahren (settings.set_autostart):
  labwc-Autostart:  python3 splash.py &   Startbild noch vor Desktop und Leiste (meldet SHOWN, dann erst
                                          startet der Desktop); eine labwc-Fensterregel hält es ganz oben
  Terminal:         python3 splash.py &   (läuft schon → beendet sich gleich wieder)
                    python3 splash.py --update   nach Updates suchen (git pull), Stand ans Startbild melden
                    python3 raspitv.py    RaspiTV legt nach dem ersten Bild READY an → Startbild geht zu
                    python3 splash.py --done     falls RaspiTV vorher endet: Startbild trotzdem schließen
Spätestens nach TIMEOUT Sekunden geht es von selbst zu.
"""
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RUNTIME = Path(os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}"))
READY = RUNTIME / "raspitv-ready"
STATUS = RUNTIME / "raspitv-splash-status"
SHOWN = RUNTIME / "raspitv-splash-shown"
PID = RUNTIME / "raspitv-splash.pid"
TIMEOUT = 90
TEXTS = {
    "": "Starte …",
    "update": "Suche nach Updates …",
    "updated": "Update installiert – RaspiTV wird geladen …",
    "current": "RaspiTV ist aktuell – wird geladen …",
}


def set_status(name):
    try:
        STATUS.write_text(name)
    except OSError:
        pass


def wait_for_network(seconds):
    """Wartet bis zu `seconds` auf eine Internet-Verbindung (Namensauflösung von github.com)."""
    import socket
    end = time.monotonic() + seconds
    while True:
        try:
            socket.getaddrinfo("github.com", 443)
            return True
        except OSError:
            if time.monotonic() >= end:
                return False
            time.sleep(1)


def update():
    """Nach Updates suchen (läuft im Terminal, Ausgabe von git bleibt dort sichtbar)."""
    time.sleep(1)  # „Starte …“ kurz stehen lassen
    set_status("update")
    started = time.monotonic()

    def head():
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout

    before = head()
    # Ohne Netz (z. B. im Urlaub) startet einfach die vorhandene Version; beim nächsten Start wird es
    # wieder versucht. Gewartet wird nur kurz aufs WLAN, und git darf nie hängen bleiben (WLAN ohne
    # Internet, Hotel-Anmeldeseite): Zeitlimit, keine Passwortabfrage, Abbruch bei Stillstand.
    if wait_for_network(5):
        try:
            subprocess.run(["git", "-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=10",
                            "pull", "--ff-only"], cwd=ROOT, timeout=40, stdin=subprocess.DEVNULL,
                           env={**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_ASKPASS": "true"})
        except subprocess.TimeoutExpired:
            print("Update abgebrochen (Netz zu langsam) – RaspiTV startet mit der vorhandenen Version")
    else:
        print("Kein Netz – RaspiTV startet ohne Update")
    time.sleep(max(0, 1.2 - (time.monotonic() - started)))  # Text lesbar lassen
    set_status("updated" if head() != before else "current")


def running():
    """Läuft schon ein Startbild?"""
    try:
        os.kill(int(PID.read_text()), 0)
        return True
    except (OSError, ValueError):
        return False


def show():
    if running():
        return
    PID.write_text(str(os.getpid()))
    from player import gui_env

    # Wie RaspiTV: Wayland-Anzeige finden (auch ohne WAYLAND_DISPLAY in der Umgebung) und nutzen
    os.environ.update(gui_env())
    if os.environ.get("WAYLAND_DISPLAY"):
        os.environ.setdefault("QT_QPA_PLATFORM", "wayland;xcb")

    from PyQt5.QtCore import QRectF, Qt, QTimer
    from PyQt5.QtGui import QColor, QFont, QImage, QPainter, QPen
    from PyQt5.QtWidgets import QApplication, QWidget

    bg = QColor("#0e1013")  # wie Bootbild und Oberfläche

    class Splash(QWidget):
        def __init__(self):
            super().__init__()
            self.setWindowTitle("RaspiTV")
            self.setCursor(Qt.BlankCursor)
            self.logo = QImage(str(ROOT / "logos" / "raspitv-boot.png"))
            self.start = time.monotonic()
            self.angle = 0
            self.status = ""
            self.done = False
            self.shown = False
            QTimer(self, interval=33, timeout=self.tick).start()

        def tick(self):
            if self.done:
                return
            if READY.exists() or time.monotonic() - self.start > TIMEOUT:
                self.done = True
                QTimer.singleShot(100, QApplication.quit)  # RaspiTV ist darunter schon gezeichnet
                return
            try:
                self.status = STATUS.read_text().strip()
            except OSError:
                pass
            self.angle = (self.angle + 9) % 360
            self.update()

        def paintEvent(self, _):
            p = QPainter(self)
            p.setRenderHint(QPainter.Antialiasing)
            p.setRenderHint(QPainter.SmoothPixmapTransform)
            p.fillRect(self.rect(), bg)
            w, h = self.width(), self.height()
            # Logo wie im Bootbild: mittig, höchstens 40 % der Bildschirmhöhe
            if not self.logo.isNull():
                scale = min(1.0, h * 0.4 / self.logo.height())
                lw, lh = self.logo.width() * scale, self.logo.height() * scale
                p.drawImage(QRectF((w - lw) / 2, (h - lh) / 2, lw, lh), self.logo)
            # Lade-Kreis und darunter, was gerade passiert
            r = h * 0.018
            cx, cy = w / 2, h * 0.79
            pen = QPen(QColor(255, 255, 255, 40), r * 0.28)
            p.setPen(pen)
            p.drawEllipse(QRectF(cx - r, cy - r, 2 * r, 2 * r))
            pen.setColor(QColor(255, 255, 255, 200))
            pen.setCapStyle(Qt.RoundCap)
            p.setPen(pen)
            p.drawArc(QRectF(cx - r, cy - r, 2 * r, 2 * r), -self.angle * 16, 90 * 16)
            font = QFont("Nunito Sans")
            font.setPixelSize(round(h * 0.022))
            p.setFont(font)
            p.setPen(QColor(255, 255, 255, 150))
            p.drawText(QRectF(0, cy + r * 2, w, h * 0.05), Qt.AlignHCenter | Qt.AlignVCenter,
                       TEXTS.get(self.status, ""))
            if not self.shown:
                self.shown = True
                QTimer.singleShot(50, lambda: SHOWN.touch())  # labwc-Autostart startet jetzt den Desktop dahinter

    for f in (READY, STATUS, SHOWN):
        f.unlink(missing_ok=True)
    app = QApplication(sys.argv)
    app.setDesktopFileName("raspitv-splash")
    s = Splash()
    s.showFullScreen()
    code = app.exec_()
    PID.unlink(missing_ok=True)
    sys.exit(code)


if __name__ == "__main__":
    if "--update" in sys.argv:
        update()
    elif "--done" in sys.argv:
        READY.touch()
    else:
        show()
