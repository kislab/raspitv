"""Konten in der Oberfläche: „Wer schaut?“, Kontowechsel, Konten anlegen/ändern, PIN und
Bildschirmtastatur. Wird als Mixin von raspitv.Home benutzt; gezeichnet wird in qml/."""
import secrets

from PyQt5.QtCore import QBuffer, QByteArray, QIODevice, Qt
from PyQt5.QtGui import QImage

import accounts
import phone
import settings as cfg

AVATAR_COLS = 8
AVATAR_EMOJIS = [""] + accounts.EMOJIS   # "" = Anfangsbuchstabe

PIN_LEN = 4
TEXT_KEYS = [list("ABCDEFGHIJ"), list("KLMNOPQRST"), list("UVWXYZÄÖÜß"), list("1234567890-"),
             ["Leerzeichen", "⌫", "Fertig", "phone"]]
PIN_KEYS = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["⌫", "0", "Fertig", "phone"]]
# Passwörter (WLAN): Groß/klein per ⇧, dazu Sonderzeichen; Buchstaben werden nicht automatisch groß
PASS_KEYS = [list("1234567890ß"), list("qwertzuiopü"), list("asdfghjklöä"), ["⇧"] + list("yxcvbnm-_."),
             list("!@#$%&*?+=/:"), ["Leerzeichen", "⌫", "Fertig", "phone"]]
# "phone" (letzte Taste, Handy-Symbol): stattdessen auf dem Handy tippen (Handy-Fernbedienung)
MAX_LEN = {"pin": PIN_LEN, "text": 20, "password": 63, "url": 100}


