"""Steuer-Schnittstelle für Fernbedienungen (nur localhost).

Jede Tastenquelle – HDMI-CEC, Infrarot-Empfänger, Handy-App – schickt Tasten hierher:

  POST /key      {"key": "up" | "down" | "left" | "right" | "ok" | "back" | "home" | "menu"}
                 ("menu" = OK lange gedrückt: Kachel-Menü mit Verschieben/Ausblenden)
  GET  /status   -> {"running": "<id>" | null}
  GET  /events   Tasten als Server-Sent Events; darüber steuert die TV-Erweiterung
                 (tv-extension/) die Webseite im Player.

Beispiel:  curl -d '{"key":"home"}' http://127.0.0.1:8765/key
"""
import json
import queue
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST, PORT = "127.0.0.1", 8765
KEYS = {"up", "down", "left", "right", "ok", "back", "home", "menu", "volumeup", "volumedown", "mute"}
LOCAL = {"menu", "volumeup", "volumedown", "mute"}  # erledigt RaspiTV selbst, nicht an die Seite im Player


def press(key):
    """Wird von start() ersetzt; vorher gehen Tasten verloren."""


def notify(message):
    """Nachricht an die TV-Erweiterung (z. B. "volume:45:0" für die Lautstärke-Anzeige); von start() ersetzt."""


def start(on_key, get_status, on_video=None):
    """Startet den Server in einem Hintergrund-Thread. on_key wird dort aufgerufen.

    Danach nimmt `remote.press(key)` Tasten direkt angeschlossener Fernbedienungen an (remote_input.py):
    sie gehen an RaspiTV und – wie Tasten über POST /key – an die TV-Erweiterung im Player.
    """
    global press, notify
    listeners = set()
    lock = threading.Lock()

    def publish(key):
        with lock:
            for q in listeners:
                try:
                    q.put_nowait(key)
                except queue.Full:
                    pass

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, data, status=200):
            body = json.dumps(data).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/status":
                self.reply({"running": get_status()})
            elif self.path == "/events":
                self.stream()
            else:
                self.reply({"error": "not found"}, 404)

        def stream(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            q = queue.Queue(maxsize=64)
            with lock:
                listeners.add(q)
            try:
                while True:
                    try:
                        self.wfile.write(f"data: {q.get(timeout=10)}\n\n".encode())
                    except queue.Empty:
                        self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
            except OSError:
                pass
            finally:
                with lock:
                    listeners.discard(q)

        def do_POST(self):
            # Webseiten im Player (Netflix usw.) dürfen RaspiTV nicht steuern –
            # nur lokale Programme (kein Origin) und die eigene TV-Erweiterung.
            origin = self.headers.get("Origin")
            if origin and not origin.startswith("chrome-extension://"):
                return self.reply({"error": "forbidden"}, 403)
            if self.path == "/video":  # Bildrate des laufenden Videos (tv.js) – für die Bildraten-Anpassung
                try:
                    length = int(self.headers.get("Content-Length") or 0)
                    fps = float(json.loads(self.rfile.read(length) or b"{}").get("fps") or 0)
                except (ValueError, AttributeError, TypeError):
                    return self.reply({"error": "bad json"}, 400)
                if on_video and 0 <= fps < 200:
                    on_video(fps)
                return self.reply({"ok": True})
            if self.path != "/key":
                return self.reply({"error": "not found"}, 404)
            try:
                length = int(self.headers.get("Content-Length") or 0)
                key = json.loads(self.rfile.read(length) or b"{}").get("key")
            except (ValueError, AttributeError):
                return self.reply({"error": "bad json"}, 400)
            if key not in KEYS:
                return self.reply({"error": "unknown key"}, 400)
            on_key(key)
            if origin is None and key not in LOCAL:  # nicht an die Erweiterung zurückschicken
                publish(key)
            self.reply({"ok": True})

    def press_key(key):
        if key != "playpause":
            on_key(key)
        if key != "menu":  # "menu" gilt nur RaspiTV
            publish(key)
    press = press_key
    notify = publish

    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
