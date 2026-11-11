// Hinweis oben in der Mitte (z. B. Sleep-Timer). Gleiches Aussehen wie im Jellyfin-Player
// (jellyfin_osd.toast) und in Netflix & Co. (tv-extension: #tv-toast).
import QtQuick 2.15

Item {
    id: toast
    readonly property var t: app.s.toast
    property string message: ""
    onTChanged: if (t) message = t.text  // Text beim Ausblenden stehen lassen

    Rectangle {  // leichter Schatten
        anchors.fill: pill
        anchors.topMargin: 0.3 * app.u; anchors.bottomMargin: -0.3 * app.u
        radius: pill.radius
        color: Qt.rgba(0, 0, 0, 0.3)
        opacity: pill.opacity
        visible: pill.visible
    }
    Rectangle {
        id: pill
        width: Math.min(label.implicitWidth + 3 * app.u, parent.width - 8 * app.u)
        height: 2.6 * app.u
        radius: height / 2
        x: (parent.width - width) / 2
        y: 5.5 * app.u + (toast.t ? 0 : -app.u)  // unter der Kopfzeile
        color: "#14141c"
        border.color: Qt.rgba(1, 1, 1, 0.1)
        opacity: toast.t ? 1 : 0
        visible: opacity > 0
        Behavior on opacity { NumberAnimation { duration: app.ms(250) } }
        Behavior on y { NumberAnimation { duration: app.ms(250); easing.type: Easing.OutCubic } }
        Label {
            id: label
            anchors.centerIn: parent
            text: toast.message
            size: 1.08 * app.u
            weight: Font.Bold
            color: "white"
        }
    }
}
