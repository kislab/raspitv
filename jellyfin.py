"""Jellyfin-Anbindung für RaspiTV: Server-API (Anmelden, Bibliotheken, Reihen, Serien, Suche) und
Wiedergabe mit mpv (Hardware-Dekodierung) inklusive Fortschrittsmeldung an den Server.

Alle API-Aufrufe blockieren – RaspiTV ruft sie im Hintergrund auf. Fehler kommen als JellyfinError.
"""
import json
import os
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

CLIENT, VERSION, DEVICE = "RaspiTV", "1.0", "RaspiTV"
TICKS = 10_000_000          # Jellyfin rechnet Zeiten in 100-ns-Schritten
FIELDS = "Overview,PrimaryImageAspectRatio,ProductionYear,OfficialRating,CommunityRating,RunTimeTicks," \
         "UserData,SeriesName,ParentIndexNumber,IndexNumber,ChildCount,Genres,ImageTags,BackdropImageTags," \
         "ParentBackdropImageTags,ParentBackdropItemId,SeriesId,SeasonId"


class JellyfinError(Exception):
    pass


class Client:
    def __init__(self, url, token="", user_id="", device_id=""):
        self.url = (url or "").rstrip("/")
        self.token = token
        self.user_id = user_id
        self.device_id = device_id or uuid.uuid4().hex

    # ---------- Grundlagen ----------

    def auth_header(self):
        h = f'MediaBrowser Client="{CLIENT}", Device="{DEVICE}", DeviceId="{self.device_id}", Version="{VERSION}"'
        return h + (f', Token="{self.token}"' if self.token else "")

    def request(self, method, path, params=None, body=None, timeout=10):
        if not self.url:
            raise JellyfinError("Keine Serveradresse")
        url = self.url + path + ("?" + urllib.parse.urlencode(params) if params else "")
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={
            "Authorization": self.auth_header(), "Content-Type": "application/json", "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            if e.code == 401:
                raise JellyfinError("Nicht angemeldet") from e
            raise JellyfinError(f"Server meldet Fehler {e.code}") from e
        except (urllib.error.URLError, OSError, ValueError) as e:
            raise JellyfinError("Server nicht erreichbar") from e

    def get(self, path, **params):
        return self.request("GET", path, {k: v for k, v in params.items() if v is not None})

    def post(self, path, body=None, **params):
        return self.request("POST", path, params or None, body if body is not None else {})

    def server_name(self):
        return self.get("/System/Info/Public").get("ServerName", "Jellyfin")

    # ---------- Anmelden ----------

    def _take_auth(self, result):
        self.token = result["AccessToken"]
        self.user_id = result["User"]["Id"]
        return result["User"]["Name"]

    def login(self, username, password):
        try:
            result = self.post("/Users/AuthenticateByName", {"Username": username, "Pw": password})
        except JellyfinError as e:
            raise JellyfinError("Name oder Passwort falsch" if "401" in str(e) or "angemeldet" in str(e) else str(e))
        return self._take_auth(result)

    def quick_connect_start(self):
        """Quick Connect beginnen: (Code zum Anzeigen, Geheimnis zum Abfragen)."""
        if not self.get("/QuickConnect/Enabled"):
            raise JellyfinError("Quick Connect ist auf dem Server ausgeschaltet")
        r = self.post("/QuickConnect/Initiate")
        return r["Code"], r["Secret"]

    def quick_connect_poll(self, secret):
        """Name des angemeldeten Benutzers, sobald der Code bestätigt wurde, sonst None."""
        r = self.get("/QuickConnect/Connect", Secret=secret)
        if not r.get("Authenticated"):
            return None
        return self._take_auth(self.post("/Users/AuthenticateWithQuickConnect", {"Secret": secret}))

    def logout(self):
        try:
            self.post("/Sessions/Logout")
        except JellyfinError:
            pass
        self.token = self.user_id = ""

    def user_name(self):
        return self.get(f"/Users/{self.user_id}").get("Name", "")

    # ---------- Inhalte ----------

    def views(self):
        """Bibliotheken (Filme, Serien, …)."""
        items = self.get(f"/Users/{self.user_id}/Views").get("Items", [])
        return [i for i in items if i.get("CollectionType") in ("movies", "tvshows", "homevideos", "musicvideos", "boxsets", None)]

    def resume(self, limit=20):
        return self.get(f"/Users/{self.user_id}/Items/Resume", Limit=limit, MediaTypes="Video",
                        Fields=FIELDS, EnableImageTypes="Primary,Backdrop,Thumb").get("Items", [])

    def next_up(self, limit=20):
        return self.get("/Shows/NextUp", UserId=self.user_id, Limit=limit, Fields=FIELDS).get("Items", [])

    def latest(self, parent_id, limit=20):
        return self.get(f"/Users/{self.user_id}/Items/Latest", ParentId=parent_id, Limit=limit, Fields=FIELDS) or []

    def library(self, parent_id, collection):
        kind = {"movies": "Movie", "tvshows": "Series", "boxsets": "BoxSet"}.get(collection)
        return self.get(f"/Users/{self.user_id}/Items", ParentId=parent_id, Recursive="true" if kind else None,
                        IncludeItemTypes=kind, SortBy="SortName", SortOrder="Ascending", Fields=FIELDS,
                        Limit=400).get("Items", [])

    def item(self, item_id):
        return self.get(f"/Users/{self.user_id}/Items/{item_id}", Fields=FIELDS)

    def seasons(self, series_id):
        return self.get(f"/Shows/{series_id}/Seasons", UserId=self.user_id, Fields=FIELDS).get("Items", [])

    def episodes(self, series_id, season_id):
        return self.get(f"/Shows/{series_id}/Episodes", UserId=self.user_id, SeasonId=season_id,
                        Fields=FIELDS).get("Items", [])

    def search(self, term, limit=40):
        return self.get(f"/Users/{self.user_id}/Items", SearchTerm=term, Recursive="true", Limit=limit,
                        IncludeItemTypes="Movie,Series,Episode", Fields=FIELDS).get("Items", [])

    def image(self, item, kind="Primary", height=360):
        """Bild-URL eines Eintrags (Primary = Poster, Backdrop = Hintergrund, Thumb = Vorschau); "" wenn keins."""
        if kind == "Backdrop":
            if item.get("BackdropImageTags"):
                return f"{self.url}/Items/{item['Id']}/Images/Backdrop?maxHeight={height}&tag={item['BackdropImageTags'][0]}"
            if item.get("ParentBackdropImageTags") and item.get("ParentBackdropItemId"):
                return (f"{self.url}/Items/{item['ParentBackdropItemId']}/Images/Backdrop?maxHeight={height}"
                        f"&tag={item['ParentBackdropImageTags'][0]}")
            return ""
        tag = (item.get("ImageTags") or {}).get(kind)
        if tag:
            return f"{self.url}/Items/{item['Id']}/Images/{kind}?maxHeight={height}&tag={tag}"
        if kind == "Primary" and item.get("SeriesId") and item.get("SeriesPrimaryImageTag"):
            return f"{self.url}/Items/{item['SeriesId']}/Images/Primary?maxHeight={height}&tag={item['SeriesPrimaryImageTag']}"
        return ""

    # ---------- Wiedergabe ----------

    def playback(self, item_id):
        """(Stream-URL, MediaSourceId, PlaySessionId) für Direktwiedergabe in mpv."""
        info = self.post(f"/Items/{item_id}/PlaybackInfo", {"UserId": self.user_id}, UserId=self.user_id)
        sources = info.get("MediaSources") or []
        if not sources:
            raise JellyfinError("Keine abspielbare Datei")
        source = sources[0]
        params = urllib.parse.urlencode({"static": "true", "MediaSourceId": source["Id"], "api_key": self.token,
                                         "ApiKey": self.token, "PlaySessionId": info.get("PlaySessionId", "")})
        url = f"{self.url}/Videos/{item_id}/stream?{params}"
        self.check_stream(url)
        return url, source["Id"], info.get("PlaySessionId", "")

    def check_stream(self, url):
        """Kurz prüfen, ob der Server die Datei liefert – sonst eine verständliche Meldung statt stummem Abbruch."""
        req = urllib.request.Request(url, headers={"Range": "bytes=0-1023", "Authorization": self.auth_header()})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                r.read(16)
        except urllib.error.HTTPError as e:
            if e.code in (404, 500):
                raise JellyfinError("Der Server findet die Videodatei nicht – ist die Festplatte am Server verbunden?") from e
            if e.code in (401, 403):
                raise JellyfinError("Keine Berechtigung zum Abspielen") from e
            raise JellyfinError(f"Server meldet Fehler {e.code}") from e
        except (urllib.error.URLError, OSError) as e:
            raise JellyfinError("Server nicht erreichbar") from e

    def report(self, what, item_id, source_id, session_id, seconds, paused=False):
        body = {"ItemId": item_id, "MediaSourceId": source_id, "PlaySessionId": session_id,
                "PositionTicks": int(max(seconds, 0) * TICKS), "IsPaused": paused, "CanSeek": True,
                "PlayMethod": "DirectPlay"}
        path = {"start": "/Sessions/Playing", "progress": "/Sessions/Playing/Progress",
                "stop": "/Sessions/Playing/Stopped"}[what]
        try:
            self.post(path, body)
        except JellyfinError:
            pass


# ---------- Aufbereitung für die Oberfläche ----------

def runtime(ticks):
    minutes = int((ticks or 0) / TICKS / 60)
    return f"{minutes // 60} Std. {minutes % 60} Min." if minutes >= 60 else f"{minutes} Min." if minutes else ""


def card(client, item, wide=False):
    """Eintrag für eine Kachelreihe/Liste in QML."""
    kind = item.get("Type", "")
    data = item.get("UserData") or {}
    title = item.get("Name", "")
    subtitle = ""
    if kind == "Episode":
        title = item.get("SeriesName") or title
        s, e = item.get("ParentIndexNumber"), item.get("IndexNumber")
        subtitle = (f"S{s} F{e} · " if s is not None and e is not None else "") + item.get("Name", "")
    elif item.get("ProductionYear"):
        subtitle = str(item["ProductionYear"])
    progress = data.get("PlayedPercentage") or 0
    image = ""
    if wide:  # breite Kachel: Szenenbild bzw. Hintergrund
        image = client.image(item, "Thumb", 320) or client.image(item, "Backdrop", 320) or client.image(item, "Primary", 320)
    else:
        image = client.image(item, "Primary", 420)
    return {"id": item["Id"], "type": kind, "title": title, "subtitle": subtitle, "image": image,
            "progress": round(progress / 100, 3), "played": bool(data.get("Played")),
            "seriesId": item.get("SeriesId", ""), "seasonId": item.get("SeasonId", "")}


def detail(client, item):
    data = item.get("UserData") or {}
    facts = [str(item["ProductionYear"])] if item.get("ProductionYear") else []
    if item.get("OfficialRating"):
        facts.append(item["OfficialRating"])
    if item.get("RunTimeTicks") and item.get("Type") != "Series":
        facts.append(runtime(item["RunTimeTicks"]))
    if item.get("CommunityRating"):
        facts.append(f"★ {item['CommunityRating']:.1f}")
    if item.get("Genres"):
        facts.append(", ".join(item["Genres"][:3]))
    resume = (data.get("PlaybackPositionTicks") or 0) / TICKS
    return {"id": item["Id"], "type": item.get("Type", ""), "title": item.get("Name", ""),
            "series": item.get("SeriesName", ""), "overview": item.get("Overview", ""),
            "facts": "  ·  ".join(facts), "backdrop": client.image(item, "Backdrop", 1080),
            "poster": client.image(item, "Primary", 600), "resume": resume,
            "resumeText": f"Fortsetzen ab {int(resume // 60)}:{int(resume % 60):02d}" if resume > 30 else ""}


# ---------- mpv ----------

class MpvPlayer:
    """Spielt einen Jellyfin-Stream mit mpv im Vollbild ab und meldet den Fortschritt an den Server.

    Steuerung über mpvs JSON-IPC: OK = Pause, ◀/▶ = 10 s zurück/vor, ▲/▼ = 60 s vor/zurück,
    Zurück = beenden. `on_end(sekunden)` läuft (im Hintergrund-Thread), wenn mpv beendet ist.
    """

    def __init__(self):
        self.proc = None
        self.sock_path = os.path.join(tempfile.gettempdir(), f"raspitv-mpv-{os.getpid()}.sock")
        self.position = 0.0
        self.paused = False

    def running(self):
        return self.proc is not None and self.proc.poll() is None

    def play(self, client, item_id, title, start, on_end):
        url, source_id, session_id = client.playback(item_id)
        self.stop()
        try:
            os.unlink(self.sock_path)
        except OSError:
            pass
        args = ["mpv", "--fullscreen", "--force-window=immediate", "--keep-open=no",
                "--hwdec=drm,v4l2m2m-copy,auto-safe", "--vo=gpu", "--gpu-context=wayland", f"--input-ipc-server={self.sock_path}",
                "--osd-level=1", "--osd-font=Nunito Sans", "--osd-font-size=40", f"--title={title}",
                "--cache=yes", "--demuxer-max-bytes=150MiB", "--slang=de,ger,deu", "--alang=de,ger,deu,en,eng",
                "--sub-auto=no", f"--start={max(start, 0):.1f}", url]
        log = open(os.path.join(tempfile.gettempdir(), "raspitv-mpv.log"), "w")  # nur Fehler, ohne Adresse
        self.proc = subprocess.Popen(args + ["--msg-level=all=warn"], stdout=log, stderr=log)
        self.position, self.paused = start, False
        client.report("start", item_id, source_id, session_id, start)

        def watch():
            last = 0.0
            while self.running():
                pos = self.query("time-pos")
                if isinstance(pos, (int, float)):
                    self.position = pos
                paused = self.query("pause")
                if isinstance(paused, bool):
                    self.paused = paused
                if time.monotonic() - last > 10:
                    client.report("progress", item_id, source_id, session_id, self.position, self.paused)
                    last = time.monotonic()
                time.sleep(1)
            client.report("stop", item_id, source_id, session_id, self.position)
            on_end(self.position)
        threading.Thread(target=watch, daemon=True).start()

    def command(self, *args):
        """Befehl an mpv schicken; Antwort ("data") oder None."""
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
                s.settimeout(1)
                s.connect(self.sock_path)
                s.sendall((json.dumps({"command": list(args)}) + "\n").encode())
                answer = s.recv(65536).decode(errors="replace").splitlines()
                for line in answer:
                    msg = json.loads(line)
                    if "error" in msg:
                        return msg.get("data")
        except (OSError, ValueError):
            return None
        return None

    def query(self, prop):
        return self.command("get_property", prop)

    def key(self, key):
        """Taste der Fernbedienung während der Wiedergabe."""
        if key == "ok":
            self.command("cycle", "pause")
            self.command("show-progress")
        elif key in ("left", "right"):
            self.command("seek", -10 if key == "left" else 10, "relative")
            self.command("show-progress")
        elif key in ("up", "down"):
            self.command("seek", 60 if key == "up" else -60, "relative")
            self.command("show-progress")
        elif key == "playpause":
            self.command("cycle", "pause")
        elif key in ("back", "home"):
            self.stop()

    def stop(self):
        if self.running():
            self.command("quit")
            try:
                self.proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.proc.kill()
