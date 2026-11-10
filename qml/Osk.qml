// Bildschirmtastatur für Namen und PIN.
import QtQuick 2.15

Item {
    id: osk
    readonly property var o: app.s.osk
    readonly property bool pin: !!o && o.mode === "pin"
    readonly property var rows: o ? o.rows : []
    readonly property real keyW: (pin ? 5.2 : 3.6) * app.u
    readonly property real keyH: 3 * app.u
    readonly property real gapK: 0.5 * app.u

    function keyWidth(label) { return keyW * (label.length > 1 && !pin ? 3.2 : 1) }
    function rowWidth(r) {
        var w = 0
        for (var i = 0; i < rows[r].length; i++) w += keyWidth(rows[r][i])
        return w + gapK * (rows[r].length - 1)
    }
    readonly property real widest: {
        var m = 0
        for (var r = 0; r < rows.length; r++) m = Math.max(m, rowWidth(r))
        return m
    }

    Rectangle { anchors.fill: parent; color: Qt.rgba(0, 0, 0, 0.78) }
    Rectangle {
        id: cardBox
        width: Math.max(osk.widest + 6 * app.u, 40 * app.u)
        height: 12 * app.u + osk.rows.length * (osk.keyH + osk.gapK)
        anchors.centerIn: parent
        radius: 1.6 * app.u
        color: app.card

        Label {
            width: parent.width; y: 1.6 * app.u; height: 2.4 * app.u
            horizontalAlignment: Text.AlignHCenter
            text: osk.o ? osk.o.title : ""
            size: 1.5 * app.u; weight: Font.DemiBold; color: "white"
        }

        // Eingabe: vier Felder für die PIN, sonst ein Textfeld mit blinkendem Strich
        Row {
            visible: osk.pin
            anchors.horizontalCenter: parent.horizontalCenter
            y: 4.6 * app.u
            spacing: 1.2 * app.u
            Repeater {
                model: 4
                Rectangle {
                    readonly property int filled: osk.o ? osk.o.value.length : 0
                    width: 3 * app.u; height: width; radius: 0.5 * app.u
                    color: Qt.rgba(1, 1, 1, 0.07)
                    border.width: 0.15 * app.u
                    border.color: index === filled ? app.text : Qt.rgba(1, 1, 1, 0.24)
                    Rectangle {
                        visible: index < parent.filled
                        anchors.centerIn: parent
                        width: app.u; height: width; radius: width / 2
                        color: app.text
                    }
                }
            }
        }
        Rectangle {
            visible: !osk.pin
            x: 3 * app.u; y: 4.6 * app.u
            width: parent.width - 6 * app.u; height: 3 * app.u
            radius: 0.6 * app.u
            color: Qt.rgba(1, 1, 1, 0.09)
            Row {
                x: 1.2 * app.u
                anchors.verticalCenter: parent.verticalCenter
                Label { text: osk.o ? osk.o.value : ""; size: 1.4 * app.u; color: "white"; elide: Text.ElideNone }
                Rectangle {
                    width: 0.12 * app.u; height: 1.8 * app.u
                    anchors.verticalCenter: parent.verticalCenter
                    color: "white"
                    SequentialAnimation on opacity {
                        running: osk.visible && !osk.pin
                        loops: Animation.Infinite
                        NumberAnimation { to: 1; duration: 0 }
                        PauseAnimation { duration: 600 }
                        NumberAnimation { to: 0; duration: 0 }
                        PauseAnimation { duration: 600 }
                    }
                }
            }
        }
        Label {
            visible: !!osk.o && osk.o.error !== ""
            width: parent.width; y: 7.9 * app.u; height: 1.8 * app.u
            horizontalAlignment: Text.AlignHCenter
            text: osk.o ? osk.o.error : ""
            size: app.u; color: "#f28b82"
        }

        Column {
            y: 10 * app.u
            anchors.horizontalCenter: parent.horizontalCenter
            spacing: osk.gapK
            Repeater {
                model: osk.rows.length
                Row {
                    readonly property int r: index
                    anchors.horizontalCenter: parent.horizontalCenter
                    spacing: osk.gapK
                    Repeater {
                        model: osk.rows[parent.r].length
                        Rectangle {
                            readonly property string label: osk.rows[parent.r][index]
                            readonly property bool focused: osk.o && parent.r === osk.o.row && index === osk.o.col
                            width: osk.keyWidth(label); height: osk.keyH
                            radius: 0.6 * app.u
                            color: focused ? app.text : Qt.rgba(1, 1, 1, 0.1)
                            Label {
                                anchors.centerIn: parent
                                text: parent.label
                                size: 1.2 * app.u
                                weight: Font.DemiBold
                                color: parent.focused ? app.dark : app.text
                            }
                        }
                    }
                }
            }
        }
    }
}
