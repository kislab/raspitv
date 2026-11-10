// Abgerundete Fläche, die bei Fokus hell wird (Knöpfe, Menü- und Listeneinträge).
import QtQuick 2.15

Rectangle {
    property bool focused: false
    property color idle: Qt.rgba(1, 1, 1, 0.12)
    radius: height / 2
    color: focused ? app.text : idle
    Behavior on color { ColorAnimation { duration: app.ms(120) } }
}
