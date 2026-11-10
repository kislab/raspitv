// Waagrechte Kachelreihe; hält die gewählte Kachel mittig, ohne über die Ränder hinaus zu scrollen.
import QtQuick 2.15

Item {
    id: rowItem
    property var apps: []
    property int col: 0
    property bool focused: false
    property bool store: false
    property bool moving: false

    height: app.tileH * app.focusScale

    readonly property real total: 2 * app.edge + apps.length * app.tileW + Math.max(apps.length - 1, 0) * app.gap
                                  + app.tileW * (app.focusScale - 1)
    readonly property real target: app.clamp(app.edge + col * (app.tileW + app.gap) + app.tileW / 2 - width / 2,
                                             0, Math.max(total - width, 0))
    property real scroll: target
    Behavior on scroll { NumberAnimation { duration: app.ms(300); easing.type: Easing.OutCubic } }

    function tileRect(i) {
        var t = repeater.itemAt(i)
        if (!t) return Qt.rect(0, 0, 0, 0)
        var p = t.mapToItem(app, 0, (t.height - app.tileH * t.s) / 2)
        return Qt.rect(p.x, p.y, t.width, app.tileH * t.s)
    }

    Row {
        x: app.edge - rowItem.scroll
        spacing: app.gap
        Repeater {
            id: repeater
            model: rowItem.apps.length
            Tile {
                app_: rowItem.apps[index]
                focused: rowItem.focused && index === rowItem.col
                store: rowItem.store
                lifted: rowItem.moving && index === rowItem.col
            }
        }
    }
}
