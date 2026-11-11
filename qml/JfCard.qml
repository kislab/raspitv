// Kachel in der Jellyfin-App: Poster (hochkant) oder Szenenbild (breit), mit Fortschrittsbalken.
import QtQuick 2.15

Item {
    id: card
    property var item
    property bool wide: false
    property bool focused: false
    property bool showText: true
    property real cardW: 0          // feste Breite (Raster); sonst Standardgröße
    readonly property real w: cardW > 0 ? cardW : wide ? 15.5 * app.u : 9.2 * app.u
    readonly property real h: wide ? w * 9 / 16 : w * 1.5

    property real f: focused ? 1 : 0
    Behavior on f { NumberAnimation { duration: app.ms(200); easing.type: Easing.OutCubic } }

    width: w
    height: h + (showText ? 3.6 * app.u : 0)

    Item {
        id: frame
        width: card.w; height: card.h
        scale: 1 + 0.07 * card.f
        transformOrigin: Item.Bottom
        z: 1

        Rectangle {
            anchors.fill: parent
            radius: 0.7 * app.u
            color: "#262a33"
            clip: true
            Label {  // ohne Bild: Titel auf der Fläche
                visible: poster.status !== Image.Ready
                anchors.fill: parent
                anchors.margins: app.u
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.WordWrap
                maximumLineCount: 4
                text: card.item ? card.item.title : ""
                size: 1.0 * app.u
                weight: Font.DemiBold
                color: app.soft
            }
        }
        Image {
            id: poster
            anchors.fill: parent
            source: card.item ? card.item.image : ""
            sourceSize.width: card.w * 1.1
            fillMode: Image.PreserveAspectCrop
            asynchronous: true
            smooth: true
            visible: status === Image.Ready
            layer.enabled: true    // abgerundete Ecken: über eine Maske
            layer.effect: ShaderEffect {
                property variant src: poster
                property real radius: 0.7 * app.u
                property size box: Qt.size(poster.width, poster.height)
                fragmentShader: "
                    varying highp vec2 qt_TexCoord0;
                    uniform sampler2D src;
                    uniform lowp float qt_Opacity;
                    uniform highp float radius;
                    uniform highp vec2 box;
                    void main() {
                        highp vec2 p = qt_TexCoord0 * box;
                        highp vec2 c = clamp(p, vec2(radius), box - vec2(radius));
                        lowp float a = 1.0 - smoothstep(radius - 1.0, radius, length(p - c));
                        gl_FragColor = texture2D(src, qt_TexCoord0) * a * qt_Opacity;
                    }"
            }
        }
        Rectangle {  // Fortschritt
            visible: !!card.item && card.item.progress > 0.01 && !card.item.played
            anchors { left: parent.left; right: parent.right; bottom: parent.bottom; margins: 0.6 * app.u }
            height: 0.35 * app.u; radius: height / 2
            color: Qt.rgba(1, 1, 1, 0.3)
            Rectangle {
                width: parent.width * (card.item ? card.item.progress : 0)
                height: parent.height; radius: height / 2
                color: "#aa5cc3"
            }
        }
        Rectangle {  // gesehen
            visible: !!card.item && card.item.played
            anchors { top: parent.top; right: parent.right; margins: 0.5 * app.u }
            width: 1.6 * app.u; height: width; radius: width / 2
            color: "#aa5cc3"
            Label { anchors.centerIn: parent; text: "✓"; size: app.u; weight: Font.Bold; color: "white" }
        }
        Rectangle {  // Rahmen bei Fokus
            anchors.fill: parent
            anchors.margins: -0.25 * app.u
            radius: 0.95 * app.u
            color: "transparent"
            border.color: "white"
            border.width: 0.16 * app.u
            opacity: card.f
            visible: card.f > 0.02
        }
    }
    Column {
        visible: card.showText
        y: card.h + 0.8 * app.u
        width: card.w
        Label {
            width: parent.width
            text: card.item ? card.item.title : ""
            size: 0.95 * app.u
            weight: card.focused ? Font.DemiBold : Font.Normal
            color: card.focused ? "white" : app.soft
        }
        Label {
            width: parent.width
            text: card.item ? card.item.subtitle : ""
            size: 0.82 * app.u
            color: app.muted
        }
    }
}
