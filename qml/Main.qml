// RaspiTV – Oberfläche in Qt Quick. Der Zustand kommt als JSON von Python (backend.state);
// hier wird nur gezeichnet und animiert. Grundeinheit u = Breite / 80 (24 px bei 1080p).
import QtQuick 2.15

Item {
    id: app
    width: 1920; height: 1080

    property var s: JSON.parse(backend.state)
    readonly property real u: width / 80
    readonly property real edge: 4 * u
    readonly property real tileW: 13.5 * u * s.tileScale
    readonly property real tileH: tileW * 9 / 16
    readonly property real gap: u
    readonly property real focusScale: 1.12
    readonly property bool anim: s.animations

    // Farben
    readonly property color bg: "#0e1013"
    readonly property color panel: "#1b1d22"
    readonly property color card: "#22252b"
    readonly property color text: "#e8eaed"
    readonly property color soft: "#c4c7cc"
    readonly property color muted: "#9aa0a6"
    readonly property color dark: "#202124"
    readonly property color blue: "#8ab4f8"
    readonly property string font: "Nunito Sans"

    // Fokus sichtbar zeigen, solange nichts darüber liegt
    readonly property bool free: !s.dialog && !s.osk && !s.menu

    function ms(t) { return anim ? t : 0 }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }
    function alpha(c, a) { var q = Qt.darker(c, 1); return Qt.rgba(q.r, q.g, q.b, a) }
    function appById(id) {
        for (var i = 0; i < s.allApps.length; i++) if (s.allApps[i].id === id) return s.allApps[i]
        return s.allApps[0]
    }

    Rectangle { anchors.fill: parent; color: app.bg }

    Home {
        id: home
        anchors.fill: parent
        visible: s.view !== "profiles" && s.view !== "jellyfin" && s.view !== "setup" && settings.opacity < 1
    }
    Jellyfin { anchors.fill: parent; visible: s.view === "jellyfin" && !!s.jf }
    Settings { id: settings; anchors.fill: parent }
    Profiles { id: profiles; anchors.fill: parent; visible: s.view === "profiles" }
    Setup { anchors.fill: parent }

    TileMenu {
        anchors.fill: parent
        visible: !!s.menu
        anchorRect: !s.menu ? Qt.rect(0, 0, 0, 0)
                    : s.menu.anchor === "profile" ? profiles.entryRect(s.menu.at) : home.tileRect(s.menu.at)
    }
    Dialog { anchors.fill: parent; visible: !!s.dialog }
    Osk { anchors.fill: parent; visible: !!s.osk }
    PhonePair { anchors.fill: parent }
    Screensaver { anchors.fill: parent }
    VolumeOsd { anchors.fill: parent }
    Toast { anchors.fill: parent }

    // Einblenden beim Start
    Rectangle {
        anchors.fill: parent
        color: "black"
        opacity: 1
        visible: opacity > 0
        NumberAnimation on opacity { to: 0; duration: 700; easing.type: Easing.OutCubic }
    }
}
