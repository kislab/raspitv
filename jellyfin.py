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
        """(Stream-URL, MediaSourceId, PlaySessionId, Videospur) für Direktwiedergabe in mpv."""
        info = self.post(f"/Items/{item_id}/PlaybackInfo", {"UserId": self.user_id}, UserId=self.user_id)
        sources = info.get("MediaSources") or []
        if not sources:
            raise JellyfinError("Keine abspielbare Datei")
        source = sources[0]
        params = urllib.parse.urlencode({"static": "true", "MediaSourceId": source["Id"], "api_key": self.token,
                                         "ApiKey": self.token, "PlaySessionId": info.get("PlaySessionId", "")})
        url = f"{self.url}/Videos/{item_id}/stream?{params}"
        self.check_stream(url)
        video = next((s for s in source.get("MediaStreams") or [] if s.get("Type") == "Video"), {})
        return url, source["Id"], info.get("PlaySessionId", ""), video

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

def video_output(video):
    """mpv-Schalter für Dekodierung und Bildausgabe, passend zur Videospur.

    H.264 bis 1080p (8 Bit) kann der Hardware-Dekoder des Pi 4. Die Bilder gehen dann ohne Umweg
    direkt an den Bildschirm (dmabuf-wayland): gemessen 0 statt ~95 verworfene Bilder je 10 s bei
    ~20 % CPU. Mit Umkopieren über die GPU (v4l2m2m-copy + vo=gpu) ruckelt es deutlich.
    dmabuf-wayland zeigt aber nur Hardware-Bilder – alles andere läuft über den GPU-Ausgabeweg.
    """
    codec = (video.get("Codec") or "").lower()
    bits = video.get("BitDepth") or 8
    height = video.get("Height") or 0
    if codec in ("h264", "avc") and bits <= 8 and height <= 1088:
        return ["--hwdec=v4l2m2m", "--vo=dmabuf-wayland"]
    return ["--hwdec=drm,v4l2m2m-copy,auto-safe", "--vo=gpu", "--gpu-context=wayland"]


def player_info(item, fallback_title):
    """Texte für die Player-Leiste: Serienname, Titel, Zusatzzeile."""
    if not item:
        return {"series": "", "title": fallback_title, "meta": ""}
    if item.get("Type") == "Episode":
        s, e = item.get("ParentIndexNumber"), item.get("IndexNumber")
        meta = " · ".join(p for p in (f"Staffel {s}" if s is not None else "", f"Folge {e}" if e is not None else "") if p)
        return {"series": item.get("SeriesName", ""), "title": item.get("Name", fallback_title), "meta": meta}
    facts = [str(item["ProductionYear"]) if item.get("ProductionYear") else "",
             f"FSK {item['OfficialRating']}" if item.get("OfficialRating") else ""]
    return {"series": "", "title": item.get("Name", fallback_title), "meta": " · ".join(f for f in facts if f)}


