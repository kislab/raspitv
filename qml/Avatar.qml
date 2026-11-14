// Konto-Kreis: Foto, kleines Bild (Emoji) oder Anfangsbuchstabe auf der Kontofarbe; bei Fokus ein weißer Ring.
import QtQuick 2.15
import QtGraphicalEffects 1.15

Item {
    id: avatar
    property var account
    property real r: 1.2 * app.u        // Radius
    property real f: 0                  // Fokus 0..1
    width: 2 * r; height: width
    readonly property string image: account && account.image ? account.image : ""
    readonly property string emoji: account && account.emoji ? account.emoji : ""

    Rectangle {
        anchors.centerIn: parent
        width: 2 * (avatar.r + 0.3 * app.u * avatar.f); height: width; radius: width / 2
        color: "white"
        opacity: avatar.f
        visible: avatar.f > 0.02
    }
    Rectangle {
        id: disc
        anchors.centerIn: parent
        width: 2 * avatar.r; height: width; radius: width / 2
        color: avatar.account ? avatar.account.color : app.blue
        Label {
            anchors.fill: parent
            visible: !avatar.image && !avatar.emoji
            horizontalAlignment: Text.AlignHCenter
            text: avatar.account ? avatar.account.initial : ""
            size: avatar.r * 1.05
            weight: Font.Bold
            color: "white"
        }
        Text {
            anchors.centerIn: parent
            visible: !avatar.image && !!avatar.emoji
            text: avatar.emoji
            font.family: "Noto Color Emoji"
            font.pixelSize: Math.round(avatar.r * 1.15)
        }
    }
    Image {  // Foto, rund ausgeschnitten
        id: photo
        anchors.fill: disc
        visible: false
        source: avatar.image
        sourceSize.width: 320; sourceSize.height: 320
        fillMode: Image.PreserveAspectCrop
        smooth: true; mipmap: true
        cache: false
    }
    OpacityMask {
        anchors.fill: disc
        visible: !!avatar.image && photo.status === Image.Ready
        source: photo
        maskSource: Rectangle { width: disc.width; height: disc.height; radius: width / 2; visible: false }
    }
}
