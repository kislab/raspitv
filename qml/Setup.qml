// Einrichtungs-Assistent beim ersten Start (setup_ui.py): links Logo und Schritte, rechts der aktuelle Schritt.
import QtQuick 2.15

Item {
    id: page
    readonly property var st: app.s.setup
    visible: !!st && app.s.view === "setup"

    Rectangle { anchors.fill: parent; color: app.bg }

    // ---------- links: Logo und Schritte ----------
    readonly property real sideW: 26 * app.u
    Rectangle { width: page.sideW; height: parent.height; color: "#15171b" }
    Image {
        x: 3 * app.u; y: 3 * app.u
        width: 5 * app.u; height: width
        source: Qt.resolvedUrl("../logos/raspitv-icon.png")
        fillMode: Image.PreserveAspectFit
        smooth: true; mipmap: true
    }
    Label {
        x: 9 * app.u; y: 3 * app.u; height: 5 * app.u
        text: "RaspiTV"
        size: 2.2 * app.u
        weight: Font.Bold
        color: "white"
    }
    Column {
        x: 3 * app.u; y: 12 * app.u
        spacing: 1.2 * app.u
        Repeater {
            model: ["Fernbedienung", "Willkommen", "Benutzer", "WLAN", "Updates", "Einrichten"]
            Row {
                readonly property int idx: index
                readonly property bool done: page.st && idx < page.st.index
                readonly property bool now: page.st && idx === page.st.index
                spacing: 1.2 * app.u
                Rectangle {
                    width: 2.2 * app.u; height: width; radius: width / 2
                    color: parent.now ? app.blue : parent.done ? Qt.rgba(1, 1, 1, 0.18) : "transparent"
                    border.width: parent.now || parent.done ? 0 : Math.max(1, 0.12 * app.u)
                    border.color: app.muted
                    Label {
                        anchors.centerIn: parent
                        text: parent.parent.done ? "✓" : String(parent.parent.idx + 1)
                        size: 1.0 * app.u
                        weight: Font.Bold
                        color: parent.parent.now ? app.dark : parent.parent.done ? "white" : app.muted
                    }
                }
                Label {
                    height: 2.2 * app.u
                    text: modelData
                    size: 1.25 * app.u
                    weight: parent.now ? Font.DemiBold : Font.Normal
                    color: parent.now ? "white" : parent.done ? app.soft : app.muted
                }
            }
        }
    }
    Label {
        x: 3 * app.u; y: page.height - 3.4 * app.u; height: 1.6 * app.u
        width: page.sideW - 4 * app.u
        text: "Bedienen mit Fernbedienung, Tastatur oder Handy"
        size: 0.9 * app.u
        color: app.muted
    }

    // ---------- rechts: aktueller Schritt ----------
    Item {
        id: content
        x: page.sideW + 5 * app.u
        width: Math.min(page.width - x - 6 * app.u, 50 * app.u)
        height: page.height
        property real t: 1
        opacity: 0.25 + 0.75 * t
        readonly property string stepKey: page.st ? page.st.step : ""
        onStepKeyChanged: { t = 0; stepAnim.restart() }
        NumberAnimation { id: stepAnim; target: content; property: "t"; to: 1; duration: app.ms(300); easing.type: Easing.OutCubic }
        transform: Translate { x: (1 - content.t) * 1.5 * app.u }

        Label {
            y: 6 * app.u; height: 4 * app.u; width: parent.width
            text: page.st ? page.st.title : ""
            size: 3 * app.u
            weight: Font.DemiBold
            color: "white"
        }
        Text {
            y: 10.6 * app.u; width: parent.width
            text: page.st ? page.st.text : ""
            font.family: app.font
            font.pixelSize: Math.round(1.25 * app.u)
            color: app.soft
            wrapMode: Text.WordWrap
            lineHeight: 1.25
        }

        // Auswahl (Weiter, Name, WLAN-Netze …)
        Item {
            id: viewport
            x: -1.5 * app.u; y: 16 * app.u
            width: parent.width + 3 * app.u; height: page.height - y - 2 * app.u
            clip: true
            visible: page.st && (page.st.step !== "install" || page.st.error !== "")
            readonly property var items: page.st ? page.st.items : []
            readonly property real rowH: 3.3 * app.u
            function rowY(i) {
                var y = 0
                for (var k = 0; k < i; k++) y += (items[k].kind === "header" && k > 0 ? 3.4 : 3.3) * app.u
                return y
            }
            readonly property real total: rowY(items.length)
            property real scroll: items.length && page.st
                ? app.clamp(rowY(page.st.item) + rowH / 2 - height / 2, 0, Math.max(total - height, 0)) : 0
            Behavior on scroll { NumberAnimation { duration: app.ms(260); easing.type: Easing.OutCubic } }
            Column {
                x: 1.5 * app.u; y: -viewport.scroll + (page.st && page.st.step === "install" ? 20 * app.u : 0)
                width: content.width
                Repeater {
                    model: viewport.items.length
                    SettingRow {
                        width: content.width
                        item: viewport.items[index]
                        first: index === 0
                        focused: app.free && page.st && index === page.st.item
                    }
                }
            }
        }

        // Einrichten: Ladebalken und Schritte
        Item {
            visible: page.st && page.st.step === "install"
            y: 16 * app.u; width: parent.width; height: 16 * app.u
            Rectangle {
                id: track
                width: parent.width; height: 0.8 * app.u; radius: height / 2
                color: Qt.rgba(1, 1, 1, 0.12)
                Rectangle {
                    height: parent.height; radius: height / 2
                    width: Math.max(height, parent.width * (page.st ? page.st.progress : 0))
                    color: page.st && page.st.error ? "#f28b82" : app.blue
                    Behavior on width { NumberAnimation { duration: app.ms(400); easing.type: Easing.OutCubic } }
                }
            }
            Label {
                y: 1.4 * app.u; height: 1.8 * app.u; width: parent.width
                text: page.st ? (page.st.error || page.st.line) : ""
                size: 1.0 * app.u
                color: page.st && page.st.error ? "#f28b82" : app.muted
            }
            Column {
                y: 4.4 * app.u
                spacing: 0.5 * app.u
                Repeater {
                    model: page.st ? page.st.steps : []
                    Row {
                        spacing: 1 * app.u
                        Label {
                            width: 1.6 * app.u; height: 1.6 * app.u
                            horizontalAlignment: Text.AlignHCenter
                            text: modelData.state === "done" ? "✓" : modelData.state === "run" ? "›"
                                : modelData.state === "error" ? "✕" : modelData.state === "skip" ? "–" : "·"
                            size: 1.2 * app.u
                            weight: Font.Bold
                            color: modelData.state === "done" ? "#81c995" : modelData.state === "error" ? "#f28b82"
                                : modelData.state === "run" ? app.blue : app.muted
                        }
                        Label {
                            height: 1.6 * app.u
                            text: modelData.label + (modelData.state === "skip" ? " (übersprungen)" : "")
                            size: 1.1 * app.u
                            color: modelData.state === "run" ? "white" : modelData.state === "wait" ? app.muted : app.soft
                        }
                    }
                }
            }
        }
    }
}
