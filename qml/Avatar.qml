// Konto-Kreis mit Anfangsbuchstabe; bei Fokus ein weißer Ring.
import QtQuick 2.15

Item {
    id: avatar
    property var account
    property real r: 1.2 * app.u        // Radius
    property real f: 0                  // Fokus 0..1
    width: 2 * r; height: width

    Rectangle {
        anchors.centerIn: parent
        width: 2 * (avatar.r + 0.3 * app.u * avatar.f); height: width; radius: width / 2
        color: "white"
        opacity: avatar.f
        visible: avatar.f > 0.02
    }
    Rectangle {
        anchors.centerIn: parent
        width: 2 * avatar.r; height: width; radius: width / 2
        color: avatar.account ? avatar.account.color : app.blue
        Label {
            anchors.fill: parent
            horizontalAlignment: Text.AlignHCenter
            text: avatar.account ? avatar.account.initial : ""
            size: avatar.r * 1.05
            weight: Font.Bold
            color: "white"
        }
    }
}
