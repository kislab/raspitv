// Banner einer App rechts oben, das nach links und unten in den Hintergrund ausläuft.
import QtQuick 2.15
import QtGraphicalEffects 1.15

Item {
    id: art
    property var app_

    LinearGradient {
        anchors.fill: parent
        start: Qt.point(0, 0)
        end: Qt.point(width, height)
        gradient: Gradient {
            GradientStop { position: 0; color: art.app_.heroBg[0] }
            GradientStop { position: 1; color: art.app_.heroBg[art.app_.heroBg.length - 1] }
        }
    }
    RadialGradient {
        anchors.fill: parent
        horizontalOffset: width * 0.12
        verticalOffset: -height * 0.08
        horizontalRadius: width * 0.5
        verticalRadius: width * 0.5
        gradient: Gradient {
            GradientStop { position: 0; color: app.alpha(art.app_.accent, 0.35) }
            GradientStop { position: 1; color: app.alpha(art.app_.accent, 0) }
        }
    }
    Item {  // Logo bzw. Name groß
        x: parent.width * 0.22; width: parent.width * 0.78; height: parent.height * 0.86
        Image {
            id: logo
            anchors.centerIn: parent
            visible: source != ""
            source: art.app_.heroLogo
            width: parent.width * 0.6
            height: art.height * 0.34
            sourceSize.width: width
            sourceSize.height: height
            fillMode: Image.PreserveAspectFit
            smooth: true
            mipmap: true
        }
        Label {
            visible: !logo.visible
            anchors.centerIn: parent
            width: parent.width * 0.8
            horizontalAlignment: Text.AlignHCenter
            fontSizeMode: Text.HorizontalFit
            minimumPixelSize: 10
            elide: Text.ElideNone
            text: art.app_.name
            size: 7 * app.u
            weight: Font.ExtraBold
            color: art.app_.fg
        }
    }
    Rectangle {  // nach links auslaufen
        anchors.fill: parent
        gradient: Gradient {
            orientation: Gradient.Horizontal
            GradientStop { position: 0; color: app.bg }
            GradientStop { position: 0.21; color: app.alpha(app.bg, 0.82) }
            GradientStop { position: 0.6; color: app.alpha(app.bg, 0) }
        }
    }
    Rectangle {  // nach unten auslaufen
        anchors.fill: parent
        gradient: Gradient {
            GradientStop { position: 0.35; color: app.alpha(app.bg, 0) }
            GradientStop { position: 0.77; color: app.alpha(app.bg, 0.82) }
            GradientStop { position: 1; color: app.bg }
        }
    }
}
