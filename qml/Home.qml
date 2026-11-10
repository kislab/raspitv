// Startseite: Kopfzeile, Banner der gewählten App, „Deine Apps“ und „Verfügbare Apps“.
import QtQuick 2.15

Item {
    id: home
    readonly property var s: app.s
    readonly property bool homeFocus: s.view === "home" && app.free
    readonly property string heroId: s.hero
    readonly property var hero: app.appById(heroId)

    function tileRect(i) { return appsRow.tileRect(i) }

    // Banner: eins je App, das gewählte blendet über
    Item {
        x: Math.round(parent.width * 0.28)
        width: parent.width - x
        height: Math.round(parent.height * 0.7)
        Repeater {
            model: home.s.allApps.length
            HeroArt {
                anchors.fill: parent
                app_: home.s.allApps[index]
                opacity: app_.id === home.s.hero ? 1 : 0
                visible: opacity > 0
                Behavior on opacity { NumberAnimation { duration: app.ms(450); easing.type: Easing.OutCubic } }
            }
        }
    }
    Rectangle {  // Kopfzeile bleibt auf hellen Bannern lesbar
        width: parent.width; height: 6 * app.u
        gradient: Gradient {
            GradientStop { position: 0; color: app.alpha(app.bg, 0.7) }
            GradientStop { position: 1; color: app.alpha(app.bg, 0) }
        }
    }

    Header { width: parent.width; focusActive: home.homeFocus }

    // Im Store rückt alles nach oben
    property real vscroll: s.row === 2 ? app.tileH + 5.6 * app.u : 0
    Behavior on vscroll { NumberAnimation { duration: app.ms(320); easing.type: Easing.OutCubic } }
    readonly property real tilesY: height - 4.4 * app.u - app.tileH - vscroll

    // Text zur gewählten App, gleitet beim Wechsel leicht herein
    Item {
        id: heroText
        property real t: 1
        x: app.edge + (1 - t) * 1.2 * app.u
        opacity: 0.35 + 0.65 * t
        width: parent.width * 0.5
        Connections {
            target: home
            function onHeroIdChanged() { heroText.t = 0; slide.restart() }
        }
        NumberAnimation { id: slide; target: heroText; property: "t"; to: 1; duration: app.ms(380); easing.type: Easing.OutCubic }

        readonly property real descY: home.tilesY - 2.9 * app.u - 2.4 * app.u - 1.7 * app.u
        Label {
            y: heroText.descY - 0.2 * app.u - 4.4 * app.u - 1.6 * app.u
            height: 1.6 * app.u
            text: home.hero.tag.toUpperCase()
            size: 0.8 * app.u
            weight: Font.Bold
            font.letterSpacing: 0.14 * app.u
            color: Qt.lighter(home.hero.accent, 1.35)
        }
        Label {
            y: heroText.descY - 0.2 * app.u - 4.4 * app.u
            width: parent.width; height: 4.4 * app.u
            text: home.hero.name
            size: 3.6 * app.u
            weight: Font.DemiBold
            color: "white"
        }
        Label {
            y: heroText.descY
            width: parent.width; height: 1.7 * app.u
            text: home.hero.desc
            size: 1.15 * app.u
            color: app.soft
        }
    }

    Label {
        x: app.edge; y: home.tilesY - 2.9 * app.u; height: 1.5 * app.u
        text: s.moving ? "◀ ▶  Kachel verschieben  ·  OK fertig" : "Deine Apps"
        size: 1.1 * app.u
        weight: Font.DemiBold
    }
    TileRow {
        id: appsRow
        width: parent.width
        y: home.tilesY - (height - app.tileH) / 2
        apps: s.apps
        col: s.col
        focused: home.homeFocus && s.row === 1 || !!s.menu && s.view === "home"
        moving: s.moving
    }

    readonly property real storeY: tilesY + app.tileH + 5.6 * app.u
    Label {
        x: app.edge; y: home.storeY - 2.9 * app.u; height: 1.5 * app.u
        text: "Verfügbare Apps"
        size: 1.1 * app.u
        weight: Font.DemiBold
    }
    Label {
        x: app.edge; y: home.storeY - 2.9 * app.u; height: 1.5 * app.u
        width: parent.width - 2 * app.edge
        horizontalAlignment: Text.AlignRight
        visible: s.row === 2
        text: "OK = installieren"
        size: app.u
        color: app.muted
    }
    TileRow {
        width: parent.width
        y: home.storeY - (height - app.tileH) / 2
        visible: s.store.length > 0
        apps: s.store
        col: s.storeCol
        focused: home.homeFocus && s.row === 2
        store: true
    }
    Label {
        x: app.edge; y: home.storeY; height: app.tileH / 2
        visible: s.store.length === 0
        text: "Alle Apps sind installiert"
        size: 1.1 * app.u
        color: app.muted
    }
}
