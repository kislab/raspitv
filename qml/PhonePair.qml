// „Handy verbinden“: QR-Code mit der Adresse der Handy-Fernbedienung (phone.py) und der Kopplungscode.
// Der Code gilt nur, solange diese Seite offen ist; sobald ein Handy gekoppelt hat, schließt sie sich.
import QtQuick 2.15

Item {
    id: pair
    readonly property var p: app.s.phone
    visible: !!p

    Rectangle { anchors.fill: parent; color: Qt.rgba(0, 0, 0, 0.75) }
    Rectangle {
        id: box
        width: 52 * app.u; height: 24 * app.u
        anchors.centerIn: parent
        radius: 1.6 * app.u
        color: app.card

        Rectangle {  // QR-Code auf weißem Grund (mit Ruhezone)
            id: qrBox
            x: 2.5 * app.u; y: 2.5 * app.u
            width: 19 * app.u; height: width
            radius: 0.8 * app.u
            color: "white"
            visible: !!pair.p && pair.p.qr.length > 0
            Canvas {
                id: qr
                anchors.fill: parent
                anchors.margins: 1.2 * app.u
                property var rows: pair.p ? pair.p.qr : []
                onRowsChanged: requestPaint()
                onPaint: {
                    var g = getContext("2d")
                    g.reset()
                    var n = rows.length
                    if (!n) return
                    var cell = Math.floor(width / n)
                    var off = Math.floor((width - cell * n) / 2)
                    g.fillStyle = "black"
                    for (var y = 0; y < n; y++)
                        for (var x = 0; x < n; x++)
                            if (rows[y][x] === "1") g.fillRect(off + x * cell, off + y * cell, cell, cell)
                }
            }
        }
        Column {
            x: qrBox.visible ? qrBox.x + qrBox.width + 2.5 * app.u : 3 * app.u
            y: 2.6 * app.u
            width: box.width - x - 2.5 * app.u
            spacing: 0.5 * app.u
            Label {
                text: "Handy als Fernbedienung"
                size: 1.7 * app.u
                weight: Font.DemiBold
                color: "white"
            }
            Label {
                width: parent.width
                text: "Handy ins selbe WLAN, QR-Code scannen oder öffnen:"
                size: 1.0 * app.u
                color: app.soft
            }
            Label {
                text: pair.p ? pair.p.url : ""
                size: 1.25 * app.u
                weight: Font.DemiBold
                color: app.blue
            }
            Item { width: 1; height: 1.2 * app.u }
            Label {
                text: "Code am Handy eingeben:"
                size: 1.0 * app.u
                color: app.soft
            }
            Row {
                spacing: 0.6 * app.u
                Repeater {
                    model: pair.p ? pair.p.code.split("") : []
                    Rectangle {
                        width: 3.4 * app.u; height: 4.2 * app.u
                        radius: 0.7 * app.u
                        color: app.panel
                        Label {
                            anchors.centerIn: parent
                            text: modelData
                            size: 2.4 * app.u
                            weight: Font.Bold
                            color: "white"
                        }
                    }
                }
            }
        }
        Label {
            x: qrBox.visible ? qrBox.x + qrBox.width + 2.5 * app.u : 3 * app.u
            y: box.height - 3.4 * app.u
            text: "Der Code gilt nur, solange diese Seite offen ist  ·  Zurück = Schließen"
            size: 0.85 * app.u
            color: app.muted
        }
    }
}
