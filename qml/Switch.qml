// Ein/Aus-Schalter mit gleitendem Knopf.
import QtQuick 2.15

Rectangle {
    id: sw
    property bool on: false
    property bool focused: false
    width: 2.5 * app.u; height: 1.3 * app.u; radius: height / 2
    color: on ? (focused ? "#1a73e8" : app.blue) : (focused ? "#9aa0a6" : "#4a4d52")
    Behavior on color { ColorAnimation { duration: app.ms(150) } }
    Rectangle {
        width: sw.height * 0.72; height: width; radius: width / 2
        anchors.verticalCenter: parent.verticalCenter
        x: sw.on ? sw.width - sw.height / 2 - width / 2 : sw.height / 2 - width / 2
        Behavior on x { NumberAnimation { duration: app.ms(150); easing.type: Easing.OutCubic } }
        color: sw.on || sw.focused ? "white" : "#c4c7cc"
    }
}
