// Kopfzeile: Konto ganz links, Uhr und Datum, Schriftzug in der Mitte, Zahnrad rechts.
import QtQuick 2.15

Item {
    id: header
    property bool focusActive: false
    readonly property var s: app.s
    readonly property real y0: 1.5 * app.u
    readonly property real h: 2.6 * app.u
    height: y0 + h

    property real avatarF: focusActive && s.row === 0 && s.headCol === 0 ? 1 : 0
    property real gearF: focusActive && s.row === 0 && s.headCol === 1 ? 1 : 0
    Behavior on avatarF { NumberAnimation { duration: app.ms(220); easing.type: Easing.OutCubic } }
    Behavior on gearF { NumberAnimation { duration: app.ms(220); easing.type: Easing.OutCubic } }

    property date now: new Date()
    Timer { interval: 1000; running: !s.covered; repeat: true; onTriggered: header.now = new Date() }

    Avatar {
        id: avatar
        account: s.account
        r: (1.2 + 0.15 * header.avatarF) * app.u
        f: header.avatarF
        x: app.edge + 1.2 * app.u - r
        y: header.y0 + header.h / 2 - r
    }
    Label {  // Name erscheint, wenn das Konto gewählt ist, und schiebt die Uhr weiter
        id: name
        x: app.edge + 3.4 * app.u
        y: header.y0; height: header.h
        text: s.account.name
        size: app.u
        weight: Font.DemiBold
        opacity: header.avatarF
        visible: opacity > 0.05
    }
    Label {
        id: clock
        x: app.edge + 3.6 * app.u + (name.implicitWidth + 1.2 * app.u) * header.avatarF
        y: header.y0; height: header.h
        text: Qt.formatTime(header.now, s.clock24 ? "HH:mm" : "h:mm AP")
        size: 1.7 * app.u
        weight: Font.DemiBold
        color: "white"
    }
    Label {
        x: clock.x + clock.implicitWidth + 0.9 * app.u
        y: header.y0 + 0.1 * app.u; height: header.h
        text: header.now.toLocaleDateString(Qt.locale("de_DE"), "dddd, d. MMMM")
        size: app.u
        color: app.soft
    }
    Label {
        width: parent.width
        y: header.y0; height: header.h
        horizontalAlignment: Text.AlignHCenter
        text: "RaspiTV"
        size: 1.7 * app.u
        weight: Font.ExtraBold
        color: "white"
    }

    // Zahnrad: Einstellungen
    Rectangle {
        id: gear
        readonly property real r: (1.3 + 0.15 * header.gearF) * app.u
        width: 2 * r; height: width; radius: r
        // ganz rechts sitzt das Fernbedienungs-Symbol (falls gekoppelt), das Zahnrad links daneben
        x: parent.width - app.edge - 1.3 * app.u - r - (remoteState.visible ? remoteState.width + 1.0 * app.u : 0)
        y: header.y0 + header.h / 2 - r
        color: Qt.rgba(1 - (1 - 232 / 255) * header.gearF, 1 - (1 - 234 / 255) * header.gearF,
                       1 - (1 - 237 / 255) * header.gearF, (36 + (255 - 36) * header.gearF) / 255)
        Icon {
            anchors.centerIn: parent
            width: 1.6 * app.u
            name: "gear"
            color: header.gearF > 0.5 ? app.dark : app.text
            hole: header.gearF > 0.5 ? "#e8eaed" : "#3a3d42"
        }
    }
    // WLAN: Symbol + Netzname links vom Zahnrad. Ist das Zahnrad gewählt, rückt es vor die
    // Beschriftung „Einstellungen“; lange Namen werden gekürzt und reichen nie bis zur Mitte.
    Item {
        id: wifi
        visible: s.wifiName !== ""
        readonly property real labelW: settingsLabel.implicitWidth + 1.2 * app.u
        width: wifiIcon.width + 0.5 * app.u + wifiName.width
        height: header.h
        x: gear.x - 1.2 * app.u - width - labelW * header.gearF
        y: header.y0
        Icon {
            id: wifiIcon
            name: "wifi"
            width: 1.3 * app.u
            anchors.verticalCenter: parent.verticalCenter
            color: app.soft
        }
        Label {
            id: wifiName
            x: wifiIcon.width + 0.5 * app.u
            width: Math.min(implicitWidth, 11 * app.u)
            height: parent.height
            text: s.wifiName
            size: 0.95 * app.u
            color: app.soft
        }
    }
    // Fernbedienung: Symbol rechts neben dem Zahnrad – hell = verbunden, gedämpft und durchgestrichen = getrennt
    // daneben der Akkustand, falls die Fernbedienung ihn meldet (rot, wenn fast leer)
    Item {
        id: remoteState
        readonly property var r: s.remote
        readonly property bool hasBattery: !!r && r.battery !== null && r.battery !== undefined
        visible: !!r
        width: 1.6 * app.u + (hasBattery ? battery.implicitWidth + 0.3 * app.u : 0)
        height: header.h
        x: parent.width - app.edge - width
        y: header.y0
        opacity: r && r.connected ? 1 : 0.45
        Behavior on opacity { NumberAnimation { duration: app.ms(200) } }
        Label {
            id: battery
            visible: remoteState.hasBattery
            height: parent.height
            text: remoteState.hasBattery ? remoteState.r.battery + " %" : ""
            size: 0.95 * app.u
            weight: remoteState.r && remoteState.r.low ? Font.Bold : Font.Normal
            color: remoteState.r && remoteState.r.low ? "#f28b82" : app.soft
        }
        Icon {
            id: remoteIcon
            anchors.verticalCenter: parent.verticalCenter
            anchors.right: parent.right
            anchors.rightMargin: 0.05 * app.u
            width: 1.5 * app.u
            name: "remote"
            color: remoteState.r && remoteState.r.connected ? app.text : app.soft
        }
        Rectangle {  // Querstrich, solange getrennt
            visible: !!remoteState.r && !remoteState.r.connected
            anchors.centerIn: remoteIcon
            width: 1.8 * app.u; height: 0.13 * app.u; radius: height / 2
            rotation: -45
            color: app.soft
        }
    }
    // Sleep-Timer läuft: Mond + verbleibende Minuten links vom WLAN
    Item {
        id: sleepState
        visible: s.sleep > 0
        width: moon.width + 0.4 * app.u + sleepText.implicitWidth
        height: header.h
        x: (wifi.visible ? wifi.x : gear.x - wifi.labelW * header.gearF) - 1.5 * app.u - width
        y: header.y0
        Icon {
            id: moon
            name: "moon"
            width: 1.2 * app.u
            anchors.verticalCenter: parent.verticalCenter
            color: app.blue
        }
        Label {
            id: sleepText
            x: moon.width + 0.4 * app.u
            height: parent.height
            text: s.sleep + " Min"
            size: 0.95 * app.u
            color: app.soft
        }
    }
    Label {
        id: settingsLabel
        x: gear.x - 0.6 * app.u - 12 * app.u; width: 12 * app.u
        y: header.y0; height: header.h
        horizontalAlignment: Text.AlignRight
        text: "Einstellungen"
        size: app.u
        weight: Font.DemiBold
        opacity: header.gearF
        visible: opacity > 0.05
    }
}
