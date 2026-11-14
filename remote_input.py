"""Bluetooth-Fernbedienungen direkt lesen (z. B. Alexa-/Fire-TV-Fernbedienung, „AR Keyboard“).

Die Fernbedienung erscheint im System als Tastatur. Damit ihre Tasten nicht beim Fenster mit dem
Fokus landen (im Player wäre das Chromium – Home ginge verloren), liest RaspiTV sie selbst,
belegt sie exklusiv (EVIOCGRAB) und reicht sie wie jede andere Fernbedienung über remote.py weiter:
an RaspiTV und – solange ein Dienst läuft – an die TV-Erweiterung im Player.

Als Fernbedienung gilt ein Bluetooth-Eingabegerät, dessen Adresse zu einer gekoppelten Fernbedienung
gehört (network.bt_remotes: Gerätetyp „Fernbedienung“) – oder eines mit Zurück-/Home-Taste ohne
Buchstaben. Echte Bluetooth-Tastaturen bleiben so normal benutzbar. (Amazon-Fernbedienungen melden
sich als volle Tastatur, daher die Erkennung über die Adresse.)
"""
import fcntl
import os
import select
import struct
import threading
import time
from pathlib import Path

EVIOCGRAB = 0x40044590
EVENT = struct.Struct("llHHi")
EV_KEY = 1
BUS_BLUETOOTH = 0x05
LONG_PRESS = 0.6

KEY_Q, KEY_BACK, KEY_HOMEPAGE = 16, 158, 172
KEYS = {
    103: "up", 108: "down", 105: "left", 106: "right",
    28: "ok", 96: "ok", 353: "ok", 352: "ok",          # ENTER, KPENTER, SELECT, OK
    158: "back", 1: "back",                            # BACK, ESC
    172: "home", 102: "home",                          # HOMEPAGE, HOME
    139: "menu", 127: "menu",                          # MENU, COMPOSE
    164: "playpause", 207: "playpause", 119: "playpause",  # PLAYPAUSE, PLAY, PAUSE
    115: "volumeup", 114: "volumedown", 113: "mute",
    116: "power", 142: "power",                        # POWER, SLEEP
}
HOME_LONG = 1.0  # Home so lange halten: Ein/Aus-Menü (Ein/Aus selbst meldet z. B. bei Fire-TV-Fernbedienungen kein Halten)


def _has_key(bits_hex, code):
    """Prüft ein Bit in /sys/…/capabilities/key (Hex-Wörter, höchstes zuerst)."""
    words = bits_hex.split()
    word_bits = struct.calcsize("l") * 8   # der Kernel schreibt „unsigned long“-Wörter
    index = len(words) - 1 - code // word_bits
    return 0 <= index < len(words) and bool(int(words[index], 16) >> (code % word_bits) & 1)


def remote_devices(remote_macs=()):
    """Event-Geräte (/dev/input/eventN), die zu einer Bluetooth-Fernbedienung gehören."""
    macs = {m.lower() for m in remote_macs}
    found = []
    for event in sorted(Path("/sys/class/input").glob("event*")):
        dev = event / "device"
        try:
            bus = int((dev / "id" / "bustype").read_text(), 16)
            keys = (dev / "capabilities" / "key").read_text().strip()
            uniq = (dev / "uniq").read_text().strip().lower()  # Bluetooth-Adresse des Geräts
        except (OSError, ValueError):
            continue
        if bus != BUS_BLUETOOTH or not keys.strip("0 "):
            continue
        if uniq in macs or ((_has_key(keys, KEY_BACK) or _has_key(keys, KEY_HOMEPAGE)) and not _has_key(keys, KEY_Q)):
            found.append(f"/dev/input/{event.name}")
    return found


