// Kachel einer App. Die gewählte Kachel wächst (und schiebt in der Reihe ihre Nachbarn zur Seite).
import QtQuick 2.15
import QtGraphicalEffects 1.15

Item {
    id: tile
    property var app_
    property bool focused: false
    property bool store: false          // Kachel in „Verfügbare Apps“: gedämpft, mit „+“
    property bool lifted: false         // wird gerade verschoben

    property real f: focused ? 1 : 0    // Fokus 0..1, weich animiert
    Behavior on f { NumberAnimation { duration: app.ms(220); easing.type: Easing.OutCubic } }
    readonly property real s: 1 + (app.focusScale - 1) * f
    readonly property real radius: 0.9 * app.u

    width: app.tileW * s
    height: app.tileH * app.focusScale

    Item {
        id: body
        width: parent.width
        height: app.tileH * tile.s
        anchors.verticalCenter: parent.verticalCenter
        anchors.verticalCenterOffset: tile.lifted ? -app.u : 0
        Behavior on anchors.verticalCenterOffset { NumberAnimation { duration: app.ms(150) } }

        // weicher Farbschein unter der gewählten Kachel
        RectangularGlow {
            anchors.fill: parent
            anchors.topMargin: 0.5 * app.u
            visible: tile.f > 0.02
            glowRadius: 1.6 * app.u
            spread: 0.15
            cornerRadius: tile.radius + glowRadius
            color: app.alpha(tile.app_.accent, 0.45 * tile.f)
        }
        Rectangle {
            id: face
            anchors.fill: parent
            radius: tile.radius
            gradient: Gradient {
                orientation: Gradient.Horizontal
                GradientStop { position: 0; color: tile.app_.bg[0] }
                GradientStop { position: 1; color: tile.app_.bg[tile.app_.bg.length - 1] }
            }
        }
        Rectangle {  // leichter Glanz von oben
            anchors.fill: parent
            radius: tile.radius
            gradient: Gradient {
                GradientStop { position: 0; color: Qt.rgba(1, 1, 1, 0.10) }
                GradientStop { position: 0.5; color: Qt.rgba(1, 1, 1, 0) }
            }
        }
        Image {
            id: logo
            anchors.centerIn: parent
            visible: source != ""
            source: tile.app_.logo
            // einmal in Fokusgröße laden und nur verkleinert zeigen
            readonly property real boxW: app.tileW * app.focusScale * 0.66
            readonly property real boxH: app.tileH * app.focusScale * 0.5
            sourceSize.width: boxW
            sourceSize.height: boxH
            width: boxW * tile.s / app.focusScale
            height: boxH * tile.s / app.focusScale
            fillMode: Image.PreserveAspectFit
            smooth: true
            mipmap: true
            asynchronous: false
        }
        Label {
            visible: !logo.visible
            anchors.centerIn: parent
            width: parent.width * 0.8
            horizontalAlignment: Text.AlignHCenter
            fontSizeMode: Text.HorizontalFit
            minimumPixelSize: 8
            text: tile.app_.name
            size: 1.55 * app.u * tile.s * app.tileW / (13.5 * app.u)
            weight: Font.ExtraBold
            color: tile.app_.fg
            elide: Text.ElideNone
        }
        Rectangle {  // Store: gedämpft, bis gewählt
            anchors.fill: parent
            radius: tile.radius
            visible: tile.store
            color: Qt.rgba(0, 0, 0, 0.35 * (1 - tile.f))
        }
        Rectangle {  // „+“-Plakette zum Installieren
            visible: tile.store
            width: 2 * app.u * tile.s; height: width; radius: width / 2
            x: parent.width - 1.5 * app.u * tile.s - width / 2
            y: 1.5 * app.u * tile.s - height / 2
            color: Qt.rgba(1, 1, 1, 0.85 + 0.15 * tile.f)
            Icon { anchors.centerIn: parent; width: parent.width; name: "plus"; color: app.dark }
        }
        Rectangle {  // weißer Rahmen um die gewählte Kachel
            anchors.fill: parent
            anchors.margins: -0.28 * app.u
            radius: tile.radius + 0.28 * app.u
            color: "transparent"
            border.color: "white"
            border.width: 0.16 * app.u
            opacity: tile.f
            visible: tile.f > 0.02
        }
    }

    // Pfeile links/rechts, während die Kachel verschoben wird
    Repeater {
        model: tile.lifted ? 2 : 0
        Rectangle {
            readonly property int side: index === 0 ? -1 : 1
            width: 2.6 * app.u; height: width; radius: width / 2
            color: "white"
            x: side < 0 ? -1.9 * app.u - width / 2 : tile.width + 1.9 * app.u - width / 2
            y: tile.height / 2 - app.u - height / 2
            Label {
                anchors.fill: parent
                horizontalAlignment: Text.AlignHCenter
                text: side < 0 ? "◀" : "▶"
                size: app.u
                color: app.dark
            }
        }
    }
}