class AccountsUI:
    # ---------- Zustand ----------

    def init_accounts(self):
        self.acc_data = accounts.load()
        last = accounts.find(self.acc_data, self.acc_data.get("last")) or self.acc_data["accounts"][0]
        self.account = last
        self.avatar_pick = None  # Profilbild-Auswahl: {"account", "row", "col", "token", "qr", "url"}
        self.osk = None      # Bildschirmtastatur: {"title", "value", "mode", "row", "col", "done", "error"}
        self.prof = 0        # gewähltes Konto in „Wer schaut?“
        self.head_col = 1    # Kopfzeile: 0 = Konto, 1 = Einstellungen
        self.settings = cfg.load(accounts.settings_file(last))
        # Mehrere Konten oder eine PIN: beim Start fragen, wer schaut
        self.start_view = "profiles" if len(self.acc_data["accounts"]) > 1 or last.get("pin") else "home"
        self.prof = self.acc_data["accounts"].index(last)
        self.locked = self.start_view == "profiles"  # ohne Auswahl geht Zurück nicht zur Startseite

    def profile_path(self):
        profile = accounts.profile_dir(self.account)
        profile.mkdir(parents=True, exist_ok=True)
        accounts.ensure_widevine(profile)
        return profile

    def save_settings(self):
        cfg.save(self.settings, accounts.settings_file(self.account))

    # ---------- Konto wählen ----------

    def open_profiles(self):
        self.player.stop()
        self.running = None
        self.view = "profiles"
        self.menu = self.dialog = None
        self.prof = max(0, self.acc_data["accounts"].index(self.account)) if self.account in self.acc_data["accounts"] else 0

    def profile_entries(self):
        """Konten plus Eintrag „Konto hinzufügen“."""
        return self.acc_data["accounts"] + [None]

    def profiles_key(self, key):
        entries = self.profile_entries()
        if key in ("left", "right"):
            self.prof = min(max(self.prof + (-1 if key == "left" else 1), 0), len(entries) - 1)
        elif key == "ok":
            account = entries[self.prof]
            if account is None:
                self.add_account()
            else:
                self.with_pin(account, lambda: self.activate(account))
        elif key == "menu":
            account = entries[self.prof]
            if account is not None:
                self.open_profile_menu(account)
        elif key == "back":
            if self.account in self.acc_data["accounts"] and not self.locked:
                self.view = "home"

    def activate(self, account):
        self.account = account
        self.locked = False
        self.acc_data["last"] = account["id"]
        accounts.save(self.acc_data)
        self.settings = cfg.load(accounts.settings_file(account))
        self.col = 0
        self.row = 1
        self.refresh_apps()
        self.view = "home"

    def with_pin(self, account, action, title=None):
        """`action` ausführen – bei Konten mit PIN erst nach richtiger Eingabe."""
        if not account.get("pin"):
            return action()

        def check(pin):
            if accounts.check_pin(account, pin):
                self.osk = None
                action()
            else:
                self.osk["value"] = ""
                self.osk["error"] = "Falsche PIN – bitte noch einmal"
        self.open_osk(title or f"PIN für {account['name']}", "pin", check)

    # ---------- Konten verwalten ----------

    def add_account(self):
        def done(name):
            name = name.strip()
            if not name:
                self.osk["error"] = "Bitte einen Namen eingeben"
                return
            self.osk = None
            account = accounts.create(self.acc_data, name)
            cfg.save(dict(cfg.load(), **cfg.defaults_for_new_account()), accounts.settings_file(account))
            self.prof = self.acc_data["accounts"].index(account)
        self.open_osk("Name des neuen Kontos", "text", done)

    def open_profile_menu(self, account):
        items = [("Profilbild ändern", lambda: self.with_pin(account, lambda: self.open_avatar_pick(account))),
                 ("Umbenennen", lambda: self.with_pin(account, lambda: self.rename_account(account))),
                 ("PIN ändern" if account.get("pin") else "PIN festlegen",
                  lambda: self.with_pin(account, lambda: self.new_pin(account)))]
        if account.get("pin"):
            items.append(("PIN entfernen", lambda: self.with_pin(account, lambda: self.remove_pin(account))))
        if len(self.acc_data["accounts"]) > 1:
            items.append(("Konto löschen", lambda: self.with_pin(account, lambda: self.ask_delete(account))))
        self.menu = {"items": items, "index": 0, "title": account["name"], "anchor": "profile",
                     "at": self.acc_data["accounts"].index(account)}

    # ---------- Profilbild ----------
    # Raster: Zeile 0 Hintergrundfarben, Zeilen 1–3 kleine Bilder (zuerst der Anfangsbuchstabe), Zeile 4 „Fertig“.
    # Daneben ein QR-Code: Foto vom Handy hochladen (phone.py /avatar, Einmal-Schlüssel nur solange offen).

    def open_avatar_pick(self, account, on_done=None):
        current = account.get("avatar", "")
        emoji = current[6:] if current.startswith("emoji:") else ""
        row, col = (1 + AVATAR_EMOJIS.index(emoji) // AVATAR_COLS, AVATAR_EMOJIS.index(emoji) % AVATAR_COLS) \
            if emoji in AVATAR_EMOJIS and current != "image" else (0, max(0, accounts.COLORS.index(account["color"]))
                                                                        if account["color"] in accounts.COLORS else 0)
        token = secrets.token_urlsafe(12)
        qr, url = [], ""
        self.avatar_server_started = False
        if self.phone.running() or self.phone.start():
            self.avatar_server_started = not self.settings["phone_remote"]
            self.phone.upload = {"token": token, "done": lambda data: self.bgDone.emit(lambda: self.avatar_uploaded(data))}
            url = f"http://{cfg.ip_address()}:{phone.PORT}/avatar#t={token}"
            matrix = phone.qr_matrix(url)
            qr = ["".join("1" if c else "0" for c in r) for r in matrix] if matrix else []
        self.avatar_pick = {"account": account, "row": row, "col": col, "qr": qr,
                            "url": f"{cfg.ip_address()}:{phone.PORT}/avatar" if url else "", "on_done": on_done}
        self.menu = None

    def avatar_state(self):
        a = self.avatar_pick
        if not a:
            return None
        return {"account": self.account_info(a["account"]), "row": a["row"], "col": a["col"], "qr": a["qr"],
                "url": a["url"], "colors": accounts.COLORS, "emojis": AVATAR_EMOJIS, "cols": AVATAR_COLS}

    def avatar_rows(self):
        return [len(accounts.COLORS)] + [AVATAR_COLS] * (-(-len(AVATAR_EMOJIS) // AVATAR_COLS)) + [1]

    def avatar_key(self, key):
        a = self.avatar_pick
        rows = self.avatar_rows()
        if key in ("up", "down"):
            r = min(max(a["row"] + (1 if key == "down" else -1), 0), len(rows) - 1)
            last = len(AVATAR_EMOJIS) - 1 - (r - 1) * AVATAR_COLS if 1 <= r < len(rows) - 1 else rows[r] - 1
            a["row"], a["col"] = r, min(a["col"], last, rows[r] - 1)
        elif key in ("left", "right"):
            last = rows[a["row"]] - 1
            if 1 <= a["row"] < len(rows) - 1:
                last = min(last, len(AVATAR_EMOJIS) - 1 - (a["row"] - 1) * AVATAR_COLS)
            a["col"] = min(max(a["col"] + (1 if key == "right" else -1), 0), last)
        elif key == "ok":
            account = a["account"]
            if a["row"] == 0:
                accounts.set_avatar(self.acc_data, account, color=accounts.COLORS[a["col"]])
            elif a["row"] < len(rows) - 1:
                accounts.set_avatar(self.acc_data, account, emoji=AVATAR_EMOJIS[(a["row"] - 1) * AVATAR_COLS + a["col"]])
            else:
                self.close_avatar_pick()
                return
            if a["on_done"]:
                a["on_done"]()
        elif key in ("back", "home"):
            self.close_avatar_pick()

    def avatar_uploaded(self, data):
        """Foto vom Handy: quadratisch zuschneiden, auf 320 px verkleinern, als JPEG speichern."""
        a = self.avatar_pick
        if not a:
            return
        image = QImage.fromData(data)
        if image.isNull():
            return self.show_toast("Das Bild ließ sich nicht öffnen")
        side = min(image.width(), image.height())
        image = image.copy((image.width() - side) // 2, (image.height() - side) // 2, side, side)
        image = image.scaled(320, 320, Qt.IgnoreAspectRatio, Qt.SmoothTransformation)
        buf = QByteArray()
        dev = QBuffer(buf)
        dev.open(QIODevice.WriteOnly)
        image.save(dev, "JPEG", 88)
        accounts.set_avatar(self.acc_data, a["account"], image=bytes(buf))
        if a["on_done"]:
            a["on_done"]()
        self.show_toast("Foto als Profilbild übernommen")
        self.close_avatar_pick()

    def close_avatar_pick(self):
        self.avatar_pick = None
        self.phone.upload = None
        if getattr(self, "avatar_server_started", False) and not self.settings["phone_remote"]:
            self.phone.stop()  # war nur fürs Hochladen an

    def rename_account(self, account):
        def done(name):
            if not name.strip():
                self.osk["error"] = "Bitte einen Namen eingeben"
                return
            self.osk = None
            account["name"] = name.strip()[:20]
            accounts.save(self.acc_data)
        self.open_osk("Neuer Name", "text", done, account["name"])

    def new_pin(self, account):
        def first(pin):
            def second(again):
                if again != pin:
                    self.osk = None
                    self.dialog = {"text": "Die PINs stimmen nicht überein", "buttons": [("OK", self.close_dialog)], "index": 0}
                    return
                self.osk = None
                accounts.set_pin(self.acc_data, account, pin)
                self.dialog = {"text": f"PIN für {account['name']} gespeichert", "buttons": [("OK", self.close_dialog)], "index": 0}
            self.open_osk("PIN wiederholen", "pin", second)
        self.open_osk(f"Neue PIN für {account['name']}", "pin", first)

    def remove_pin(self, account):
        accounts.set_pin(self.acc_data, account, "")
        self.dialog = {"text": f"PIN für {account['name']} entfernt", "buttons": [("OK", self.close_dialog)], "index": 0}

    def ask_delete(self, account):
        def delete():
            self.dialog = None
            accounts.delete(self.acc_data, account)
            if account is self.account:
                self.account = self.acc_data["accounts"][0]
                self.locked = True  # erst ein anderes Konto wählen
            self.prof = 0
        self.dialog = {"text": f"{account['name']} löschen? Logins dieses Kontos werden entfernt.",
                       "buttons": [("Abbrechen", self.close_dialog), ("Löschen", delete)], "index": 0}

    # ---------- Bildschirmtastatur ----------

    def open_osk(self, title, mode, done, value=""):
        self.osk = {"title": title, "value": value, "mode": mode, "row": 0, "col": 0, "done": done, "error": "",
                    "shift": False, "hint": ""}
        self.menu = None

    def osk_rows(self):
        mode = self.osk["mode"]
        if mode in ("password", "url"):
            return [[k.upper() if self.osk["shift"] and len(k) == 1 and k.isalpha() and k != "ß" else k for k in row]
                    for row in PASS_KEYS]
        return PIN_KEYS if mode == "pin" else TEXT_KEYS

    def osk_key(self, key):
        o, rows = self.osk, self.osk_rows()
        if key in ("back", "home", "menu"):
            self.osk = None
        elif key in ("up", "down"):
            r = min(max(o["row"] + (-1 if key == "up" else 1), 0), len(rows) - 1)
            o["col"] = round(o["col"] / max(len(rows[o["row"]]) - 1, 1) * (len(rows[r]) - 1))
            o["row"] = r
        elif key in ("left", "right"):
            o["col"] = min(max(o["col"] + (-1 if key == "left" else 1), 0), len(rows[o["row"]]) - 1)
        elif key == "ok":
            self.osk_press(rows[o["row"]][o["col"]])

    def osk_press(self, label):
        o = self.osk
        o["error"] = ""
        if label == "phone":
            self.osk_phone()
        elif label == "⌫":
            o["value"] = o["value"][:-1]
        elif label == "Fertig":
            o["done"](o["value"])
        elif label == "⇧":
            o["shift"] = not o["shift"]
        elif label == "Leerzeichen":
            if len(o["value"]) < MAX_LEN[o["mode"]]:
                o["value"] += " "
        elif o["mode"] == "pin":
            if len(o["value"]) < PIN_LEN:
                o["value"] += label
            if len(o["value"]) == PIN_LEN:
                o["done"](o["value"])
        elif o["mode"] in ("password", "url"):
            if len(o["value"]) < MAX_LEN[o["mode"]]:
                o["value"] += label
        elif len(o["value"]) < MAX_LEN["text"]:
            first = not o["value"] or o["value"].endswith(" ")
            o["value"] += label if first else label.lower()

    def osk_type(self, event):
        """Echte Tastatur in der Bildschirmtastatur: tippen, löschen, Enter = fertig."""
        if not self.osk:
            return False
        k = event.key()
        if k == Qt.Key_Escape:
            self.osk = None
        elif k == Qt.Key_Backspace:
            self.osk_press("⌫")
        elif k in (Qt.Key_Return, Qt.Key_Enter):
            if not event.isAutoRepeat():
                self.osk["done"](self.osk["value"])
        elif event.text() and event.text().isprintable() and k not in (Qt.Key_Up, Qt.Key_Down, Qt.Key_Left, Qt.Key_Right):
            ch = event.text()
            if self.osk["mode"] == "pin" and not ch.isdigit():
                return True
            if self.osk["mode"] == "pin":
                self.osk_press(ch)
            elif len(self.osk["value"]) < MAX_LEN[self.osk["mode"]]:
                self.osk["value"] += ch
                self.osk["error"] = ""
        else:
            return False
        return True
