// „Wer schaut?“ – Konten nebeneinander, dazu „Konto hinzufügen“.
import QtQuick 2.15

Item {
    id: page
    readonly property var p: app.s.profiles
    readonly property int count: p.list.length + 1
    readonly property real r: 4.2 * app.u
    readonly property real gapX: 4.5 * app.u
    readonly property real cy: height * 0.5
    readonly property real startX: (width - (count * 2 * r + (count - 1) * gapX)) / 2 + r

    function entryRect(i) {
        var x = startX + i * (2 * r + gapX)
        return Qt.rect(x - r, cy - r, 2 * r, 2 * r)
    }

    Rectangle { anchors.fill: parent; color: app.bg }
    Label {
        width: parent.width; y: 1.5 * app.u; height: 2.6 * app.u
        horizontalAlignment: Text.AlignHCenter
        text: "RaspiTV"; size: 1.7 * app.u; weight: Font.ExtraBold; color: "white"
    }
    Label {
        width: parent.width; y: parent.height * 0.24; height: 4 * app.u
        horizontalAlignment: Text.AlignHCenter
        text: "Wer schaut?"; size: 2.8 * app.u; weight: Font.DemiBold; color: "white"
    }

    Repeater {
        model: page.count
        Item {
            id: entry
            readonly property var account: index < page.p.list.length ? page.p.list[index] : null
            readonly property bool focused: index === page.p.prof && app.free
            property real f: focused ? 1 : 0
            Behavior on f { NumberAnimation { duration: app.ms(200); easing.type: Easing.OutCubic } }
            readonly property real rr: page.r * (1 + 0.12 * f)
            x: page.startX + index * (2 * page.r + page.gapX)
            y: page.cy

            Avatar {
                visible: !!entry.account
                account: entry.account
                r: entry.rr
                f: entry.f
                x: -r; y: -r
            }
            Rectangle {  // Konto hinzufügen
                visible: !entry.account
                width: 2 * entry.rr; height: width; radius: entry.rr
                x: -entry.rr; y: -entry.rr
                color: Qt.rgba(1, 1, 1, entry.focused ? 0.16 : 0.05)
                border.width: 0.2 * app.u
                border.color: entry.focused ? app.text : app.muted
                Icon { anchors.centerIn: parent; width: 3.2 * app.u; name: "plus"; color: app.text }
            }
            Icon {  // Schloss bei Konten mit PIN
                visible: !!entry.account && entry.account.pin
                width: 1.9 * app.u
                x: entry.rr * 0.72 - width / 2; y: entry.rr * 0.72 - width / 2
                name: "lock"; color: "white"; hole: app.dark
            }
            Label {
                x: -page.r - 2 * app.u; width: 2 * page.r + 4 * app.u
                y: page.r + 1.4 * app.u; height: 2 * app.u
                horizontalAlignment: Text.AlignHCenter
                text: entry.account ? entry.account.name : "Konto hinzufügen"
                size: 1.15 * app.u
                weight: entry.focused ? Font.DemiBold : Font.Normal
                color: entry.focused ? "white" : app.muted
            }
        }
    }

    Label {
        width: parent.width; y: parent.height - 4 * app.u; height: 2 * app.u
        horizontalAlignment: Text.AlignHCenter
        text: "OK lange drücken: Konto bearbeiten"
        size: 0.95 * app.u
        color: app.muted
    }
}
