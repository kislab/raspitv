// Einzeilige Beschriftung in der Systemschrift; `size` in Pixeln.
import QtQuick 2.15

Text {
    property real size: app.u
    property int weight: Font.Normal
    font.family: app.font
    font.pixelSize: Math.max(1, Math.round(size))
    font.weight: weight
    color: app.text
    elide: Text.ElideRight
    maximumLineCount: 1
    verticalAlignment: Text.AlignVCenter
}
