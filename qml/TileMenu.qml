// Menü über der gewählten Kachel bzw. unter dem gewählten Konto (wie bei Google TV).
import QtQuick 2.15

Item {
    id: menu
    property rect anchorRect
    readonly property var m: app.s.menu

    Rectangle { anchors.fill: parent; color: Qt.rgba(0, 0, 0, 0.45) }

    readonly property real rowH: 2.8 * app.u
    readonly property real pad: 0.8 * app.u
    Rectangle {
        id: box
        visible: !!menu.m
        width: Math.max(15 * app.u, menu.anchorRect.width)
        height: (menu.m ? menu.m.items.length : 0) * menu.rowH + 2 * menu.pad + 2.6 * app.u
        x: app.clamp(menu.anchorRect.x + menu.anchorRect.width / 2 - width / 2, 1.5 * app.u, menu.width - width - 1.5 * app.u)
        readonly property real above: menu.anchorRect.y - height - 1.2 * app.u
        // oben kein Platz (z. B. „Wer schaut?“): unter dem Element zeigen
        y: above < 5 * app.u ? menu.anchorRect.y + menu.anchorRect.height + 4.2 * app.u : above
        radius: 1.2 * app.u
        color: app.card

        Label {
            x: 1.4 * app.u; y: menu.pad; width: parent.width - 2.8 * app.u; height: 2.2 * app.u
            text: menu.m ? menu.m.title : ""
            size: app.u
            weight: Font.DemiBold
            color: app.muted
        }
        Column {
            x: menu.pad; y: menu.pad + 2.6 * app.u
            Repeater {
                model: menu.m ? menu.m.items.length : 0
                Item {
                    width: box.width - 2 * menu.pad; height: menu.rowH
                    Pill {
                        width: parent.width; height: parent.height - 0.3 * app.u
                        focused: index === menu.m.index
                        idle: "transparent"
                        Label {
                            x: 1.2 * app.u; width: parent.width - 1.2 * app.u; height: parent.height
                            text: menu.m.items[index]
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
