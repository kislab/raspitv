// Bildschirmschoner: schwarz mit Uhr und Datum, die alle 20 s die Stelle wechseln (kein Einbrennen).
// "off": nur schwarz – der Bildschirm ist dann ausgeschaltet bzw. wird gleich ausgeschaltet.
import QtQuick 2.15

Rectangle {
    id: saver
    readonly property string mode: app.s.saver || ""
    color: "black"
    opacity: mode ? 1 : 0
    visible: opacity > 0
    Behavior on opacity { NumberAnimation { duration: app.ms(saver.mode ? 1200 : 250) } }

    property date now: new Date()
    Timer { interval: 1000; running: saver.mode === "clock"; repeat: true; onTriggered: saver.now = new Date() }

    function move() {
        block.x = app.edge + Math.random() * Math.max(0, saver.width - block.width - 2 * app.edge)
        block.y = app.edge + Math.random() * Math.max(0, saver.height - block.height - 2 * app.edge)
    }
    Timer { interval: 20000; running: saver.mode === "clock"; repeat: true; onTriggered: saver.move() }
    onModeChanged: if (mode === "clock") move()

    Column {
        id: block
        visible: saver.mode === "clock"
        spacing: 0.2 * app.u
        Behavior on x { NumberAnimation { duration: app.ms(1500); easing.type: Easing.InOutSine } }
        Behavior on y { NumberAnimation { duration: app.ms(1500); easing.type: Easing.InOutSine } }
        Label {
            anchors.horizontalCenter: parent.horizontalCenter
            text: Qt.formatTime(saver.now, app.s.clock24 ? "HH:mm" : "h:mm AP")
            size: 6 * app.u
            weight: Font.Light
            color: Qt.rgba(1, 1, 1, 0.75)
        }
        Label {
            anchors.horizontalCenter: parent.horizontalCenter
            text: saver.now.toLocaleDateString(Qt.locale("de_DE"), "dddd, d. MMMM")
            size: 1.4 * app.u
            color: Qt.rgba(1, 1, 1, 0.45)
        }
    }
}
