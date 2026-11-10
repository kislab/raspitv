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
        x: parent.width - app.edge - 1.3 * app.u - r
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
