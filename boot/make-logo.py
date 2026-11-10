#!/usr/bin/env python3
"""Zeichnet das RaspiTV-Logo (Blätter, Fernseher mit Himbeere, Schriftzug) mit durchsichtigem
Hintergrund nach logos/raspitv-boot.png – das Bild für den Bootbildschirm.

    python3 boot/make-logo.py [--no-text] [ausgabe.png]

Am besten in der Desktop-Sitzung starten (dort findet Qt die Systemschrift Nunito Sans).

Koordinaten in „Logo-Einheiten“ (Fernseher 440 breit); SCALE bestimmt die Pixelgröße.
"""
import math
import sys
from pathlib import Path

from PyQt5.QtCore import QPointF, QRectF, Qt
from PyQt5.QtGui import (QBrush, QColor, QFont, QFontMetricsF, QGuiApplication, QImage, QLinearGradient,
                         QPainter, QPainterPath, QPen)

ROOT = Path(__file__).resolve().parent.parent
RED = QColor("#c9384f")
LEAF_LIGHT = QColor("#7dbe55")
LEAF_DARK = QColor("#5a9b3c")
WHITE = QColor("#eceef0")
SCALE = 2.0                    # 1 Einheit = 2 Pixel
W, H = 480, 640                # Zeichenfläche in Einheiten (mit Schrift)


def leaf(p, tip, top, width):
    """Breites Blatt von der Spitze unten (`tip`) zum runden Ende oben (`top`), mit Kerbe am Ansatz."""
    dx, dy = top.x() - tip.x(), top.y() - tip.y()
    length = math.hypot(dx, dy)
    nx, ny = -dy / length * width, dx / length * width       # Querrichtung
    path = QPainterPath(tip)
    path.cubicTo(QPointF(tip.x() + dx * 0.25 + nx * 1.15, tip.y() + dy * 0.25 + ny * 1.15),
                 QPointF(top.x() + nx * 0.7 - dx * 0.06, top.y() + ny * 0.7 - dy * 0.06), top)
    path.cubicTo(QPointF(top.x() - nx * 0.7 - dx * 0.06, top.y() - ny * 0.7 - dy * 0.06),
                 QPointF(tip.x() + dx * 0.25 - nx * 1.15, tip.y() + dy * 0.25 - ny * 1.15), tip)
    shade = QLinearGradient(top, tip)                          # oben heller, zum Ansatz dunkler
    shade.setColorAt(0, LEAF_LIGHT)
    shade.setColorAt(1, LEAF_DARK)
    p.setPen(Qt.NoPen)
    p.setBrush(QBrush(shade))
    p.drawPath(path)
    # Kerbe entlang der Mittelrippe, vom Ansatz aus (durchsichtig)
    p.setCompositionMode(QPainter.CompositionMode_Clear)
    p.setPen(QPen(Qt.black, 8, Qt.SolidLine, Qt.RoundCap))
    p.drawLine(QPointF(tip.x() + dx * 0.02, tip.y() + dy * 0.02), QPointF(tip.x() + dx * 0.5, tip.y() + dy * 0.5))
    p.setCompositionMode(QPainter.CompositionMode_SourceOver)


