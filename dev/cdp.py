#!/usr/bin/env python3
"""Entwicklungs-Werkzeug: führt JavaScript in der Seite des Players aus (DevTools-Protokoll).

Voraussetzung: RaspiTV läuft im Entwicklungsmodus (dev/start.sh), der Player hat Port 9222 offen.

  cdp.py 'ausdruck'          JavaScript im Kontext der Webseite
  cdp.py --ext 'ausdruck'    JavaScript im Kontext der RaspiTV-Erweiterung (Zugriff auf TV.*)
  cdp.py < datei.js          Ausdruck aus einer Datei

Nur Standardbibliothek: enthält einen minimalen WebSocket-Client.
"""
import base64, json, os, socket, struct, sys, urllib.request

EXTENSION = "RaspiTV Bedienung"


TIMEOUT = float(os.environ.get("CDP_TIMEOUT", 20))  # Sekunden; für lange Tests z. B. CDP_TIMEOUT=60

def targets():
    return json.load(urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=5))


class WS:
    def __init__(self, url):
        host, path = url[5:].split("/", 1)
        name, port = host.split(":")
        self.s = socket.create_connection((name, int(port)), timeout=TIMEOUT)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((f"GET /{path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.s.recv(4096)
        assert b" 101 " in buf.split(b"\r\n")[0], buf[:200]
        self.next_id = 0

    def send(self, method, params=None):
        self.next_id += 1
        data = json.dumps({"id": self.next_id, "method": method, "params": params or {}}).encode()
        mask, n = os.urandom(4), len(data)
        if n < 126:
            head = bytes([0x81, 0x80 | n])
        elif n < 65536:
            head = bytes([0x81, 0x80 | 126]) + struct.pack(">H", n)
        else:
            head = bytes([0x81, 0x80 | 127]) + struct.pack(">Q", n)
        self.s.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))
        return self.next_id

    def _read(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.s.recv(n - len(buf))
            if not chunk:
                raise EOFError
            buf += chunk
        return buf

    def recv(self):
        out = b""
        while True:
            b1, b2 = self._read(2)
            n = b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            payload = self._read(n)
            if b1 & 0x0F in (0, 1, 2):
                out += payload
                if b1 & 0x80:
                    return json.loads(out)

    def call(self, method, params=None):
        wanted = self.send(method, params)
        while True:
            msg = self.recv()
            if msg.get("id") == wanted:
                return msg.get("result", msg)


def page():
    return next(t for t in targets() if t["type"] == "page" and t["url"].startswith("http"))


def evaluate(expression, extension=False):
    ws = WS(page()["webSocketDebuggerUrl"])
    params = {"expression": expression, "returnByValue": True, "awaitPromise": True}
    if extension:
        top = ws.call("Page.getFrameTree")["frameTree"]["frame"]["id"]  # Hauptfenster, nicht eingebettete
        ws.s.settimeout(3)
        wanted = ws.send("Runtime.enable")
        while "contextId" not in params:
            msg = ws.recv()
            ctx = msg.get("params", {}).get("context", {})
            if (msg.get("method") == "Runtime.executionContextCreated" and ctx.get("name") == EXTENSION
                    and ctx.get("auxData", {}).get("frameId") == top):
                params["contextId"] = ctx["id"]
        ws.s.settimeout(TIMEOUT)
    result = ws.call("Runtime.evaluate", params)
    if "exceptionDetails" in result:
        details = result["exceptionDetails"]
        return "FEHLER: " + details.get("exception", {}).get("description", details.get("text", ""))[:800]
    return result["result"].get("value")


if __name__ == "__main__":
    args = sys.argv[1:]
    ext = bool(args and args[0] == "--ext")
    if ext:
        args = args[1:]
    out = evaluate(args[0] if args else sys.stdin.read(), ext)
    print(out if isinstance(out, str) else json.dumps(out, ensure_ascii=False, indent=1))
