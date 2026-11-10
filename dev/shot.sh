#!/bin/bash
# Screenshot des Bildschirms: dev/shot.sh /pfad/bild.png
XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0 grim "${1:?Zieldatei angeben}"
