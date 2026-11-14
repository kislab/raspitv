// Profilbild ändern: Hintergrundfarbe, kleines Bild oder Foto vom Handy (QR-Code). Wird sofort übernommen.
import QtQuick 2.15

Item {
    id: picker
    readonly property var a: app.s.avatarPick
    visible: !!a
    readonly property real cell: 3.9 * app.u
    readonly property real gap: 0.7 * app.u

    Rectangle { anchors.fill: parent; color: Qt.rgba(0, 0, 0, 0.75) }
    Rectangle {
        id: card
        width: grid.width + (qr.visible ? qr.width + 4 * app.u : 0) + 6 * app.u
        height: grid.y + grid.height + 2.6 * app.u
        anchors.centerIn: parent
        radius: 1.6 * app.u
        color: app.card

        Avatar {  // Vorschau
            id: preview
            x: 3 * app.u; y: 2.2 * app.u
            account: picker.a ? picker.a.account : null
            r: 2.2 * app.u
        }
        Label {
            x: preview.x + preview.width + 1.6 * app.u; y: preview.y + 0.4 * app.u; height: 2.4 * app.u
            text: "Profilbild – " + (picker.a ? picker.a.account.name : "")
            size: 1.8 * app.u; weight: Font.Bold; color: "white"
        }
        Label {
            x: preview.x + preview.width + 1.6 * app.u; y: preview.y + 2.9 * app.u; height: 1.8 * app.u
            text: "OK übernimmt sofort · Zurück schließt"
            size: 1.0 * app.u; color: app.muted
        }

        Column {
            id: grid
            x: 3 * app.u; y: 8 * app.u
            spacing: 0.5 * app.u
            Label { height: 2 * app.u; text: "HINTERGRUND"; size: 0.8 * app.u; weight: Font.Bold; color: app.muted
                    font.letterSpacing: 0.12 * app.u }
            Row {
                spacing: picker.gap
                Repeater {
                    model: picker.a ? picker.a.colors : []
                    Item {
                        readonly property bool on: picker.a.row === 0 && picker.a.col === index
                        width: picker.cell; height: picker.cell
                        Rectangle {
                            anchors.centerIn: parent
                            width: parent.width * (parent.on ? 1 : 0.82); height: width; radius: width / 2
                            color: modelData
                            border.width: parent.on ? 0.3 * app.u : 0
                            border.color: "white"
                            Behavior on width { NumberAnimation { duration: app.ms(120) } }
                        }
                        Label {  // aktuelle Farbe
                            anchors.centerIn: parent
                            visible: picker.a.account.color === modelData
                            text: "✓"; size: 1.3 * app.u; weight: Font.Bold; color: "white"
                        }
                    }
                }
            }
            Item { width: 1; height: 0.6 * app.u }
            Label { height: 2 * app.u; text: "BILD"; size: 0.8 * app.u; weight: Font.Bold; color: app.muted
                    font.letterSpacing: 0.12 * app.u }
            Grid {
                columns: picker.a ? picker.a.cols : 8
                spacing: picker.gap
                Repeater {
                    model: picker.a ? picker.a.emojis : []
                    Rectangle {
                        readonly property int r: 1 + Math.floor(index / picker.a.cols)
                        readonly property bool on: picker.a.row === r && picker.a.col === index % picker.a.cols
                        readonly property bool current: !picker.a.account.image && picker.a.account.emoji === modelData
                        width: picker.cell; height: picker.cell; radius: 1 * app.u
                        color: on ? app.text : current ? Qt.rgba(1, 1, 1, 0.16) : Qt.rgba(1, 1, 1, 0.05)
                        Text {
                            anchors.centerIn: parent
                            visible: modelData !== ""
                            text: modelData
                            font.family: "Noto Color Emoji"
                            font.pixelSize: Math.round(2 * app.u)
                        }
                        Label {  // Anfangsbuchstabe
                            anchors.centerIn: parent
                            visible: modelData === ""
                            text: picker.a.account.initial
                            size: 1.7 * app.u; weight: Font.Bold
                            color: parent.on ? app.dark : "white"
                        }
                    }
                }
            }
            Item { width: 1; height: 0.6 * app.u }
            Pill {
                width: 4 * picker.cell + 3 * picker.gap; height: 2.6 * app.u
                focused: !!picker.a && picker.a.row === 1 + Math.ceil(picker.a.emojis.length / picker.a.cols)
                Label {
                    anchors.centerIn: parent
                    text: "Fertig"; size: 1.15 * app.u; weight: Font.DemiBold
                    color: parent.focused ? app.dark : app.text
                }
            }
        }

        Column {  // Foto vom Handy
            id: qr
            visible: picker.a && picker.a.qr.length > 0
            x: grid.x + grid.width + 4 * app.u; y: 8 * app.u
            width: 14 * app.u
            spacing: 1 * app.u
            Label { height: 2 * app.u; text: "FOTO VOM HANDY"; size: 0.8 * app.u; weight: Font.Bold; color: app.muted
                    font.letterSpacing: 0.12 * app.u }
            Rectangle {
                width: parent.width; height: width; radius: 0.8 * app.u; color: "white"
                Canvas {
                    anchors.fill: parent; anchors.margins: 1.1 * app.u
                    property var rows: picker.a ? picker.a.qr : []
                    onRowsChanged: requestPaint()
                    onPaint: {
                        var g = getContext("2d")
                        g.reset()
                        var n = rows.length
                        if (!n) return
                        var c = Math.floor(width / n), off = Math.floor((width - c * n) / 2)
                        g.fillStyle = "black"
                        for (var y = 0; y < n; y++)
                            for (var x = 0; x < n; x++)
                                if (rows[y][x] === "1") g.fillRect(off + x * c, off + y * c, c, c)
                    }
                }
            }
            Text {
                width: parent.width
                text: "Mit der Handy-Kamera scannen, Foto auswählen – es erscheint gleich hier."
                font.family: app.font; font.pixelSize: Math.round(0.95 * app.u)
                color: app.soft; wrapMode: Text.WordWrap; lineHeight: 1.2
            }
            Label { height: 1.8 * app.u; text: picker.a ? picker.a.url : ""; size: 0.9 * app.u; color: app.muted }
        }
    }
}
