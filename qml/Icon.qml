// Kleine Strich- und Flächen-Symbole (einmal gezeichnet, danach von der Grafikeinheit gezeigt).
import QtQuick 2.15

Canvas {
    id: icon
    property string name
    property color color: app.text
    property color hole: app.dark      // Farbe für Aussparungen (Zahnrad-Mitte, Schloss)
    width: app.u * 1.5; height: width
    renderStrategy: Canvas.Immediate
    onColorChanged: requestPaint()
    onHoleChanged: requestPaint()
    onNameChanged: requestPaint()
    onWidthChanged: requestPaint()

    onPaint: {
        var g = getContext("2d")
        g.reset()
        var s = width, r = s / 2, x = s / 2, y = s / 2
        g.strokeStyle = color
        g.fillStyle = color
        g.lineWidth = 0.11 * s
        g.lineCap = "round"
        g.lineJoin = "round"
        function rrect(rx, ry, w, h, rad) {
            g.beginPath(); g.moveTo(rx + rad, ry); g.arcTo(rx + w, ry, rx + w, ry + h, rad)
            g.arcTo(rx + w, ry + h, rx, ry + h, rad); g.arcTo(rx, ry + h, rx, ry, rad)
            g.arcTo(rx, ry, rx + w, ry, rad); g.closePath()
        }
        function line(x1, y1, x2, y2) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke() }
        if (name === "account") {
            g.beginPath(); g.arc(x, y - 0.32 * r, 0.36 * r, 0, 2 * Math.PI); g.stroke()
            g.beginPath(); g.ellipse(x - 0.75 * r, y + 0.15 * r, 1.5 * r, 1.4 * r)
            g.save(); g.beginPath(); g.rect(0, 0, s, y + 0.85 * r); g.clip()
            g.beginPath(); g.ellipse(x - 0.75 * r, y + 0.15 * r, 1.5 * r, 1.4 * r); g.stroke(); g.restore()
        } else if (name === "display") {
            rrect(x - r * 0.95, y - 0.7 * r, 1.9 * r, 1.25 * r, 0.15 * r); g.stroke()
            line(x - 0.45 * r, y + 0.85 * r, x + 0.45 * r, y + 0.85 * r)
        } else if (name === "apps") {
            for (var dx = -1; dx <= 1; dx += 2)
                for (var dy = -1; dy <= 1; dy += 2) {
                    rrect(x + dx * 0.5 * r - 0.36 * r, y + dy * 0.5 * r - 0.36 * r, 0.72 * r, 0.72 * r, 0.15 * r); g.stroke()
                }
        } else if (name === "server") {
            for (var k = -1; k <= 1; k += 2) {
                var top = y + k * 0.45 * r - 0.38 * r
                rrect(x - 0.9 * r, top, 1.8 * r, 0.76 * r, 0.15 * r); g.stroke()
                g.beginPath(); g.arc(x + 0.55 * r, top + 0.38 * r, 0.06 * s, 0, 2 * Math.PI); g.fill()
            }
        } else if (name === "sound") {
            g.beginPath()
            g.moveTo(x - 0.9 * r, y - 0.3 * r); g.lineTo(x - 0.5 * r, y - 0.3 * r); g.lineTo(x - 0.05 * r, y - 0.75 * r)
            g.lineTo(x - 0.05 * r, y + 0.75 * r); g.lineTo(x - 0.5 * r, y + 0.3 * r); g.lineTo(x - 0.9 * r, y + 0.3 * r)
            g.closePath(); g.stroke()
            g.beginPath(); g.arc(x + 0.2 * r, y, 0.45 * r, -0.87, 0.87); g.stroke()
            g.beginPath(); g.arc(x + 0.25 * r, y, 0.8 * r, -0.87, 0.87); g.stroke()
        } else if (name === "power") {
            g.beginPath(); g.arc(x, y + 0.1 * r, 0.8 * r, -Math.PI / 2 + 0.55, -Math.PI / 2 - 0.55 + 2 * Math.PI); g.stroke()
            line(x, y - 0.95 * r, x, y - 0.1 * r)
        } else if (name === "info") {
            g.beginPath(); g.arc(x, y, 0.9 * r, 0, 2 * Math.PI); g.stroke()
            line(x, y - 0.05 * r, x, y + 0.45 * r)
            g.beginPath(); g.arc(x, y - 0.42 * r, 0.07 * s, 0, 2 * Math.PI); g.fill()
        } else if (name === "gear") {
            g.translate(x, y)
            var gr = 0.39 * s   // wie früher: Zähne bis 0,62 u bei 1,6 u Symbolgröße
            for (var i = 0; i < 8; i++) {
                g.rotate(Math.PI / 4)
                rrect(-0.17 * gr, -gr, 0.34 * gr, 0.5 * gr, 0.08 * gr); g.fill()
            }
            g.beginPath(); g.arc(0, 0, 0.72 * gr, 0, 2 * Math.PI); g.fill()
            g.fillStyle = hole
            g.beginPath(); g.arc(0, 0, 0.32 * gr, 0, 2 * Math.PI); g.fill()
        } else if (name === "plus") {
            line(x - 0.5 * r, y, x + 0.5 * r, y)
            line(x, y - 0.5 * r, x, y + 0.5 * r)
        } else if (name === "lock") {
            g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI); g.fill()
            g.fillStyle = hole; g.strokeStyle = hole; g.lineWidth = 0.08 * s
            rrect(x - 0.47 * r, y - 0.1 * r, 0.94 * r, 0.68 * r, 0.1 * r); g.fill()
            g.beginPath(); g.arc(x, y - 0.18 * r, 0.3 * r, Math.PI, 2 * Math.PI); g.stroke()
        }
    }
}