class MpvPlayer:
    """Spielt einen Jellyfin-Stream mit mpv im Vollbild ab und meldet den Fortschritt an den Server.

    Die Bedienleiste (jellyfin_osd.py) zeichnet mpv selbst über das Video. Tasten: OK = Pause,
    ◀/▶ = 10 s, ▲/▼ = 1 min spulen, Menü = Ton & Untertitel, Zurück = Leiste ausblenden bzw. beenden.
    `on_end(sekunden)` läuft (im Hintergrund-Thread), wenn mpv beendet ist.
    """

    SHOW_SECONDS = 4.0  # so lange bleibt die Leiste nach einem Tastendruck stehen

    def __init__(self):
        self.proc = None
        self.on_fps = None   # on_fps(bildrate) – einmal je Video, für die Bildraten-Anpassung von RaspiTV
        self.sock_path = os.path.join(tempfile.gettempdir(), f"raspitv-mpv-{os.getpid()}.sock")
        self.position = 0.0
        self.paused = False
        self.info = {}
        self.overlay_sock = None
        self.ui_lock = threading.Lock()
        self.reset_ui()

    def reset_ui(self):
        self.shown_until = 0.0
        self.menu_rows = None   # offenes Ton-/Untertitelmenü
        self.menu_index = 0
        self.seek_sum = 0       # gesammelte Sprünge für die Anzeige "+30 s"
        self.seek_at = 0.0
        self.overlay_on = False
        self.dirty = True
        self.vol_state = None    # (Prozent, stumm?) der Lautstärke-Anzeige
        self.vol_until = 0.0
        self.vol_on = False
        self.toast_until = 0.0
        self.toast_on = False

    def running(self):
        return self.proc is not None and self.proc.poll() is None

    def play(self, client, item_id, title, start, on_end):
        url, source_id, session_id, video = client.playback(item_id)
        self.stop()
        time.sleep(0.2)  # alte Leisten-Schleife beenden lassen
        self.close_overlay_sock()
        try:
            os.unlink(self.sock_path)
        except OSError:
            pass
        args = ["mpv", "--fullscreen", "--force-window=immediate", "--keep-open=no",
                *video_output(video), f"--input-ipc-server={self.sock_path}",
                # mpvs eigene Einblendungen aus – die Leiste kommt aus jellyfin_osd.py
                "--osd-level=1", "--osd-on-seek=no", "--osd-font=Nunito Sans", "--cursor-autohide=always",
                "--sub-font=Nunito Sans", "--sub-bold=yes", "--sub-font-size=46", f"--title={title}",
                "--cache=yes", "--demuxer-max-bytes=150MiB", "--slang=de,ger,deu", "--alang=de,ger,deu,en,eng",
                "--sub-auto=no", f"--start={max(start, 0):.1f}", url]
        log = open(os.path.join(tempfile.gettempdir(), "raspitv-mpv.log"), "w")  # nur Fehler, ohne Adresse
        self.proc = subprocess.Popen(args + ["--msg-level=all=warn"], stdout=log, stderr=log)
        self.position, self.paused = start, False
        self.info = player_info(None, title)
        with self.ui_lock:
            self.reset_ui()
            self.shown_until = time.monotonic() + self.SHOW_SECONDS + 2  # zu Beginn Titel zeigen
        client.report("start", item_id, source_id, session_id, start)
        threading.Thread(target=self.overlay_loop, args=(self.proc,), daemon=True).start()

        def details():
            try:
                self.info = player_info(client.item(item_id), title)
                self.dirty = True
            except JellyfinError:
                pass
        threading.Thread(target=details, daemon=True).start()

        def watch():
            last = 0.0
            rate_sent = False
            while self.running():
                pos = self.query("time-pos")
                if isinstance(pos, (int, float)):
                    self.position = pos
                    if not rate_sent and pos > start + 1:  # Bildrate einmal melden (Bildraten-Anpassung)
                        fps = self.query("container-fps")
                        rate_sent = True
                        if isinstance(fps, (int, float)) and fps > 0 and self.on_fps:
                            self.on_fps(fps)
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
        """Befehl an mpv schicken; Antwort ("data") oder None. Ein einzelnes dict = Befehl mit Namen."""
        cmd = args[0] if len(args) == 1 and isinstance(args[0], dict) else list(args)
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
                s.settimeout(1)
                s.connect(self.sock_path)
                s.sendall((json.dumps({"command": cmd}) + "\n").encode())
                buf = b""
                while True:  # Antworten können größer als ein Paket sein (Spurliste)
                    chunk = s.recv(65536)
                    if not chunk:
                        break
                    buf += chunk
                    for line in buf.decode(errors="replace").splitlines():
                        try:
                            msg = json.loads(line)
                        except ValueError:
                            continue
                        if "error" in msg:
                            return msg.get("data")
        except (OSError, ValueError):
            return None
        return None

    def query(self, prop):
        return self.command("get_property", prop)

    # ---------- Bedienleiste ----------

    def visible(self):
        return bool(self.menu_rows) or self.paused or time.monotonic() < self.shown_until

    def show(self):
        self.shown_until = time.monotonic() + self.SHOW_SECONDS
        self.dirty = True

    def render(self):
        import jellyfin_osd as osd
        if self.menu_rows:
            events = osd.menu(self.menu_rows, self.menu_index)
        else:
            pos = self.query("time-pos")
            if isinstance(pos, (int, float)):
                self.position = pos
            duration = self.query("duration") or 0
            cached = self.query("demuxer-cache-time") or 0
            hint = ""
            if self.seek_sum and time.monotonic() - self.seek_at < 1.5:
                hint = f"{'+' if self.seek_sum > 0 else '−'}{osd.clock(abs(self.seek_sum)) if abs(self.seek_sum) >= 60 else f'{abs(self.seek_sum)} s'}"
            events = osd.controls(self.info, self.position, duration, self.paused, cached, hint)
        self.overlay_command({"name": "osd-overlay", "id": 1, "format": "ass-events", "data": "\n".join(events),
                              "res_x": osd.W, "res_y": osd.H, "z": 10})
        self.overlay_on = True

    def overlay_command(self, cmd):
        """Einblendungen gehören in mpv zur Verbindung, die sie anlegt, und verschwinden mit ihr –
        deshalb läuft die Leiste über eine eigene, dauerhaft offene Verbindung."""
        for _ in range(2):
            try:
                if not self.overlay_sock:
                    self.overlay_sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                    self.overlay_sock.settimeout(1)
                    self.overlay_sock.connect(self.sock_path)
                self.overlay_sock.sendall((json.dumps({"command": cmd}) + "\n").encode())
                return
            except OSError:
                self.close_overlay_sock()

    def close_overlay_sock(self):
        if self.overlay_sock:
            try:
                self.overlay_sock.close()
            except OSError:
                pass
        self.overlay_sock = None

    def overlay_loop(self, proc):
        """Zeichnet die Leiste, solange sie sichtbar ist (Zeit läuft mit), und blendet sie wieder aus."""
        last = 0.0
        while proc.poll() is None:
            paused = self.query("pause")
            if isinstance(paused, bool) and paused != self.paused:
                self.paused, self.dirty = paused, True
            with self.ui_lock:
                if self.visible():
                    if self.dirty or time.monotonic() - last > 0.5:
                        self.dirty = False
                        self.render()
                        last = time.monotonic()
                elif self.overlay_on:
                    self.overlay_command({"name": "osd-overlay", "id": 1, "format": "none", "data": ""})
                    self.overlay_on = False
                # Lautstärke-Anzeige (eigene Ebene über der Leiste)
                if self.vol_on and time.monotonic() > self.vol_until:
                    self.overlay_command({"name": "osd-overlay", "id": 2, "format": "none", "data": ""})
                    self.vol_on = False
                if self.toast_on and time.monotonic() > self.toast_until:
                    self.overlay_command({"name": "osd-overlay", "id": 3, "format": "none", "data": ""})
                    self.toast_on = False
            self.drain_overlay_sock()
            time.sleep(0.1)
        self.close_overlay_sock()

    def drain_overlay_sock(self):
        """Antworten und Ereignisse auf der Leisten-Verbindung verwerfen, damit nichts aufläuft."""
        if not self.overlay_sock:
            return
        try:
            self.overlay_sock.setblocking(False)
            while self.overlay_sock.recv(65536):
                pass
        except (BlockingIOError, InterruptedError):
            pass
        except OSError:
            self.close_overlay_sock()
            return
        finally:
            if self.overlay_sock:
                self.overlay_sock.settimeout(1)

    def show_volume(self, value, muted):
        """Lautstärke-Leiste links für 2,5 s einblenden (aus dem Fernbedienungs-Thread)."""
        import jellyfin_osd as osd
        with self.ui_lock:
            self.vol_until = time.monotonic() + 2.5
            self.overlay_command({"name": "osd-overlay", "id": 2, "format": "ass-events",
                                  "data": "\n".join(osd.volume(value, muted)),
                                  "res_x": osd.W, "res_y": osd.H, "z": 20})
            self.vol_on = True

    def show_toast(self, message, seconds=4):
        """Hinweis oben einblenden (leer = sofort ausblenden)."""
        import jellyfin_osd as osd
        with self.ui_lock:
            self.toast_until = time.monotonic() + (seconds if message else 0)
            if message:
                self.overlay_command({"name": "osd-overlay", "id": 3, "format": "ass-events",
                                      "data": "\n".join(osd.toast(message)),
                                      "res_x": osd.W, "res_y": osd.H, "z": 21})
                self.toast_on = True

    def open_menu(self):
        import jellyfin_osd as osd
        tracks = self.query("track-list") or []
        self.menu_rows = osd.menu_entries(tracks)
        # auf die gewählte Tonspur
        self.menu_index = next((i for i, r in enumerate(self.menu_rows) if r[0] == "item" and r[2]), 1)
        self.dirty = True

    def menu_key(self, key):
        rows = self.menu_rows
        if key in ("up", "down"):
            step = -1 if key == "up" else 1
            i = self.menu_index + step
            while 0 <= i < len(rows) and rows[i][0] == "header":
                i += step
            if 0 <= i < len(rows):
                self.menu_index = i
        elif key == "ok":
            prop, value = rows[self.menu_index][3]
            self.command("set_property", prop, value)
            time.sleep(0.15)
            self.open_menu()  # Häkchen neu einlesen (key() stellt die Zeile wieder her)
            return
        elif key in ("back", "menu"):
            self.menu_rows = None
            self.show()
        self.dirty = True

    def seek(self, seconds):
        now = time.monotonic()
        self.seek_sum = (self.seek_sum if now - self.seek_at < 1.5 and (self.seek_sum > 0) == (seconds > 0) else 0) + seconds
        self.seek_at = now
        self.command("seek", seconds, "relative+exact")
        self.show()

    def key(self, key):
        """Taste der Fernbedienung während der Wiedergabe."""
        with self.ui_lock:
            if self.menu_rows:
                index = self.menu_index
                self.menu_key(key)
                if key == "ok":
                    self.menu_index = index
                return
            if key in ("ok", "playpause"):
                self.command("cycle", "pause")
                self.paused = not self.paused
                self.show()
            elif key in ("left", "right"):
                self.seek(-10 if key == "left" else 10)
            elif key in ("up", "down"):
                self.seek(60 if key == "up" else -60)
            elif key == "menu":
                self.open_menu()
            elif key == "back":
                if self.visible() and not self.paused:
                    self.shown_until = 0  # erst nur die Leiste ausblenden
                    return
                self.stop_locked()
            elif key == "home":
                self.stop_locked()

    def stop_locked(self):
        threading.Thread(target=self.stop, daemon=True).start()

    def stop(self):
        if self.running():
            self.command("quit")
            try:
                self.proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.proc.kill()
