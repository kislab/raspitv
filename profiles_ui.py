"""Konten in der Oberfläche: „Wer schaut?“, Kontowechsel, Konten anlegen/ändern, PIN und
Bildschirmtastatur. Wird als Mixin von raspitv.Home benutzt (braucht dessen Zeichen-Helfer)."""
import time

from PyQt5.QtCore import QPointF, QRectF, Qt
from PyQt5.QtGui import QColor, QFont, QPen

import accounts
import settings as cfg

TEXT = QColor("#e8eaed")
MUTED = QColor("#9aa0a6")
DARK = QColor("#202124")
CARD = QColor("#22252b")
BG = QColor("#0e1013")

PIN_LEN = 4
TEXT_KEYS = [list("ABCDEFGHIJ"), list("KLMNOPQRST"), list("UVWXYZÄÖÜß"), list("1234567890-"),
             ["Leerzeichen", "⌫", "Fertig"]]
PIN_KEYS = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["⌫", "0", "Fertig"]]


class AccountsUI:
    # ---------- Zustand ----------

    def init_accounts(self):
        self.acc_data = accounts.load()
        last = accounts.find(self.acc_data, self.acc_data.get("last")) or self.acc_data["accounts"][0]
        self.account = last
        self.osk = None      # Bildschirmtastatur: {"title", "value", "mode", "row", "col", "done", "error"}
        self.prof = 0        # gewähltes Konto in „Wer schaut?“
        self.head_col = 1    # Kopfzeile: 0 = Konto, 1 = Einstellungen
        self.profile_rects = {}
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
        self.hero = self.hero_prev = self.apps[0]
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
        items = [("Umbenennen", lambda: self.with_pin(account, lambda: self.rename_account(account))),
                 ("PIN ändern" if account.get("pin") else "PIN festlegen",
                  lambda: self.with_pin(account, lambda: self.new_pin(account)))]
        if account.get("pin"):
            items.append(("PIN entfernen", lambda: self.with_pin(account, lambda: self.remove_pin(account))))
        if len(self.acc_data["accounts"]) > 1:
            items.append(("Konto löschen", lambda: self.with_pin(account, lambda: self.ask_delete(account))))
        self.menu = {"items": items, "index": 0, "title": account["name"], "anchor": self.profile_rects.get(account["id"])}

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
        self.osk = {"title": title, "value": value, "mode": mode, "row": 0, "col": 0, "done": done, "error": ""}
        self.menu = None

    def osk_rows(self):
        return PIN_KEYS if self.osk["mode"] == "pin" else TEXT_KEYS

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
        if label == "⌫":
            o["value"] = o["value"][:-1]
        elif label == "Fertig":
            o["done"](o["value"])
        elif label == "Leerzeichen":
            o["value"] += " "
        elif o["mode"] == "pin":
            if len(o["value"]) < PIN_LEN:
                o["value"] += label
            if len(o["value"]) == PIN_LEN:
                o["done"](o["value"])
        elif len(o["value"]) < 20:
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
            elif len(self.osk["value"]) < 20:
                self.osk["value"] += ch
                self.osk["error"] = ""
        else:
            return False
        self.update()
        return True

    # ---------- Zeichnen ----------

    def paint_avatar(self, p, center, r, account, focus=0.0):
        p.setPen(Qt.NoPen)
        if focus > 0.02:
            p.setBrush(QColor(255, 255, 255, round(255 * focus)))
            p.drawEllipse(center, r + 0.3 * self.width() / 80 * focus, r + 0.3 * self.width() / 80 * focus)
        p.setBrush(QColor(account["color"]))
        p.drawEllipse(center, r, r)
        self.text(p, QRectF(center.x() - r, center.y() - r, 2 * r, 2 * r), account["name"][:1].upper(),
                  r * 1.05, QColor("#ffffff"), QFont.Bold, Qt.AlignCenter)

    def paint_profiles(self, p, W, H, u):
        p.fillRect(self.rect(), BG)
        self.text(p, QRectF(0, 1.5 * u, W, 2.6 * u), "RaspiTV", 1.7 * u, QColor("#ffffff"), QFont.ExtraBold, Qt.AlignCenter)
        self.text(p, QRectF(0, H * 0.24, W, 4 * u), "Wer schaut?", 2.8 * u, QColor("#ffffff"), QFont.DemiBold, Qt.AlignCenter)
        entries = self.profile_entries()
        r, gap = 4.2 * u, 4.5 * u
        total = len(entries) * 2 * r + (len(entries) - 1) * gap
        x = (W - total) / 2 + r
        cy = H * 0.5
        self.profile_rects = {}
        for i, account in enumerate(entries):
            focused = i == self.prof and not self.osk and not self.menu and not self.dialog
            rr = r * (1.12 if focused else 1.0)
            c = QPointF(x, cy)
            if account is None:  # Konto hinzufügen
                p.setPen(QPen(TEXT if focused else MUTED, 0.2 * u, Qt.DashLine if not focused else Qt.SolidLine))
                p.setBrush(QColor(255, 255, 255, 40 if focused else 12))
                p.drawEllipse(c, rr, rr)
                p.setPen(QPen(TEXT, 0.3 * u, Qt.SolidLine, Qt.RoundCap))
                p.drawLine(QPointF(x - 1.2 * u, cy), QPointF(x + 1.2 * u, cy))
                p.drawLine(QPointF(x, cy - 1.2 * u), QPointF(x, cy + 1.2 * u))
                label = "Konto hinzufügen"
            else:
                self.paint_avatar(p, c, rr, account, 1.0 if focused else 0.0)
                self.profile_rects[account["id"]] = QRectF(x - r, cy - r, 2 * r, 2 * r)
                label = account["name"]
                if account.get("pin"):  # Schloss
                    lc = QPointF(x + rr * 0.72, cy + rr * 0.72)
                    p.setPen(Qt.NoPen)
                    p.setBrush(QColor("#ffffff"))
                    p.drawEllipse(lc, 0.95 * u, 0.95 * u)
                    p.setBrush(DARK)
                    p.drawRoundedRect(QRectF(lc.x() - 0.45 * u, lc.y() - 0.1 * u, 0.9 * u, 0.65 * u), 0.1 * u, 0.1 * u)
                    p.setPen(QPen(DARK, 0.16 * u))
                    p.setBrush(Qt.NoBrush)
                    p.drawArc(QRectF(lc.x() - 0.3 * u, lc.y() - 0.55 * u, 0.6 * u, 0.7 * u), 0, 180 * 16)
            self.text(p, QRectF(x - r - 2 * u, cy + r + 1.4 * u, 2 * r + 4 * u, 2 * u), label, 1.15 * u,
                      QColor("#ffffff") if focused else MUTED, QFont.DemiBold if focused else QFont.Normal, Qt.AlignCenter)
            x += 2 * r + gap
        hint = "OK lange drücken: Konto bearbeiten"
        self.text(p, QRectF(0, H - 4 * u, W, 2 * u), hint, 0.95 * u, MUTED, QFont.Normal, Qt.AlignCenter)

    def paint_osk(self, p, W, H, u):
        o = self.osk
        p.fillRect(self.rect(), QColor(0, 0, 0, 200))
        rows = self.osk_rows()
        pin = o["mode"] == "pin"
        key_w, key_h, gap = (5.2 if pin else 3.6) * u, 3.0 * u, 0.5 * u
        widths = [[(key_w * (3.2 if len(k) > 1 and not pin else 1)) for k in row] for row in rows]
        row_ws = [sum(w) + gap * (len(w) - 1) for w in widths]
        card_w = max(max(row_ws) + 6 * u, 40 * u)
        card_h = 12 * u + len(rows) * (key_h + gap)
        card = QRectF((W - card_w) / 2, (H - card_h) / 2, card_w, card_h)
        p.setPen(Qt.NoPen)
        p.setBrush(CARD)
        p.drawRoundedRect(card, 1.6 * u, 1.6 * u)
        self.text(p, QRectF(card.x(), card.y() + 1.6 * u, card_w, 2.4 * u), o["title"], 1.5 * u, QColor("#ffffff"), QFont.DemiBold, Qt.AlignCenter)

        field = QRectF(card.x() + 3 * u, card.y() + 4.6 * u, card_w - 6 * u, 3 * u)
        if pin:  # vier Felder mit Punkten
            box, bgap = 3 * u, 1.2 * u
            bx = W / 2 - (PIN_LEN * box + (PIN_LEN - 1) * bgap) / 2
            for i in range(PIN_LEN):
                rect = QRectF(bx + i * (box + bgap), field.y(), box, box)
                p.setPen(QPen(TEXT if i == len(o["value"]) else QColor(255, 255, 255, 60), 0.15 * u))
                p.setBrush(QColor(255, 255, 255, 18))
                p.drawRoundedRect(rect, 0.5 * u, 0.5 * u)
                if i < len(o["value"]):
                    p.setPen(Qt.NoPen)
                    p.setBrush(TEXT)
                    p.drawEllipse(rect.center(), 0.5 * u, 0.5 * u)
        else:
            p.setPen(Qt.NoPen)
            p.setBrush(QColor(255, 255, 255, 22))
            p.drawRoundedRect(field, 0.6 * u, 0.6 * u)
            cursor = "|" if int(time.monotonic()) % 2 == 0 else " "  # blinkt im Sekundentakt
            self.text(p, field.adjusted(1.2 * u, 0, -1.2 * u, 0), o["value"] + cursor, 1.4 * u, QColor("#ffffff"))
        if o["error"]:
            self.text(p, QRectF(card.x(), field.bottom() + 0.3 * u, card_w, 1.8 * u), o["error"], 1.0 * u, QColor("#f28b82"), QFont.Normal, Qt.AlignCenter)

        y = card.y() + 10 * u
        for r, row in enumerate(rows):
            x = (W - row_ws[r]) / 2
            for c, label in enumerate(row):
                rect = QRectF(x, y, widths[r][c], key_h)
                focused = r == o["row"] and c == o["col"]
                p.setPen(Qt.NoPen)
                p.setBrush(TEXT if focused else QColor(255, 255, 255, 26))
                p.drawRoundedRect(rect, 0.6 * u, 0.6 * u)
                self.text(p, rect, label, 1.2 * u, DARK if focused else TEXT, QFont.DemiBold, Qt.AlignCenter)
                x += widths[r][c] + gap
            y += key_h + gap
