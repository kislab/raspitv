"""Jellyfin als eigene App in RaspiTV: Zustand und Tastenlogik (gezeichnet wird in qml/Jellyfin*.qml).

Aufbau wie bei Google TV: links eine Leiste (Start, Bibliotheken, Suche, Einstellungen), rechts der
Inhalt – Reihen auf der Startseite, Raster in Bibliotheken und Suche, Detailseite mit Staffeln und
Folgen sowie die Jellyfin-Einstellungen (Serveradresse, Anmelden per Quick Connect oder Passwort).
Wird als Mixin von raspitv.Home benutzt (braucht run_bg, notice, busy, open_osk, push …).
"""
import time

import jellyfin as jf
import settings as cfg

GRID_COLS = 8


class JellyfinUI:
    # ---------- Zustand ----------

    def init_jellyfin(self):
        self.jf = None          # Zustand, solange die App offen ist
        self.mpv = jf.MpvPlayer()

    def jf_client(self):
        s = self.settings
        if not s.get("jellyfin_device"):
            s["jellyfin_device"] = jf.Client("").device_id
            self.save_settings()
        return jf.Client(s.get("jellyfin_url", ""), s.get("jellyfin_token", ""), s.get("jellyfin_user_id", ""),
                         s["jellyfin_device"])

    def jf_state(self):
        if not self.jf:
            return None
        j = self.jf
        return {k: j[k] for k in ("nav", "navIndex", "focus", "page", "rows", "row", "col", "grid", "detail",
                                  "zone", "seasons", "season", "episodes", "episode", "buttons", "button",
                                  "items", "item", "loading", "error", "title", "playing", "query")}

    # ---------- Öffnen und Navigation ----------

    def open_jellyfin(self):
        self.view = "jellyfin"
        self.jf = {"nav": [], "navIndex": 0, "focus": "content", "page": "home", "rows": [], "row": 0, "col": 0,
                   "grid": [], "detail": None, "zone": 0, "seasons": [], "season": 0, "episodes": [], "episode": 0,
                   "buttons": [], "button": 0, "items": [], "item": 0, "loading": True, "error": "",
                   "title": "Start", "playing": False, "query": "", "views": [], "back": []}
        client = self.jf_client()
        if not client.url:
            self.jf_find_server(then_home=True)
        elif not client.token:
            self.jf_build_nav([])
            self.jf_open_settings("Bitte bei Jellyfin anmelden")
        else:
            self.jf_load_home()

    def jf_close(self):
        self.mpv.stop()
        self.jf = None
        self.view = "home"

    def jf_build_nav(self, views):
        self.jf["views"] = views
        self.jf["nav"] = ([{"id": "home", "label": "Start", "icon": "home"}]
                          + [{"id": v["Id"], "label": v.get("Name", ""), "icon": "library",
                              "collection": v.get("CollectionType") or ""} for v in views]
                          + [{"id": "search", "label": "Suche", "icon": "search"},
                             {"id": "settings", "label": "Einstellungen", "icon": "gear"}])

    def jf_run(self, work, done, loading=True):
        """API-Aufruf im Hintergrund; Fehler landen in jf["error"]."""
        if loading:
            self.jf["loading"] = True

        def wrapped():
            try:
                return True, work()
            except jf.JellyfinError as e:
                return False, str(e)

        def finished(result):
            if not self.jf:
                return
            self.jf["loading"] = False
            ok, value = result
            if ok:
                self.jf["error"] = ""
                done(value)
            elif value == "Nicht angemeldet":
                self.jf_open_settings("Anmeldung abgelaufen – bitte neu anmelden")
            else:
                self.jf["error"] = value
        self.run_bg(wrapped, finished)

    def jf_nav_select(self, index):
        j = self.jf
        j["navIndex"] = index
        entry = j["nav"][index]
        if entry["id"] == "home":
            self.jf_load_home()
        elif entry["id"] == "search":
            j.update(page="search", title="Suche", grid=[], row=0, col=0)
        elif entry["id"] == "settings":
            self.jf_open_settings()
        else:
            self.jf_load_library(entry)

    # ---------- Seiten laden ----------

    def jf_load_home(self):
        client = self.jf_client()

        def work():
            views = client.views()
            rows = []
            resume = client.resume()
            if resume:
                rows.append({"title": "Weiterschauen", "wide": True, "items": [jf.card(client, i, True) for i in resume]})
            nxt = client.next_up()
            if nxt:
                rows.append({"title": "Nächste Folgen", "wide": True, "items": [jf.card(client, i, True) for i in nxt]})
            for v in views:
                latest = client.latest(v["Id"])
                if latest:
                    rows.append({"title": f"Neu in {v.get('Name', '')}", "wide": False,
                                 "items": [jf.card(client, i) for i in latest]})
            return views, rows

        def done(result):
            views, rows = result
            self.jf_build_nav(views)
            self.jf.update(page="home", title="Start", rows=rows, row=0, col=0, navIndex=0,
                           focus="content" if rows else "nav", back=[])
            if not rows:
                self.jf["error"] = "Noch keine Inhalte – Bibliotheken auf dem Server einrichten"
        self.jf.update(page="home", title="Start")
        self.jf_run(work, done)

    def jf_load_library(self, entry):
        client = self.jf_client()
        self.jf.update(page="library", title=entry["label"], grid=[], row=0, col=0)
        self.jf_run(lambda: [jf.card(client, i) for i in client.library(entry["id"], entry.get("collection"))],
                    lambda grid: self.jf.update(grid=grid, row=0, col=0))

    def jf_search(self, term):
        client = self.jf_client()
        self.jf.update(page="search", title=f"Suche: {term}", query=term, grid=[], row=0, col=0)
        self.jf_run(lambda: [jf.card(client, i) for i in client.search(term)],
                    lambda grid: self.jf.update(grid=grid, row=0, col=0, focus="content" if grid else "nav",
                                                error="" if grid else f"Nichts gefunden für „{term}“"))

    def jf_open_item(self, card):
        """Kachel gewählt: Film/Serie -> Detailseite, Folge -> Detailseite der Folge."""
        client = self.jf_client()
        j = self.jf
        j["back"].append({k: j[k] for k in ("page", "title", "row", "col", "focus")})

        def work():
            item = client.item(card["id"])
            seasons = client.seasons(item["Id"]) if item.get("Type") == "Series" else []
            return item, seasons

        def done(result):
            item, seasons = result
            d = jf.detail(client, item)
            buttons = []
            if item.get("Type") != "Series":
                buttons = ([{"id": "resume", "label": d["resumeText"]}] if d["resumeText"] else []) + \
                          [{"id": "play", "label": "Von vorn abspielen" if d["resumeText"] else "Abspielen"}]
            self.jf.update(page="detail", title=d["title"], detail=d, buttons=buttons, button=0, zone=0,
                           seasons=[{"id": s["Id"], "label": s.get("Name", "")} for s in seasons], season=0,
                           episodes=[], episode=0, focus="content")
            if seasons:
                # Staffel mit der nächsten ungesehenen Folge vorwählen
                pick = next((i for i, s in enumerate(seasons) if not (s.get("UserData") or {}).get("Played")), 0)
                self.jf["season"] = pick
                self.jf_load_episodes()
        self.jf_run(work, done)

    def jf_load_episodes(self):
        client = self.jf_client()
        j = self.jf
        season = j["seasons"][j["season"]]
        series = j["detail"]["id"]

        def done(eps):
            j["episodes"] = eps
            j["episode"] = next((i for i, e in enumerate(eps) if not e["played"]), 0)
        self.jf_run(lambda: [dict(jf.card(client, e, True), title=e.get("Name", ""),
                                  subtitle=f"Folge {e.get('IndexNumber', '?')}"
                                           + (f" · {jf.runtime(e.get('RunTimeTicks'))}" if e.get("RunTimeTicks") else ""),
                                  resume=((e.get("UserData") or {}).get("PlaybackPositionTicks") or 0) / jf.TICKS)
                             for e in client.episodes(series, season["id"])], done, loading=False)

    def jf_go_back(self):
        j = self.jf
        if j["page"] == "detail" and j["back"]:
            prev = j["back"].pop()
            j.update(prev)
            if j["page"] == "home":
                self.jf_load_home()
            return True
        return False

    # ---------- Abspielen ----------

    def jf_play(self, item_id, title, start=0.0):
        client = self.jf_client()
        self.busy(f"{title} wird gestartet …")

        def work():
            done_event = []

            def ended(position):
                self.bgDone.emit(lambda: self.jf_playback_ended())
            self.mpv.play(client, item_id, title, start, ended)
            return True

        def done(_):
            self.dialog = None
            self.jf["playing"] = True

        def wrapped():
            try:
                return True, work()
            except jf.JellyfinError as e:
                return False, str(e)

        def finished(result):
            ok, value = result
            if ok:
                done(value)
            else:
                self.notice(f"Abspielen nicht möglich: {value}" if len(value) < 60 else value)
        self.run_bg(wrapped, finished)

    def jf_playback_ended(self):
        if not self.jf:
            return
        self.jf["playing"] = False
        self.activate_window()
        # Fortschritt neu laden (Weiterschauen, gesehene Folgen)
        if self.jf["page"] == "detail" and self.jf["detail"]:
            if self.jf["seasons"]:
                self.jf_load_episodes()
        elif self.jf["page"] == "home":
            self.jf_load_home()

    # ---------- Einstellungen ----------

    def jf_open_settings(self, message=""):
        j = self.jf
        j.update(page="settings", title="Jellyfin-Einstellungen", focus="content", error=message, loading=False)
        j["navIndex"] = len(j["nav"]) - 1 if j["nav"] else 0
        self.jf_settings_items()

    def jf_settings_items(self):
        s = self.settings
        logged_in = bool(s.get("jellyfin_token"))
        items = [
            {"kind": "header", "label": "Server"},
            {"kind": "action", "label": "Serveradresse", "hint": (s.get("jellyfin_url") or "nicht festgelegt").replace("http://", ""),
             "id": "url"},
            {"kind": "action", "label": "Server im Heimnetz suchen", "id": "find"},
            {"kind": "header", "label": "Konto"},
            {"kind": "info", "label": "Angemeldet als", "value": s.get("jellyfin_user") or "nicht angemeldet"},
        ]
        if logged_in:
            items.append({"kind": "action", "label": "Abmelden", "id": "logout"})
        items += [{"kind": "action", "label": "Anmelden mit Quick Connect", "hint": "Code am Handy bestätigen", "id": "qc"},
                  {"kind": "action", "label": "Anmelden mit Name und Passwort", "id": "pw"}]
        self.jf["items"] = items
        focusable = [i for i, it in enumerate(items) if it["kind"] == "action"]
        if self.jf["item"] not in focusable:
            self.jf["item"] = focusable[0]

    def jf_setting(self, item_id):
        if item_id == "url":
            current = self.settings.get("jellyfin_url") or "http://"

            def done(url):
                url = url.strip().rstrip("/")
                if not url:
                    self.osk["error"] = "Bitte eine Adresse eingeben"
                    return
                if not url.startswith(("http://", "https://")):
                    url = "http://" + url
                if ":" not in url.split("//", 1)[1]:
                    url += ":8096"
                self.osk = None
                self.jf_set_server(url)
            self.open_osk("Adresse des Jellyfin-Servers (z. B. 192.168.178.38:8096)", "url", done, current)
        elif item_id == "find":
            self.jf_find_server()
        elif item_id == "logout":
            self.jf_client().logout()
            self.jf_forget_login()
            self.notice("Bei Jellyfin abgemeldet")
        elif item_id == "qc":
            self.jf_quick_connect()
        elif item_id == "pw":
            self.jf_password_login()

    def jf_set_server(self, url):
        """Neue Serveradresse prüfen und übernehmen (Anmeldung gilt nur für den alten Server)."""
        self.busy(f"Prüfe {url} …")

        def done(ok):
            if not ok:
                self.notice(f"Unter {url.replace('http://', '')} antwortet kein Jellyfin-Server")
                return
            changed = url != self.settings.get("jellyfin_url")
            self.set("jellyfin_url", url)
            if changed:
                self.jf_forget_login()
            self.notice(f"Server gespeichert: {url.replace('http://', '')}")
            self.jf_settings_items()
        self.run_bg(lambda: cfg.reachable(url, timeout=3), done)

    def jf_find_server(self, then_home=False):
        self.busy("Suche Jellyfin-Server im Heimnetz …")

        def done(url):
            if not url:
                self.notice("Kein Jellyfin-Server gefunden – Adresse bitte selbst eingeben")
                if self.jf:
                    self.jf_build_nav(self.jf["views"])
                    self.jf_open_settings()
                return
            self.dialog = None
            changed = url.rstrip("/") != self.settings.get("jellyfin_url")
            self.set("jellyfin_url", url.rstrip("/"))
            if changed:
                self.jf_forget_login()
            if then_home and self.settings.get("jellyfin_token"):
                self.jf_load_home()
            elif self.jf:
                self.jf_build_nav(self.jf["views"])
                self.jf_open_settings("" if not then_home else "Server gefunden – bitte anmelden")
                if not changed and not then_home:
                    self.notice(f"Server gefunden: {url.replace('http://', '')}")
        self.run_bg(cfg.discover_jellyfin, done)

    def jf_forget_login(self):
        for key in ("jellyfin_token", "jellyfin_user_id", "jellyfin_user"):
            self.settings[key] = ""
        self.save_settings()
        if self.jf:
            self.jf_settings_items()

    def jf_logged_in(self, client, name):
        self.settings.update(jellyfin_token=client.token, jellyfin_user_id=client.user_id, jellyfin_user=name)
        self.save_settings()
        self.notice(f"Angemeldet als {name}")
        self.jf_load_home()

    def jf_quick_connect(self):
        client = self.jf_client()
        client.token = ""

        def started(result):
            code, secret = result
            self.jf_qc = {"secret": secret, "until": time.monotonic() + 300}
            self.dialog = {"text": f"Code {code} in der Jellyfin-App bestätigen", "index": 0,
                           "sub": "Am Handy: Jellyfin → Einstellungen → Quick Connect → Code eingeben",
                           "buttons": [("Abbrechen", self.jf_quick_connect_cancel)],
                           "cancel": self.jf_quick_connect_cancel}
            poll()

        def poll():
            qc = getattr(self, "jf_qc", None)
            if not qc or time.monotonic() > qc["until"]:
                return

            def done(result):
                ok, value = result
                if not getattr(self, "jf_qc", None):
                    return
                if ok and value:
                    self.jf_qc = None
                    self.jf_logged_in(client, value)
                elif ok:
                    from PyQt5.QtCore import QTimer
                    QTimer.singleShot(2000, lambda: (poll(), self.push()))
                else:
                    self.jf_qc = None
                    self.notice(f"Quick Connect fehlgeschlagen: {value}")

            def check():
                try:
                    return True, client.quick_connect_poll(qc["secret"])
                except jf.JellyfinError as e:
                    return False, str(e)
            self.run_bg(check, done)

        def failed_or_started(result):
            ok, value = result
            if ok:
                started(value)
            else:
                self.notice(f"Quick Connect geht nicht: {value}")

        def start():
            try:
                return True, client.quick_connect_start()
            except jf.JellyfinError as e:
                return False, str(e)
        self.busy("Quick Connect wird gestartet …")
        self.run_bg(start, failed_or_started)

    def jf_quick_connect_cancel(self):
        self.jf_qc = None
        self.dialog = None

    def jf_password_login(self):
        def got_name(name):
            if not name.strip():
                self.osk["error"] = "Bitte einen Namen eingeben"
                return

            def got_password(password):
                self.osk = None
                client = self.jf_client()
                client.token = ""
                self.busy("Anmelden …")

                def work():
                    try:
                        return True, client.login(name.strip(), password)
                    except jf.JellyfinError as e:
                        return False, str(e)

                def done(result):
                    ok, value = result
                    if ok:
                        self.jf_logged_in(client, value)
                    else:
                        self.notice(f"Anmeldung fehlgeschlagen: {value}")
                self.run_bg(work, done)
            self.open_osk(f"Passwort für {name.strip()}", "password", got_password)
        self.open_osk("Jellyfin-Benutzername", "password", got_name)

    # ---------- Tasten ----------

    def jellyfin_key(self, key):
        j = self.jf
        if j["playing"] and self.mpv.running():
            self.mpv.key(key)
            if key == "home":
                self.jf_close()
            return
        if key == "home":
            return self.jf_close()
        if key == "menu":
            return
        if j["focus"] == "nav":  # Leiste oben: ◀ ▶ wählen, OK öffnen, ▼ in den Inhalt
            nav = j["nav"]
            if key in ("left", "right") and nav:
                j["navIndex"] = min(max(j["navIndex"] + (-1 if key == "left" else 1), 0), len(nav) - 1)
            elif key == "ok" and nav:
                self.jf_nav_select(j["navIndex"])
                if j["page"] == "search":
                    self.jf_ask_search()
                else:
                    j["focus"] = "content"
            elif key == "down":
                j["focus"] = "content"
            elif key == "back":
                self.jf_close()
            return
        page = j["page"]
        if page == "home":
            self.jf_rows_key(key)
        elif page in ("library", "search"):
            self.jf_grid_key(key)
        elif page == "detail":
            self.jf_detail_key(key)
        elif page == "settings":
            self.jf_settings_key(key)

    def jf_to_nav(self):
        self.jf["focus"] = "nav"

    def jf_rows_key(self, key):
        j = self.jf
        rows = j["rows"]
        if not rows:
            return self.jf_to_nav() if key in ("up", "back") else None
        if key == "back" or (key == "up" and j["row"] == 0):
            return self.jf_to_nav()
        if key in ("up", "down"):
            r = min(max(j["row"] + (-1 if key == "up" else 1), 0), len(rows) - 1)
            j["row"], j["col"] = r, min(j["col"], len(rows[r]["items"]) - 1)
        elif key == "left":
            j["col"] = max(j["col"] - 1, 0)
        elif key == "right":
            j["col"] = min(j["col"] + 1, len(rows[j["row"]]["items"]) - 1)
        elif key == "ok":
            card = rows[j["row"]]["items"][j["col"]]
            if rows[j["row"]]["wide"] and card["type"] in ("Episode", "Movie"):
                # Weiterschauen / Nächste Folge: direkt abspielen
                self.jf_play_card(card)
            else:
                self.jf_open_item(card)

    def jf_play_card(self, card):
        client = self.jf_client()

        def done(item):
            resume = ((item.get("UserData") or {}).get("PlaybackPositionTicks") or 0) / jf.TICKS
            name = item.get("Name", "")
            if item.get("SeriesName"):
                name = f"{item['SeriesName']} – {name}"
            self.jf_play(item["Id"], name, resume)
        self.jf_run(lambda: client.item(card["id"]), done, loading=False)

    def jf_grid_key(self, key):
        j = self.jf
        grid = j["grid"]
        if key == "back" or (key == "up" and j["row"] == 0) or not grid:
            if key == "ok" and j["page"] == "search":
                return self.jf_ask_search()
            return self.jf_to_nav() if key in ("up", "back") else None
        index = j["row"] * GRID_COLS + j["col"]
        if key == "left":
            index = index - 1 if index % GRID_COLS else index
        elif key == "right":
            index = min(index + 1, len(grid) - 1) if (index + 1) % GRID_COLS else index
        elif key == "up":
            index = max(index - GRID_COLS, index % GRID_COLS)
        elif key == "down":
            index = min(index + GRID_COLS, len(grid) - 1) if index + GRID_COLS < len(grid) or \
                index // GRID_COLS < (len(grid) - 1) // GRID_COLS else index
        elif key == "ok":
            card = grid[index]
            return self.jf_play_card(card) if card["type"] == "Episode" else self.jf_open_item(card)
        j["row"], j["col"] = divmod(index, GRID_COLS)

    def jf_ask_search(self):
        def done(term):
            if not term.strip():
                self.osk["error"] = "Bitte einen Suchbegriff eingeben"
                return
            self.osk = None
            self.jf_search(term.strip())
        self.open_osk("In Jellyfin suchen", "text", done, self.jf.get("query", ""))

    def jf_detail_key(self, key):
        j = self.jf
        d = j["detail"]
        if not d:
            return
        if key == "back":
            if not self.jf_go_back():
                self.jf_to_nav()
            return
        if d["type"] != "Series":  # Film oder Folge: Knopfreihe
            if key == "up":
                return self.jf_to_nav()
            if key in ("left", "right"):
                b = j["button"] + (-1 if key == "left" else 1)
                j["button"] = min(max(b, 0), len(j["buttons"]) - 1)
            elif key == "ok" and j["buttons"]:
                start = d["resume"] if j["buttons"][j["button"]]["id"] == "resume" else 0.0
                name = f"{d['series']} – {d['title']}" if d["series"] else d["title"]
                self.jf_play(d["id"], name, start)
            return
        # Serie: Zone 0 = Staffeln, Zone 1 = Folgen
        if key == "up" and j["zone"] == 0:
            return self.jf_to_nav()
        if key in ("up", "down"):
            j["zone"] = 0 if key == "up" else (1 if j["episodes"] else 0)
        elif j["zone"] == 0:
            if key in ("left", "right") and j["seasons"]:
                s = min(max(j["season"] + (-1 if key == "left" else 1), 0), len(j["seasons"]) - 1)
                if s != j["season"]:
                    j["season"], j["episodes"], j["episode"] = s, [], 0
                    self.jf_load_episodes()
            elif key == "ok" and j["episodes"]:
                j["zone"] = 1
        else:
            eps = j["episodes"]
            if key in ("left", "right") and eps:
                e = j["episode"] + (-1 if key == "left" else 1)
                j["episode"] = min(max(e, 0), len(eps) - 1)
            elif key == "ok" and eps:
                ep = eps[j["episode"]]
                start = ep.get("resume", 0) if ep.get("resume", 0) > 30 else 0.0
                self.jf_play(ep["id"], f"{d['title']} – {ep['title']}", start)

    def jf_settings_key(self, key):
        j = self.jf
        items = j["items"]
        if key == "back":
            return self.jf_to_nav()
        if key in ("up", "down"):
            step = -1 if key == "up" else 1
            i = j["item"] + step
            while 0 <= i < len(items) and items[i]["kind"] != "action":
                i += step
            if 0 <= i < len(items):
                j["item"] = i
            elif key == "up":
                return self.jf_to_nav()  # ganz oben: zur Leiste
        elif key == "ok":
            self.jf_setting(items[j["item"]]["id"])
