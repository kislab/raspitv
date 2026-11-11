// Jellyfin als eigene App: Leiste links, rechts Startseite (Reihen), Bibliothek/Suche (Raster),
// Detailseite (Film, Folge oder Serie mit Staffeln und Folgen) und die Jellyfin-Einstellungen.
import QtQuick 2.15

Item {
    id: page
    readonly property var j: app.s.jf
    readonly property bool free: app.free
    readonly property color accent: "#aa5cc3"
    readonly property real railW: 19 * app.u
    readonly property real contentX: railW + 3 * app.u
    readonly property real contentW: width - contentX - 3 * app.u

    Rectangle { anchors.fill: parent; color: app.bg }

    // ---------- Hintergrundbild der Detailseite ----------
    Item {
        anchors.fill: parent
        visible: !!page.j && page.j.page === "detail" && !!page.j.detail && page.j.detail.backdrop !== ""
        Image {
            id: backdrop
            x: parent.width * 0.3
            width: parent.width * 0.7; height: parent.height * 0.75
            source: page.j && page.j.detail ? page.j.detail.backdrop : ""
            fillMode: Image.PreserveAspectCrop
            asynchronous: true
            opacity: status === Image.Ready ? 1 : 0
            Behavior on opacity { NumberAnimation { duration: app.ms(400) } }
        }
        Rectangle {
            x: backdrop.x; width: backdrop.width; height: backdrop.height
            gradient: Gradient {
                orientation: Gradient.Horizontal
                GradientStop { position: 0; color: app.bg }
                GradientStop { position: 0.45; color: app.alpha(app.bg, 0.55) }
                GradientStop { position: 1; color: app.alpha(app.bg, 0.15) }
            }
        }
        Rectangle {
            x: backdrop.x; width: backdrop.width; height: backdrop.height
            gradient: Gradient {
                GradientStop { position: 0.5; color: app.alpha(app.bg, 0) }
                GradientStop { position: 1; color: app.bg }
            }
        }
    }

    // ---------- Leiste ----------
    Rectangle {
        width: page.railW; height: parent.height
        color: "#13151b"
        Row {
            x: 2.4 * app.u; y: 2.6 * app.u
            spacing: 0.7 * app.u
            Rectangle {
                width: 2.4 * app.u; height: width; radius: 0.6 * app.u
                anchors.verticalCenter: parent.verticalCenter
                gradient: Gradient {
                    GradientStop { position: 0; color: page.accent }
                    GradientStop { position: 1; color: "#00a4dc" }
                }
                Icon { anchors.centerIn: parent; width: 1.5 * app.u; name: "library"; color: "white" }
            }
            Label { text: "Jellyfin"; size: 1.8 * app.u; weight: Font.DemiBold; color: "white" }
        }
        Column {
            x: 1.3 * app.u; y: 8.5 * app.u
            spacing: 0.35 * app.u
            Repeater {
                model: page.j ? page.j.nav.length : 0
                Pill {
                    readonly property var entry: page.j.nav[index]
                    readonly property bool selected: index === page.j.navIndex
                    readonly property bool hot: selected && page.j.focus === "nav" && page.free
                    width: page.railW - 2.6 * app.u; height: 3.1 * app.u
                    focused: hot
                    idle: selected ? Qt.rgba(1, 1, 1, 0.09) : "transparent"
                    readonly property color fg: hot ? app.dark : selected ? "white" : app.soft
                    Icon {
                        x: 1.9 * app.u - width / 2
                        anchors.verticalCenter: parent.verticalCenter
                        width: 1.35 * app.u
                        name: entry.icon
                        color: parent.fg
                        hole: parent.hot ? app.text : "#13151b"
                    }
                    Label {
                        x: 3.8 * app.u; width: parent.width - 4.5 * app.u; height: parent.height
                        text: entry.label
                        size: 1.05 * app.u
                        weight: selected ? Font.DemiBold : Font.Normal
                        color: parent.fg
                    }
                }
            }
        }
        Label {
            x: 2.4 * app.u; y: parent.height - 3.2 * app.u; height: 1.6 * app.u
            text: "Zurück: Leiste · Home: RaspiTV"
            size: 0.8 * app.u
            color: app.muted
        }
    }

    // ---------- Kopf des Inhalts ----------
    Label {
        x: page.contentX; y: 2.4 * app.u; height: 3.4 * app.u
        width: page.contentW
        visible: !!page.j && page.j.page !== "detail"
        text: page.j ? page.j.title : ""
        size: 2.3 * app.u
        weight: Font.DemiBold
        color: "white"
    }
    Label {
        x: page.contentX; y: 5.9 * app.u; height: 1.6 * app.u
        width: page.contentW
        visible: !!page.j && (page.j.loading || page.j.error !== "") && page.j.page !== "detail"
        text: page.j ? (page.j.loading ? "Lädt …" : page.j.error) : ""
        size: 1.0 * app.u
        color: page.j && !page.j.loading ? "#f28b82" : app.muted
    }

    // ---------- Startseite: Reihen ----------
    Item {
        id: rows
        x: page.contentX - 1 * app.u; y: 8 * app.u
        width: page.contentW + 4 * app.u; height: page.height - y
        clip: true
        visible: !!page.j && page.j.page === "home"
        readonly property var list: page.j ? page.j.rows : []
        function rowH(r) { return (list[r].wide ? 15.5 * 9 / 16 : 9.2 * 1.5) * app.u + 8.4 * app.u }
        property real scroll: {
            var y = 0
            for (var r = 0; page.j && r < page.j.row && r < list.length; r++) y += rowH(r)
            return y
        }
        Behavior on scroll { NumberAnimation { duration: app.ms(300); easing.type: Easing.OutCubic } }
        Column {
            y: -rows.scroll
            x: 1 * app.u
            Repeater {
                model: rows.list.length
                Item {
                    id: rowItem
                    readonly property var rowData: rows.list[index]
                    readonly property int r: index
                    readonly property bool current: page.j && index === page.j.row
                    width: rows.width; height: rows.rowH(index)
                    Label {
                        height: 2.2 * app.u
                        text: rowItem.rowData.title
                        size: 1.15 * app.u
                        weight: Font.DemiBold
                        color: rowItem.current ? "white" : app.soft
                    }
                    readonly property real cardW: (rowItem.rowData.wide ? 15.5 : 9.2) * app.u
                    property real hscroll: rowItem.current
                        ? Math.max(0, Math.min(page.j.col * (cardW + 1.4 * app.u) - (rows.width - cardW) / 2 + cardW / 2,
                                               rowItem.rowData.items.length * (cardW + 1.4 * app.u) - rows.width + 2 * app.u))
                        : hscroll
                    Behavior on hscroll { NumberAnimation { duration: app.ms(280); easing.type: Easing.OutCubic } }
                    Row {
                        x: -rowItem.hscroll
                        y: 3.0 * app.u
                        spacing: 1.4 * app.u
                        Repeater {
                            model: rowItem.rowData.items.length
                            JfCard {
                                item: rowItem.rowData.items[index]
                                wide: rowItem.rowData.wide
                                focused: rowItem.current && index === page.j.col && page.j.focus === "content" && page.free
                            }
                        }
                    }
                }
            }
        }
    }

    // ---------- Bibliothek und Suche: Raster ----------
    Item {
        id: grid
        x: page.contentX - 1 * app.u; y: 8 * app.u
        width: page.contentW + 2 * app.u; height: page.height - y
        clip: true
        visible: !!page.j && (page.j.page === "library" || page.j.page === "search")
        readonly property var list: page.j ? page.j.grid : []
        readonly property int cols: 6
        readonly property real gap: 1.6 * app.u
        readonly property real cellW: (page.contentW - (cols - 1) * gap) / cols
        readonly property real cellH: cellW * 1.5 + 5.6 * app.u
        property real scroll: page.j ? Math.max(0, page.j.row * cellH - cellH * 0.6) : 0
        Behavior on scroll { NumberAnimation { duration: app.ms(280); easing.type: Easing.OutCubic } }
        Label {
            x: 1 * app.u; y: 0.5 * app.u
            visible: !!page.j && page.j.page === "search" && grid.list.length === 0 && !page.j.loading
            text: "OK drücken, um zu suchen"
            size: 1.1 * app.u
            color: app.muted
        }
        Repeater {
            model: grid.list.length
            JfCard {
                readonly property int r: Math.floor(index / grid.cols)
                readonly property int c: index % grid.cols
                cardW: grid.cellW
                x: 1 * app.u + c * (grid.cellW + grid.gap)
                y: 1.2 * app.u + r * grid.cellH - grid.scroll
                visible: y > -grid.cellH && y < grid.height
                item: grid.list[index]
                focused: page.j.focus === "content" && r === page.j.row && c === page.j.col && page.free
            }
        }
    }

    // ---------- Detailseite ----------
    Item {
        id: detail
        x: page.contentX; y: 0
        width: page.contentW; height: page.height
        visible: !!page.j && page.j.page === "detail" && !!page.j.detail
        readonly property var d: page.j && page.j.detail ? page.j.detail : null
        readonly property bool series: !!d && d.type === "Series"

        Label {
            y: 4 * app.u; width: parent.width * 0.6; height: 2 * app.u
            visible: !!detail.d && detail.d.series !== ""
            text: detail.d ? detail.d.series : ""
            size: 1.2 * app.u; color: app.soft
        }
        Label {
            y: 6 * app.u; width: parent.width * 0.62; height: 4.4 * app.u
            text: detail.d ? detail.d.title : ""
            size: 3.4 * app.u; weight: Font.DemiBold; color: "white"
            fontSizeMode: Text.HorizontalFit; minimumPixelSize: Math.round(1.9 * app.u)
        }
        Label {
            y: 10.8 * app.u; width: parent.width * 0.65; height: 1.8 * app.u
            text: detail.d ? detail.d.facts : ""
            size: 1.0 * app.u; color: app.soft
        }
        Text {
            y: 13.4 * app.u; width: parent.width * 0.55
            text: detail.d ? detail.d.overview : ""
            font.family: app.font; font.pixelSize: Math.round(1.05 * app.u)
            color: app.soft
            wrapMode: Text.WordWrap
            maximumLineCount: detail.series ? 3 : 6
            elide: Text.ElideRight
            lineHeight: 1.15
        }

        // Film/Folge: Knöpfe
        Row {
            visible: !detail.series
            y: 25 * app.u
            spacing: 1 * app.u
            Repeater {
                model: page.j && !detail.series ? page.j.buttons.length : 0
                Pill {
                    width: label.implicitWidth + 3.4 * app.u; height: 3 * app.u
                    focused: index === page.j.button && page.j.focus === "content" && page.free
                    Row {
                        anchors.centerIn: parent
                        spacing: 0.6 * app.u
                        Label { text: "▶"; size: 0.95 * app.u; color: parent.parent.focused ? app.dark : app.text }
                        Label {
                            id: label
                            text: page.j.buttons[index].label
                            size: 1.1 * app.u; weight: Font.DemiBold
                            color: parent.parent.focused ? app.dark : app.text
                        }
                    }
                }
            }
        }

        // Serie: Staffeln und Folgen
        Item {
            visible: detail.series
            y: 20 * app.u
            width: parent.width; height: parent.height - y
            Row {
                spacing: 0.8 * app.u
                Repeater {
                    model: page.j && detail.series ? page.j.seasons.length : 0
                    Pill {
                        readonly property bool selected: index === page.j.season
                        width: seasonLabel.implicitWidth + 2.8 * app.u; height: 2.7 * app.u
                        focused: selected && page.j.zone === 0 && page.j.focus === "content" && page.free
                        idle: selected ? Qt.rgba(1, 1, 1, 0.22) : Qt.rgba(1, 1, 1, 0.08)
                        Label {
                            id: seasonLabel
                            anchors.centerIn: parent
                            text: page.j.seasons[index].label
                            size: 1.0 * app.u; weight: Font.DemiBold
                            color: parent.focused ? app.dark : app.text
                        }
                    }
                }
            }
            Item {
                id: episodes
                y: 4.4 * app.u
                x: -1 * app.u
                width: parent.width + 4 * app.u; height: 16 * app.u
                clip: true
                readonly property var list: page.j && detail.series ? page.j.episodes : []
                readonly property real cardW: 15.5 * app.u
                property real hscroll: page.j ? Math.max(0, Math.min(page.j.episode * (cardW + 1.4 * app.u) - width / 2 + cardW / 2,
                                                                    list.length * (cardW + 1.4 * app.u) - width + 2 * app.u)) : 0
                Behavior on hscroll { NumberAnimation { duration: app.ms(280); easing.type: Easing.OutCubic } }
                Row {
                    x: 1 * app.u - episodes.hscroll
                    y: 0.8 * app.u
                    spacing: 1.4 * app.u
                    Repeater {
                        model: episodes.list.length
                        JfCard {
                            item: episodes.list[index]
                            wide: true
                            focused: page.j.zone === 1 && index === page.j.episode && page.j.focus === "content" && page.free
                        }
                    }
                }
                Label {
                    x: 1 * app.u; y: 1 * app.u
                    visible: episodes.list.length === 0
                    text: "Folgen werden geladen …"
                    size: 1.0 * app.u; color: app.muted
                }
            }
        }
    }

    // ---------- Einstellungen ----------
    Column {
        x: page.contentX; y: 8.5 * app.u
        width: Math.min(page.contentW, 50 * app.u)
        visible: !!page.j && page.j.page === "settings"
        Repeater {
            model: page.j && page.j.page === "settings" ? page.j.items.length : 0
            SettingRow {
                width: parent.width
                item: page.j.items[index]
                first: index === 0
                focused: page.j.focus === "content" && index === page.j.item && page.free
            }
        }
    }

    // ---------- Während der Wiedergabe (mpv liegt darüber) ----------
    Rectangle {
        anchors.fill: parent
        visible: !!page.j && page.j.playing
        color: "black"
        Label {
            anchors.centerIn: parent
            text: "Wiedergabe läuft …"
            size: 1.2 * app.u; color: app.muted
        }
    }
}
