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
        color: row.focused ? app.text : Qt.rgba(1, 1, 1, 0.05)
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
        Label {
            id: value
            anchors.fill: inner
            horizontalAlignment: Text.AlignRight
            visible: row.item.kind !== "toggle"
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
