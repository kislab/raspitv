// Rückfrage/Meldung als Karte – oder der Startbildschirm eines Dienstes (Logo + Lade-Kreis).
import QtQuick 2.15
import QtGraphicalEffects 1.15

Item {
    id: dlg
    readonly property var d: app.s.dialog
    readonly property var splashApp: d && d.app ? d.app : null

    // ---------- Startbildschirm ----------
    Item {
        anchors.fill: parent
        visible: !!dlg.splashApp
        LinearGradient {
            anchors.fill: parent
            start: Qt.point(0, 0); end: Qt.point(width, height)
            gradient: Gradient {
                GradientStop { position: 0; color: dlg.splashApp ? dlg.splashApp.heroBg[0] : "black" }
                GradientStop { position: 1; color: dlg.splashApp ? dlg.splashApp.heroBg[dlg.splashApp.heroBg.length - 1] : "black" }
            }
        }
        Rectangle { anchors.fill: parent; color: Qt.rgba(0, 0, 0, 0.3) }
        Item {
            width: parent.width; height: 8 * app.u
            y: parent.height / 2 - 7 * app.u
            Image {
                id: splashLogo
                anchors.centerIn: parent
                visible: source != ""
                source: dlg.splashApp ? dlg.splashApp.heroLogo : ""
                width: dlg.width * 0.3
                height: 7 * app.u
                sourceSize.width: width
                sourceSize.height: height
                fillMode: Image.PreserveAspectFit
                smooth: true
            }
            Label {
                visible: !splashLogo.visible
                anchors.fill: parent
                horizontalAlignment: Text.AlignHCenter
                text: dlg.splashApp ? dlg.splashApp.name : ""
                size: 6 * app.u
                weight: Font.ExtraBold
                color: dlg.splashApp ? dlg.splashApp.fg : "white"
            }
        }
        Canvas {  // Lade-Kreis
            id: spinner
            width: 2.4 * app.u; height: width
            x: parent.width / 2 - width / 2
            y: parent.height / 2 + 2.1 * app.u
            onPaint: {
                var g = getContext("2d")
                g.reset()
                g.strokeStyle = "white"
                g.lineWidth = 0.22 * app.u
                g.lineCap = "round"
                g.beginPath()
                g.arc(width / 2, height / 2, width / 2 - g.lineWidth, 0, 1.5 * Math.PI)
                g.stroke()
            }
            RotationAnimator on rotation {
                from: 0; to: 360; duration: 1200; loops: Animation.Infinite
                running: !!dlg.splashApp && !app.s.covered
            }
        }
        Label {
            width: parent.width
            y: parent.height / 2 + 5.2 * app.u; height: 2 * app.u
            horizontalAlignment: Text.AlignHCenter
            text: dlg.d ? dlg.d.text : ""
            size: 1.1 * app.u
            color: app.soft
        }
    }

    // ---------- Karte mit Knöpfen ----------
    Item {
        anchors.fill: parent
        visible: !!dlg.d && !dlg.splashApp
        readonly property var buttons: dlg.d ? dlg.d.buttons : []

        Rectangle { anchors.fill: parent; color: Qt.rgba(0, 0, 0, 0.7) }
        Rectangle {
            id: cardBox
            readonly property bool hasButtons: parent.buttons.length > 0
            width: Math.max(buttonRow.width, title.implicitWidth, sub.implicitWidth, 18 * app.u) + 6 * app.u
            readonly property bool hasSub: !!dlg.d && dlg.d.sub !== ""
            height: (hasButtons ? 11.5 : 7) * app.u + (hasSub ? 2.4 * app.u : 0)
            anchors.centerIn: parent
            radius: 1.6 * app.u
            color: app.card
            Label {
                id: title
                width: parent.width
                y: (cardBox.hasButtons ? 2.4 : 2) * app.u; height: 3 * app.u
                horizontalAlignment: Text.AlignHCenter
                elide: Text.ElideNone
                text: dlg.d ? dlg.d.text : ""
                size: 1.7 * app.u
                weight: Font.DemiBold
                color: "white"
            }
            Label {
                id: sub
                visible: cardBox.hasSub
                width: parent.width
                y: title.y + 3.2 * app.u; height: 1.8 * app.u
                horizontalAlignment: Text.AlignHCenter
                elide: Text.ElideNone
                text: dlg.d ? dlg.d.sub : ""
                size: 1.0 * app.u
                color: app.soft
            }
            Row {
                id: buttonRow
                anchors.horizontalCenter: parent.horizontalCenter
                y: cardBox.height - 5 * app.u
                spacing: 0.8 * app.u
                Repeater {
                    model: cardBox.parent.buttons.length
                    Pill {
                        width: label.implicitWidth + 3.2 * app.u; height: 2.6 * app.u
                        focused: index === dlg.d.index
                        Label {
                            id: label
                            anchors.centerIn: parent
                            text: cardBox.parent.buttons[index]
                            size: 1.1 * app.u
                            weight: Font.DemiBold
                            color: parent.focused ? app.dark : app.text
                        }
                    }
                }
            }
        }
    }
}
