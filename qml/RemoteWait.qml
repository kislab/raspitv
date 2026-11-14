// Hinweis, solange die gekoppelte Fernbedienung nicht verbunden ist (z. B. gleich nach dem Neustart):
// Sie verbindet sich erst, wenn man eine Taste drückt.
import QtQuick 2.15

Item {
    id: hint
    readonly property bool on: !!app.s.remoteWait
    opacity: on ? 1 : 0
    visible: opacity > 0
    Behavior on opacity { NumberAnimation { duration: app.ms(300) } }

    Rectangle { anchors.fill: parent; color: Qt.rgba(0, 0, 0, 0.55) }
    Rectangle {
        id: card
        width: 34 * app.u; height: 13.6 * app.u
        anchors.centerIn: parent
        radius: 1.4 * app.u
        color: app.card
        border.color: Qt.rgba(1, 1, 1, 0.08)

        Icon {
            id: icon
            name: "remote"
            width: 3.2 * app.u
            x: (parent.width - width) / 2; y: 1.8 * app.u
        }
        Canvas {  // Lade-Kreis um das Symbol
            width: 5.4 * app.u; height: width
            x: (parent.width - width) / 2; y: icon.y + icon.height / 2 - height / 2
            onPaint: {
                var g = getContext("2d")
                g.reset()
                g.strokeStyle = app.soft
                g.lineWidth = 0.18 * app.u
                g.lineCap = "round"
                g.beginPath()
                g.arc(width / 2, height / 2, width / 2 - g.lineWidth, 0, 1.4 * Math.PI)
                g.stroke()
            }
            RotationAnimator on rotation { from: 0; to: 360; duration: 1400; loops: Animation.Infinite; running: hint.on }
        }
        Label {
            width: parent.width; y: 7.4 * app.u; height: 2.4 * app.u
            horizontalAlignment: Text.AlignHCenter
            text: "Fernbedienung wird verbunden"
            size: 1.5 * app.u
            weight: Font.Bold
        }
        Label {
            width: parent.width; y: 10.3 * app.u; height: 2 * app.u
            horizontalAlignment: Text.AlignHCenter
            text: "Bitte eine Taste drücken und kurz warten"
            size: 1.1 * app.u
            color: app.soft
        }
    }
}
