"""Handy als Fernbedienung: kleine Webseite im Heimnetz (http://<IP des Pi>:8766).

Das Handy muss sich einmal mit dem Code koppeln, den RaspiTV unter Einstellungen → System →
„Handy verbinden“ zeigt (der Code gilt nur, solange diese Seite offen ist). Danach merkt sich das
Handy einen Schlüssel (localStorage); RaspiTV speichert die Schlüssel in den Geräte-Einstellungen.

  GET  /            Fernbedienungs-Seite (phone/remote.html)
  POST /pair        {"code": "1234"}                -> {"token": "..."}
  POST /key         {"key": "up" | … | "volumeup" | "playpause"}   (Kopfzeile X-Token)
  POST /text        {"text": "...", "submit": false} Text in das offene Textfeld schreiben
  GET  /state       -> {"typing": bool, "title": str}  (Kopfzeile X-Token)
  GET  /avatar      Seite zum Hochladen eines Profilbilds (phone/avatar.html)
  POST /avatar      Bild (JPEG/PNG, höchstens 4 MB), Kopfzeile X-Upload: Einmal-Schlüssel aus dem QR-Code –
                    gilt nur, solange am Fernseher die Profilbild-Auswahl offen ist (ohne Koppeln)

Ohne gültigen Schlüssel antwortet alles außer / und /pair mit 401. Eigene Kopfzeile (X-Token) heißt:
fremde Webseiten können ohne Rückfrage (CORS) keine Tasten schicken.
"""
import ctypes
import json
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = 8766
PAGE = Path(__file__).resolve().parent / "phone" / "remote.html"
AVATAR_PAGE = Path(__file__).resolve().parent / "phone" / "avatar.html"
MAX_IMAGE = 4 * 1024 * 1024
KEYS = {"up", "down", "left", "right", "ok", "back", "home", "menu", "volumeup", "volumedown", "mute", "playpause"}
MAX_TOKENS = 10


