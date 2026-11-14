// Eine Zeile in den Einstellungen: Überschrift, Schalter, Auswahl, Aktion oder Info.
import QtQuick 2.15

Item {
    id: row
    property var item
    property bool first: false
    property bool focused: false
    readonly property bool header: item.kind === "header"
    height: (header && !first ? 3.4 : 3.3) * app.u

    Label {  // Zwischenüberschrift
        visible: row.header
        x: 1.3 * app.u; width: parent.width
        height: parent.height - 0.6 * app.u
        verticalAlignment: Text.AlignBottom
        text: row.item.label.toUpperCase()
        size: 0.8 * app.u
        weight: Font.Bold
        font.letterSpacing: 0.12 * app.u
        color: app.muted
    }
    Rectangle {
        visible: !row.header
        x: -1.3 * app.u; y: 0.2 * app.u
        width: parent.width + 2.6 * app.u; height: parent.height - 0.4 * app.u
        radius: 0.9 * app.u
        // „primary“: Weiter/Fertig, sobald im Schritt etwas eingerichtet ist (Einrichtungs-Assistent) – blau
        color: row.item.primary ? (row.focused ? app.blue : Qt.rgba(0.54, 0.71, 0.97, 0.28))
                                : row.focused ? app.text : Qt.rgba(1, 1, 1, 0.05)
        Behavior on color { ColorAnimation { duration: app.ms(120) } }

        readonly property color fg: row.focused ? app.dark : app.text
        readonly property color fgSoft: row.focused ? app.dark : app.muted
        Item {
            id: inner
            anchors.fill: parent
            anchors.leftMargin: 1.5 * app.u
            anchors.rightMargin: 1.5 * app.u
        }
        Label {
            anchors.fill: inner
            anchors.rightMargin: value.implicitWidth + 2 * app.u
            text: row.item.label
            size: 1.15 * app.u
            weight: row.focused ? Font.DemiBold : Font.Normal
            color: parent.fg
        }
        Row {  // WLAN-Netz: „Verbunden“, Schloss, Signalstärke
            visible: !!row.item.wifi
            anchors.right: inner.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: 0.9 * app.u
            Rectangle {
                visible: !!row.item.wifi && row.item.wifi.active
                anchors.verticalCenter: parent.verticalCenter
                width: okLabel.implicitWidth + 3.2 * app.u; height: 1.9 * app.u; radius: height / 2
                color: row.focused ? Qt.rgba(0.06, 0.45, 0.2, 0.9) : Qt.rgba(0.5, 0.79, 0.58, 0.18)
                Rectangle {
                    x: 0.75 * app.u; anchors.verticalCenter: parent.verticalCenter
                    width: 0.6 * app.u; height: width; radius: width / 2
                    color: row.focused ? "white" : "#81c995"
                }
                Label {
                    id: okLabel
                    x: 1.8 * app.u; anchors.verticalCenter: parent.verticalCenter
                    text: "Verbunden"
                    size: 0.9 * app.u
                    weight: Font.DemiBold
                    color: row.focused ? "white" : "#81c995"
                }
            }
            Icon {
                visible: !!row.item.wifi && row.item.wifi.secure
                anchors.verticalCenter: parent.verticalCenter
                width: 1.15 * app.u
                name: "lock"
                color: row.focused ? app.dark : app.muted
                hole: row.focused ? app.text : app.dark
            }
            Icon {
                anchors.verticalCenter: parent.verticalCenter
                width: 1.6 * app.u
                name: "wifi"
                level: row.item.wifi ? row.item.wifi.level : 4
                color: row.focused ? app.dark : app.text
            }
        }
        Label {
            id: value
            anchors.fill: inner
            horizontalAlignment: Text.AlignRight
            visible: row.item.kind !== "toggle" && !row.item.wifi
            size: row.item.kind === "action" && (row.item.hint === null || row.item.hint === undefined) ? 1.5 * app.u : 1.05 * app.u
            color: parent.fgSoft
            text: {
                var k = row.item.kind
                if (k === "choice" || k === "range") return row.focused ? "‹  " + row.item.value + "  ›" : row.item.value
                if (k === "info") return row.item.value
                if (k === "action") return row.item.hint !== null && row.item.hint !== undefined ? row.item.hint : "›"
                return ""
            }
        }
        Switch {
            visible: row.item.kind === "toggle"
            anchors.right: inner.right
            anchors.verticalCenter: parent.verticalCenter
            on: !!row.item.on
            focused: row.focused
        }
    }
}
