#!/usr/bin/env python3
"""Zeichnet das RaspiTV-Logo (Blätter, Fernseher mit Himbeere, Schriftzug) mit durchsichtigem
Hintergrund nach logos/raspitv-boot.png – das Bild für den Bootbildschirm.

    python3 boot/make-logo.py [--no-text] [ausgabe.png]

Koordinaten in „Logo-Einheiten“ (Fernseher 440 breit); SCALE bestimmt die Pixelgröße.
"""
import math
import sys
from pathlib import Path

from PyQt5.QtCore import QPointF, QRectF, Qt
from PyQt5.QtGui import (QBrush, QColor, QFont, QFontMetricsF, QGuiApplication, QImage, QPainter,
                         QPainterPath, QPen)

ROOT = Path(__file__).resolve().parent.parent
RED = QColor("#c9384f")
GREEN = QColor("#6aad45")
WHITE = QColor("#eceef0")
SCALE = 2.0                    # 1 Einheit = 2 Pixel
W, H = 480, 640                # Zeichenfläche in Einheiten (mit Schrift)


def leaf(p, tip, top, width):
    """Blatt von der Spitze unten (`tip`) zum oberen Ende (`top`), mit ausgespartem Mittelschlitz."""
    dx, dy = top.x() - tip.x(), top.y() - tip.y()
    length = math.hypot(dx, dy)
    nx, ny = -dy / length * width, dx / length * width       # Querrichtung
    mid1 = QPointF(tip.x() + dx * 0.35 + nx, tip.y() + dy * 0.35 + ny)
    mid2 = QPointF(tip.x() + dx * 0.35 - nx, tip.y() + dy * 0.35 - ny)
    path = QPainterPath(tip)
    path.cubicTo(mid1, QPointF(top.x() + nx * 0.9, top.y() + ny * 0.9), top)
    path.cubicTo(QPointF(top.x() - nx * 0.9, top.y() - ny * 0.9), mid2, tip)
    p.setPen(Qt.NoPen)
    p.setBrush(GREEN)
    p.drawPath(path)
    # Schlitz entlang der Mittelrippe (durchsichtig)
    p.setCompositionMode(QPainter.CompositionMode_Clear)
    p.setPen(QPen(Qt.black, 7, Qt.SolidLine, Qt.RoundCap))
    p.drawLine(QPointF(tip.x() + dx * 0.12, tip.y() + dy * 0.12), QPointF(tip.x() + dx * 0.52, tip.y() + dy * 0.52))
    p.setCompositionMode(QPainter.CompositionMode_SourceOver)


def raspberry(p, c):
    """Himbeere aus Kreisen (Umriss + einzelne Beeren) mit zwei Blättchen obendrauf."""
    beads = [(-24, -36), (24, -36), (-44, 2), (0, -2), (44, 2), (-24, 38), (24, 38), (0, 68)]
    body = QPainterPath()
    for x, y in beads:  # Außenumriss: alle Beeren vereinigt
        bead = QPainterPath()
        bead.addEllipse(QPointF(c.x() + x, c.y() + y), 29, 29)
        body = body.united(bead)
    p.setBrush(QColor(RED.red(), RED.green(), RED.blue(), 60))
    p.setPen(QPen(RED, 5.5, Qt.SolidLine, Qt.RoundCap, Qt.RoundJoin))
    p.drawPath(body)
    p.setBrush(Qt.NoBrush)
    p.setPen(QPen(RED, 4))
    for x, y in beads:
        p.drawEllipse(QPointF(c.x() + x, c.y() + y), 16, 16)
    # Blättchen und Stiel
    p.setPen(QPen(RED, 4.5, Qt.SolidLine, Qt.RoundCap, Qt.RoundJoin))
    for sign in (-1, 1):
        stem = QPointF(c.x() + sign * 4, c.y() - 66)
        tip = QPointF(c.x() + sign * 62, c.y() - 100)
        path = QPainterPath(stem)
        path.quadTo(QPointF(c.x() + sign * 18, c.y() - 112), tip)
        path.quadTo(QPointF(c.x() + sign * 46, c.y() - 66), stem)
        p.drawPath(path)
        p.drawLine(stem, QPointF(c.x() + sign * 38, c.y() - 88))
    curl = QPainterPath(QPointF(c.x(), c.y() - 66))
    curl.quadTo(QPointF(c.x() - 10, c.y() - 100), QPointF(c.x() - 22, c.y() - 112))
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
    leaf(p, QPointF(cx - 6, 126), QPointF(cx - 96, 38), 34)
    leaf(p, QPointF(cx + 6, 126), QPointF(cx + 96, 38), 34)

    # Fernseher: Rahmen, Hals, Fuß
    p.setBrush(Qt.NoBrush)
    p.setPen(QPen(RED, 11, Qt.SolidLine, Qt.RoundCap, Qt.RoundJoin))
    p.drawRoundedRect(QRectF(cx - 214, 140, 428, 300), 22, 22)
    p.drawLine(QPointF(cx, 446), QPointF(cx, 462))
    p.drawLine(QPointF(cx - 106, 466), QPointF(cx + 106, 466))

    raspberry(p, QPointF(cx, 300))

    if text:  # „Raspi“ dünn, „TV“ kräftig
        light, bold = QFont("Nunito Sans"), QFont("Nunito Sans")
        light.setPixelSize(118); light.setWeight(QFont.Light)
        bold.setPixelSize(118); bold.setWeight(QFont.Bold)
        w1 = QFontMetricsF(light).horizontalAdvance("Raspi")
        w2 = QFontMetricsF(bold).horizontalAdvance("TV")
        x, base = cx - (w1 + w2) / 2, 608
        p.setPen(WHITE)
        p.setFont(light); p.drawText(QPointF(x, base), "Raspi")
        p.setFont(bold); p.drawText(QPointF(x + w1, base), "TV")
    p.end()
    image.save(out)
    print(out)


if __name__ == "__main__":
    main()