class PhoneServer:
    """on_key(key), on_text(text, submit) und state() werden im Server-Thread aufgerufen;
    tokens() / add_token(token) lesen bzw. speichern die gekoppelten Handys."""

    def __init__(self, on_key, on_text, state, tokens, add_token):
        self.on_key, self.on_text, self.state = on_key, on_text, state
        self.tokens, self.add_token = tokens, add_token
        self.code = None          # Kopplungscode, solange „Handy verbinden“ offen ist
        self.on_paired = None     # wird nach erfolgreichem Koppeln aufgerufen
        self.fails = []           # Zeitpunkte falscher Codes (Bremse gegen Durchprobieren)
        self.server = None
        self.upload = None        # Profilbild-Upload: {"token": str, "done": fn(bytes)} solange die Auswahl offen ist

    def running(self):
        return self.server is not None

    def start(self):
        if self.server:
            return True
        try:
            server = ThreadingHTTPServer(("0.0.0.0", PORT), self.handler())
        except OSError:
            return False
        server.daemon_threads = True
        self.server = server
        threading.Thread(target=server.serve_forever, daemon=True).start()
        return True

    def stop(self):
        if self.server:
            server, self.server = self.server, None
            threading.Thread(target=lambda: (server.shutdown(), server.server_close()), daemon=True).start()

    def new_code(self):
        self.code = f"{secrets.randbelow(10000):04d}"
        return self.code

    def pair(self, code):
        now = time.monotonic()
        self.fails = [t for t in self.fails if now - t < 60]
        if len(self.fails) >= 5:
            return None, "Zu viele Versuche – bitte eine Minute warten"
        if not self.code or not secrets.compare_digest(str(code), self.code):
            self.fails.append(now)
            return None, "Falscher Code" if self.code else "Am Fernseher erst „Handy verbinden“ öffnen"
        token = secrets.token_hex(16)
        self.add_token(token)
        if self.on_paired:
            self.on_paired()
        return token, ""

    def handler(self):
        phone = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def reply(self, data, status=200):
                body = json.dumps(data).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def authorized(self):
                token = self.headers.get("X-Token") or ""
                return any(secrets.compare_digest(token, t) for t in phone.tokens())

            def body(self):
                length = min(int(self.headers.get("Content-Length") or 0), 4096)
                data = json.loads(self.rfile.read(length) or b"{}")
                return data if isinstance(data, dict) else {}

            def do_GET(self):
                if self.path in ("/", "/index.html", "/avatar"):
                    try:
                        page = (AVATAR_PAGE if self.path == "/avatar" else PAGE).read_bytes()
                    except OSError:
                        return self.reply({"error": "page missing"}, 500)
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Cache-Control", "no-cache")
                    self.send_header("Content-Length", str(len(page)))
                    self.end_headers()
                    self.wfile.write(page)
                elif self.path == "/state":
                    if not self.authorized():
                        return self.reply({"error": "unauthorized"}, 401)
                    self.reply(phone.state())
                else:
                    self.reply({"error": "not found"}, 404)

            def do_POST(self):
                if self.path == "/avatar":
                    return self.avatar()
                try:
                    data = self.body()
                except (ValueError, TypeError):
                    return self.reply({"error": "bad json"}, 400)
                if self.path == "/pair":
                    token, error = phone.pair(data.get("code", ""))
                    return self.reply({"token": token} if token else {"error": error}, 200 if token else 403)
                if not self.authorized():
                    return self.reply({"error": "unauthorized"}, 401)
                if self.path == "/key":
                    key = data.get("key")
                    if key not in KEYS:
                        return self.reply({"error": "unknown key"}, 400)
                    phone.on_key(key)
                    return self.reply({"ok": True})
                if self.path == "/text":
                    text = str(data.get("text", ""))[:200]
                    phone.on_text(text, bool(data.get("submit")))
                    return self.reply({"ok": True})
                self.reply({"error": "not found"}, 404)

            def avatar(self):
                up = phone.upload
                token = self.headers.get("X-Upload") or ""
                if not up or not secrets.compare_digest(token, up["token"]):
                    return self.reply({"error": "Am Fernseher ist die Profilbild-Auswahl nicht mehr offen"}, 403)
                length = int(self.headers.get("Content-Length") or 0)
                if not 0 < length <= MAX_IMAGE:
                    return self.reply({"error": "Bild zu groß"}, 413)
                data = self.rfile.read(length)
                if not (data[:3] == b"\xff\xd8\xff" or data[:8] == b"\x89PNG\r\n\x1a\n"):
                    return self.reply({"error": "Kein JPEG- oder PNG-Bild"}, 400)
                up["done"](data)
                return self.reply({"ok": True})

        return Handler


# ---------- QR-Code (libqrencode, ist auf Raspberry Pi OS vorhanden) ----------

class _QRcode(ctypes.Structure):
    _fields_ = [("version", ctypes.c_int), ("width", ctypes.c_int), ("data", ctypes.POINTER(ctypes.c_ubyte))]


def qr_matrix(text):
    """QR-Code als Liste von Zeilen (True = schwarz) oder None, wenn libqrencode fehlt."""
    try:
        lib = ctypes.CDLL("libqrencode.so.4")
    except OSError:
        return None
    lib.QRcode_encodeString.restype = ctypes.POINTER(_QRcode)
    lib.QRcode_encodeString.argtypes = [ctypes.c_char_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int]
    lib.QRcode_free.argtypes = [ctypes.POINTER(_QRcode)]
    code = lib.QRcode_encodeString(text.encode(), 0, 1, 2, 1)  # Version automatisch, Fehlerkorrektur M, 8-Bit
    if not code:
        return None
    try:
        width = code.contents.width
        data = code.contents.data
        return [[bool(data[y * width + x] & 1) for x in range(width)] for y in range(width)]
    finally:
        lib.QRcode_free(code)
