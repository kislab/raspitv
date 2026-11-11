// Lautstärke-Anzeige: senkrechte Leiste links (4u vom Rand wegen TV-Overscan), erscheint bei jedem Druck auf eine
// Lautstärke-Taste und verschwindet 2,5 s danach. Gleiches Aussehen wie im Jellyfin-Player
// (jellyfin_osd.volume) und in Netflix & Co. (tv-extension/tv.js).
import QtQuick 2.15

Item {
    id: osd
    readonly property var vol: app.s.vol
    readonly property real value: vol ? vol.value : 0
    readonly property bool muted: !!vol && vol.muted
    property int seenSeq: vol ? vol.seq : 0   // Stand beim Start: nichts anzeigen
    property bool shown: false

    onVolChanged: {
        if (vol && vol.seq !== seenSeq) {
            seenSeq = vol.seq
            shown = true
            hide.restart()
        }
    }
    Timer { id: hide; interval: 2500; onTriggered: osd.shown = false }

    Item {
        id: box
        width: 4 * app.u; height: 22 * app.u
        x: 4 * app.u
        anchors.verticalCenter: parent.verticalCenter
        opacity: osd.shown ? 1 : 0
        visible: opacity > 0
        transform: Translate { x: osd.shown ? 0 : -1.2 * app.u; Behavior on x { NumberAnimation { duration: app.ms(200); easing.type: Easing.OutCubic } } }
        Behavior on opacity { NumberAnimation { duration: app.ms(osd.shown ? 120 : 350) } }

        Rectangle {   // Schatten
            y: 0.3 * app.u; width: parent.width; height: parent.height; radius: width / 2
            color: Qt.rgba(0, 0, 0, 0.3)
        }
        Rectangle {
            id: pill
            anchors.fill: parent; radius: width / 2
            color: "#14141c"
            border.color: Qt.rgba(1, 1, 1, 0.1); border.width: 1

            Label {
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.verticalCenter: parent.top; anchors.verticalCenterOffset: 2.2 * app.u
                text: osd.muted ? "–" : Math.round(osd.value)
                size: 1.3 * app.u; weight: Font.Bold
                color: osd.muted ? app.muted : "white"
            }
            // Spur und Füllstand (füllt sich von unten)
            Rectangle {
                anchors.horizontalCenter: parent.horizontalCenter
                y: 4.4 * app.u
                width: 0.5 * app.u; height: parent.height - 8.8 * app.u; radius: width / 2
                color: Qt.rgba(1, 1, 1, 0.18)
                Rectangle {
                    anchors.bottom: parent.bottom
                    width: parent.width; radius: width / 2
                    height: Math.max(osd.value > 0 ? width : 0, parent.height * osd.value / 100)
                    color: osd.muted ? Qt.rgba(1, 1, 1, 0.35) : "white"
                    Behavior on height { NumberAnimation { duration: app.ms(120); easing.type: Easing.OutCubic } }
                }
            }
            Icon {
                anchors.horizontalCenter: parent.horizontalCenter
                y: parent.height - 2.2 * app.u - height / 2
                width: 1.8 * app.u
                name: osd.muted || osd.value === 0 ? "mute" : "sound"
                color: osd.muted ? app.muted : "white"
            }
        }
    }
}