class RemoteInput:
    """Liest alle Fernbedienungen in einem Hintergrund-Thread; neue Geräte werden alle 3 s gesucht."""

    def __init__(self, press, extra=None, remote_macs=lambda: (), connected=None):
        self.press = press          # press(key) – wie eine Taste von remote.py
        self.extra = extra          # extra(key) – Lautstärke usw., die RaspiTV selbst erledigt
        self.remote_macs = remote_macs  # Adressen gekoppelter Fernbedienungen
        # connected() – eine Fernbedienung hat sich (wieder) verbunden. Eine schlafende Fernbedienung
        # verbindet sich erst durch einen Tastendruck, und genau dieser Druck kommt nie an – das
        # Verbinden selbst gilt deshalb als Tastendruck (weckt z. B. den Bildschirm).
        self.connected = connected
        self.scanned = False
        self.open = {}              # Pfad -> Dateideskriptor
        self.ok_down = None
        self.home_down = None       # Home gedrückt seit (None: losgelassen oder schon als „lang“ erledigt)
        self.home_long = False
        self.unknown = set()
        threading.Thread(target=self.run, daemon=True).start()

    def rescan(self):
        for path in remote_devices(self.remote_macs()):
            if path in self.open:
                continue
            try:
                fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
                fcntl.ioctl(fd, EVIOCGRAB, 1)   # Tasten nur noch für RaspiTV
                self.open[path] = fd
                print(f"{time.strftime('%H:%M:%S')} Fernbedienung erkannt: {path}", flush=True)
                if self.scanned and self.connected:
                    self.connected()
            except OSError:
                pass
        self.scanned = True  # beim ersten Suchen (Programmstart) nicht wecken

    def close(self, path):
        try:
            os.close(self.open.pop(path))
        except (OSError, KeyError):
            pass

    def run(self):
        last_scan = 0.0
        while True:
            if time.monotonic() - last_scan > 1:  # schnell, damit Tasten direkt nach dem Verbinden ankommen
                self.rescan()
                last_scan = time.monotonic()
            if not self.open:
                time.sleep(1)
                continue
            fds = {fd: path for path, fd in self.open.items()}
            ready, _, _ = select.select(list(fds), [], [], 0.1)
            for fd in ready:
                try:
                    data = os.read(fd, EVENT.size * 64)
                except OSError:          # Fernbedienung getrennt
                    self.close(fds[fd])
                    continue
                for i in range(0, len(data) - EVENT.size + 1, EVENT.size):
                    _, _, typ, code, value = EVENT.unpack_from(data, i)
                    if os.environ.get("RASPITV_KEYLOG") and typ:
                        print(f"{time.strftime('%H:%M:%S')} ev type={typ} code={code} value={value}", flush=True)
                    if typ == EV_KEY:
                        if code not in KEYS and code not in self.unknown:
                            self.unknown.add(code)  # hilft beim Belegen neuer Tasten
                            print(f"{time.strftime('%H:%M:%S')} Fernbedienung: Taste {code} ohne Belegung", flush=True)
                        self.key(KEYS.get(code), value)
            self.check_long_press()

    def key(self, key, value):
        """value: 1 = gedrückt, 0 = losgelassen, 2 = Wiederholung (gehalten)."""
        if key is None:
            return
        if key == "ok":  # kurz = OK, lang = Menü (wie bei der Tastatur)
            if value == 1:
                self.ok_down = time.monotonic()
            elif value == 0 and self.ok_down is not None:
                self.ok_down = None
                self.press("ok")
            return
        if key == "home":  # kurz = Startseite, lang = Ein/Aus-Menü
            if value == 1:
                self.home_down, self.home_long = time.monotonic(), False
            elif value == 0:
                if not self.home_long:
                    self.press("home")
                self.home_down = None
            return
        if value == 0:
            return
        if key in ("volumeup", "volumedown", "mute", "playpause"):
            if self.extra:
                self.extra(key)
            return
        if value == 2 and key not in ("up", "down", "left", "right"):
            return  # nur Pfeile wiederholen sich beim Halten
        self.press(key)

    def check_long_press(self):
        if self.ok_down is not None and time.monotonic() - self.ok_down >= LONG_PRESS:
            self.ok_down = None
            self.press("menu")
        if self.home_down is not None and time.monotonic() - self.home_down >= HOME_LONG:
            self.home_down, self.home_long = None, True
            self.press("poweroff")
