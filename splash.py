#!/usr/bin/env python3
"""Startbild beim Hochfahren: deckt Desktop und Terminal mit dem RaspiTV-Logo ab (gleiches Bild wie
das Bootbild), bis RaspiTV sein erstes Bild gezeichnet hat.

Der Autostart (settings.set_autostart) startet es im Terminal vor `git pull` und RaspiTV.
RaspiTV legt nach dem ersten Bild die Datei READY an; dann schließt sich das Startbild.
Spätestens nach TIMEOUT Sekunden geht es von selbst zu (z. B. wenn RaspiTV nicht startet).
"""
import os
import sys
import time
from pathlib import Path

from player import gui_env

# Wie RaspiTV: Wayland-Anzeige finden (auch ohne WAYLAND_DISPLAY in der Umgebung) und nutzen
os.environ.update(gui_env())
if os.environ.get("WAYLAND_DISPLAY"):
    os.environ.setdefault("QT_QPA_PLATFORM", "wayland;xcb")

from PyQt5.QtCore import QRectF, Qt, QTimer  # noqa: E402
from PyQt5.QtGui import QColor, QImage, QPainter, QPen  # noqa: E402
from PyQt5.QtWidgets import QApplication, QWidget  # noqa: E402

ROOT = Path(__file__).resolve().parent
READY = Path(os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")) / "raspitv-ready"
TIMEOUT = 120
BG = QColor("#0e1013")  # wie Bootbild und Oberfläche


class Splash(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("RaspiTV")
        self.setCursor(Qt.BlankCursor)
        self.logo = QImage(str(ROOT / "logos" / "raspitv-boot.png"))
        self.start = time.monotonic()
        self.angle = 0
        QTimer(self, interval=33, timeout=self.tick).start()

    def tick(self):
        if READY.exists() or time.monotonic() - self.start > TIMEOUT:
            QTimer.singleShot(400, QApplication.quit)  # RaspiTV liegt schon darüber – kein Aufblitzen
            self.tick = lambda: None
            return
        self.angle = (self.angle + 9) % 360
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.setRenderHint(QPainter.SmoothPixmapTransform)
        p.fillRect(self.rect(), BG)
        w, h = self.width(), self.height()
        # Logo wie im Bootbild: mittig, höchstens 40 % der Bildschirmhöhe
        if not self.logo.isNull():
            scale = min(1.0, h * 0.4 / self.logo.height())
            lw, lh = self.logo.width() * scale, self.logo.height() * scale
            p.drawImage(QRectF((w - lw) / 2, (h - lh) / 2, lw, lh), self.logo)
        # dezenter Lade-Kreis darunter
        r = h * 0.018
        cx, cy = w / 2, h * 0.82
        pen = QPen(QColor(255, 255, 255, 40), r * 0.28)
        p.setPen(pen)
        p.drawEllipse(QRectF(cx - r, cy - r, 2 * r, 2 * r))
        pen.setColor(QColor(255, 255, 255, 200))
        pen.setCapStyle(Qt.RoundCap)
        p.setPen(pen)
        p.drawArc(QRectF(cx - r, cy - r, 2 * r, 2 * r), -self.angle * 16, 90 * 16)


def main():
    READY.unlink(missing_ok=True)
    app = QApplication(sys.argv)
    app.setDesktopFileName("raspitv-splash")
    s = Splash()
    s.showFullScreen()
    sys.exit(app.exec_())


if __name__ == "__main__":
    main()
