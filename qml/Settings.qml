// Einstellungen als eigene Vollbild-Seite: links Kategorien, rechts die Zeilen der gewählten Kategorie.
import QtQuick 2.15

Item {
    id: page
    readonly property var s: app.s
    readonly property var st: s.settings
    readonly property bool open: s.view === "settings"

    opacity: open ? 1 : 0
    visible: opacity > 0
    Behavior on opacity { NumberAnimation { duration: app.ms(260); easing.type: Easing.OutCubic } }
    transform: Translate { y: (1 - page.opacity) * 2 * app.u }

    Rectangle { anchors.fill: parent; anchors.margins: -2 * app.u; color: app.bg }

    // ---------- Kategorien ----------
    readonly property real sideW: 26 * app.u
    Rectangle {
        width: page.sideW; y: -2 * app.u; height: parent.height + 4 * app.u
        color: "#15171b"
    }
    Label {
        x: 3 * app.u; y: 2.6 * app.u; height: 3.4 * app.u
        text: "Einstellungen"
        size: 2.1 * app.u
        weight: Font.DemiBold
        color: "white"
    }
    Column {
        x: 1.6 * app.u; y: 9 * app.u
        spacing: 0.4 * app.u
        Repeater {
            model: page.st.cats.length
            Pill {
                readonly property var cat: page.st.cats[index]
                readonly property bool selected: index === page.st.cat
                readonly property bool hot: selected && page.st.pane === "cats" && app.free
                width: page.sideW - 3.2 * app.u; height: 3.4 * app.u
                focused: hot
                idle: selected ? Qt.rgba(1, 1, 1, 0.1) : "transparent"
                readonly property color fg: hot ? app.dark : selected ? "white" : app.soft
                Icon {
                    x: 2.2 * app.u - width / 2
                    anchors.verticalCenter: parent.verticalCenter
                    name: cat.icon
                    color: parent.fg
                    hole: parent.hot ? app.text : app.bg
                }
                Label {
                    x: 4.2 * app.u; width: parent.width - 5.2 * app.u; height: parent.height
                    text: cat.label
                    size: 1.2 * app.u
                    weight: selected ? Font.DemiBold : Font.Normal
                    color: parent.fg
                }
            }
        }
    }
    Label {
        x: 3 * app.u; y: page.height - 3.4 * app.u; height: 1.6 * app.u
        width: page.sideW - 4 * app.u
        text: "RaspiTV · " + page.s.account.name
        size: 0.9 * app.u
        color: app.muted
    }

    // ---------- Inhalt der Kategorie ----------
    Item {
        id: content
        readonly property var cat: page.st.cats.length ? page.st.cats[page.st.cat] : null
        property real t: 1
        x: page.sideW + 5 * app.u + (1 - t) * 1.5 * app.u
        width: Math.min(page.width - (page.sideW + 5 * app.u) - 6 * app.u, 50 * app.u)
        height: page.height
        opacity: 0.25 + 0.75 * t
        visible: !!cat

        readonly property int catIndex: page.st.cat
        onCatIndexChanged: { t = 0; catAnim.restart() }
        NumberAnimation { id: catAnim; target: content; property: "t"; to: 1; duration: app.ms(300); easing.type: Easing.OutCubic }

        Label {
            y: 2.4 * app.u; height: 3.6 * app.u; width: parent.width
            text: content.cat ? content.cat.label : ""
            size: 2.6 * app.u
            weight: Font.DemiBold
            color: "white"
        }
        Label {
            y: 6 * app.u; height: 1.8 * app.u; width: parent.width
            text: content.cat ? content.cat.desc : ""
            size: 1.1 * app.u
            color: app.muted
        }

        Item {  // Liste mit eigenem Ausschnitt
            id: viewport
            x: -1.5 * app.u; y: 10 * app.u
            width: parent.width + 3 * app.u; height: page.height - y - 1.5 * app.u
            clip: true

            readonly property real rowH: 3.3 * app.u
            function rowY(i) {
                var y = 0
                for (var k = 0; k < i; k++) y += (page.st.items[k].kind === "header" && k > 0 ? 3.4 : 3.3) * app.u
                return y
            }
            readonly property real total: rowY(page.st.items.length)
            property real scroll: page.st.items.length
                ? app.clamp(rowY(page.st.item) + rowH / 2 - height / 2, 0, Math.max(total - height, 0)) : 0
            Behavior on scroll { NumberAnimation { duration: app.ms(260); easing.type: Easing.OutCubic } }

            Column {
                x: 1.5 * app.u; y: -viewport.scroll
                width: content.width
                Repeater {
                    model: page.st.items.length
                    SettingRow {
                        width: content.width
                        item: page.st.items[index]
                        first: index === 0
                        focused: page.st.pane === "items" && index === page.st.item && app.free
                    }
                }
            }
        }
    }
}