def raspberry(p, c):
    """Himbeere wie im Original: fein gepunkteter Körper, ausgesparte Beeren, Blättchen mit Stiel."""
    beads = [(-24, -36), (24, -36), (-44, 2), (0, -2), (44, 2), (-24, 38), (24, 38), (0, 68)]
    body = QPainterPath()
    for x, y in beads:  # Außenumriss: alle Beeren vereinigt
        bead = QPainterPath()
        bead.addEllipse(QPointF(c.x() + x, c.y() + y), 29, 29)
        body = body.united(bead)
    holes = QPainterPath()
    for x, y in beads:
        hole = QPainterPath()
        hole.addEllipse(QPointF(c.x() + x, c.y() + y), 16, 16)
        holes = holes.united(hole)

    # Punktmuster im Körper, Beeren selbst bleiben frei
    p.save()
    p.setClipPath(body.subtracted(holes))
    p.setPen(Qt.NoPen)
    p.setBrush(RED)
    box = body.boundingRect()
    step = 4.4
    row = 0
    y = box.top()
    while y < box.bottom():
        x = box.left() + (step / 2 if row % 2 else 0)
        while x < box.right():
            p.drawEllipse(QPointF(x, y), 1.35, 1.35)
            x += step
        y += step * 0.87
        row += 1
    p.restore()

    p.setBrush(Qt.NoBrush)
    p.setPen(QPen(RED, 4.5, Qt.SolidLine, Qt.RoundCap, Qt.RoundJoin))
    p.drawPath(body)
    p.setPen(QPen(RED, 2.6))
    for x, y in beads:
        p.drawEllipse(QPointF(c.x() + x, c.y() + y), 16, 16)
    # Blättchen und Stiel
    p.setPen(QPen(RED, 4, Qt.SolidLine, Qt.RoundCap, Qt.RoundJoin))
    for sign in (-1, 1):
        stem = QPointF(c.x() + sign * 4, c.y() - 66)
        tip = QPointF(c.x() + sign * 62, c.y() - 100)
        path = QPainterPath(stem)
        path.quadTo(QPointF(c.x() + sign * 18, c.y() - 112), tip)
        path.quadTo(QPointF(c.x() + sign * 46, c.y() - 66), stem)
        p.drawPath(path)
        p.drawLine(stem, QPointF(c.x() + sign * 38, c.y() - 88))
    curl = QPainterPath(QPointF(c.x(), c.y() - 66))
    curl.cubicTo(QPointF(c.x() - 4, c.y() - 96), QPointF(c.x() - 22, c.y() - 112), QPointF(c.x() - 34, c.y() - 108))
    p.drawPath(curl)


def main():
    text = "--no-text" not in sys.argv
    out = next((a for a in sys.argv[1:] if not a.startswith("--")), str(ROOT / "logos" / "raspitv-boot.png"))
    app = QGuiApplication(sys.argv)  # noqa: F841 – muss leben, solange gezeichnet wird
    height = H if text else 470
    image = QImage(int(W * SCALE), int(height * SCALE), QImage.Format_ARGB32_Premultiplied)
    image.fill(Qt.transparent)
    p = QPainter(image)
    p.setRenderHints(QPainter.Antialiasing | QPainter.TextAntialiasing)
    p.scale(SCALE, SCALE)

    cx = W / 2
    # Blätter über dem Fernseher
    leaf(p, QPointF(cx - 5, 128), QPointF(cx - 100, 44), 40)
    leaf(p, QPointF(cx + 5, 128), QPointF(cx + 100, 44), 40)

    # Fernseher: Rahmen, Hals, Fuß
    p.setBrush(Qt.NoBrush)
    p.setPen(QPen(RED, 12, Qt.SolidLine, Qt.RoundCap, Qt.RoundJoin))
    p.drawRoundedRect(QRectF(cx - 214, 140, 428, 300), 22, 22)
    p.drawLine(QPointF(cx, 446), QPointF(cx, 462))
    p.drawLine(QPointF(cx - 106, 466), QPointF(cx + 106, 466))

    raspberry(p, QPointF(cx, 300))

    if text:  # „Raspi“ normal, „TV“ fett – wie im Original
        light, bold = QFont("Nunito Sans"), QFont("Nunito Sans")
        light.setPixelSize(106); light.setWeight(QFont.Normal)
        bold.setPixelSize(106); bold.setWeight(QFont.DemiBold)
        w1 = QFontMetricsF(light).horizontalAdvance("Raspi")
        w2 = QFontMetricsF(bold).horizontalAdvance("TV")
        x, base = cx - (w1 + w2) / 2, 608
        # Die variable Systemschrift liefert in Qt 5 als „normal“ nur ihre dünnste Stärke:
        # „Raspi“ daher als Umriss zeichnen und gleichmäßig verdicken
        raspi = QPainterPath()
        raspi.addText(QPointF(x, base), light, "Raspi")
        p.setPen(QPen(WHITE, 3.2, Qt.SolidLine, Qt.RoundCap, Qt.RoundJoin))
        p.setBrush(WHITE)
        p.drawPath(raspi)
        tv = QPainterPath()  # „TV“ deutlich kräftiger
        tv.addText(QPointF(x + w1 + 4, base), bold, "TV")
        p.setPen(QPen(WHITE, 7, Qt.SolidLine, Qt.RoundCap, Qt.MiterJoin))
        p.drawPath(tv)
    p.end()
    image.save(out)
    print(out)


if __name__ == "__main__":
    main()
