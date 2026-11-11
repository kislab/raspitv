// Lautstärke-Anzeige: senkrechte Kapsel am rechten Rand, erscheint bei jedem Druck auf eine
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

    Rectangle {
        id: pill
        width: 3.2 * app.u; height: 17 * app.u; radius: width / 2
        anchors.right: parent.right; anchors.rightMargin: 2.4 * app.u
        anchors.verticalCenter: parent.verticalCenter
        color: Qt.rgba(0.08, 0.08, 0.11, 0.88)
        border.color: Qt.rgba(1, 1, 1, 0.1); border.width: 1
        opacity: osd.shown ? 1 : 0
        visible: opacity > 0
        transform: Translate { x: osd.shown ? 0 : 1.2 * app.u; Behavior on x { NumberAnimation { duration: app.ms(200); easing.type: Easing.OutCubic } } }
        Behavior on opacity { NumberAnimation { duration: app.ms(osd.shown ? 120 : 350) } }

        Label {
            anchors.horizontalCenter: parent.horizontalCenter
            y: 1.0 * app.u; height: 1.6 * app.u
            text: osd.muted ? "–" : Math.round(osd.value)
            size: 1.05 * app.u; weight: Font.DemiBold
            color: osd.muted ? app.muted : "white"
        }
        // Spur und Füllstand
        Rectangle {
            id: track
            anchors.horizontalCenter: parent.horizontalCenter
            y: 3.3 * app.u
            width: 0.55 * app.u; height: parent.height - 7.4 * app.u; radius: width / 2
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
            y: parent.height - 3.3 * app.u
            width: 1.5 * app.u
            name: osd.muted || osd.value === 0 ? "mute" : "sound"
            color: osd.muted ? app.muted : "white"
        }
    }
}
