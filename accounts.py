"""Konten von RaspiTV: jedes Konto hat ein eigenes Player-Profil (eigene Logins bei Netflix, Disney+,
YouTube …), eigene Kachel-Einstellungen und auf Wunsch eine PIN.

Gespeichert wird nur Name, Farbe, Profilbild (Emoji oder Foto) und ein Hash der PIN – Zugangsdaten der Dienste bleiben im
Browser-Profil des jeweiligen Kontos (~/.local/share/raspitv/accounts/<id>/player).
"""
import hashlib
import json
import os
import pwd
import secrets
import shutil
from pathlib import Path

CONFIG_HOME = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
DATA = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / "raspitv"
FILE = CONFIG_HOME / "raspitv" / "accounts.json"
SETTINGS_DIR = CONFIG_HOME / "raspitv" / "accounts"
AVATARS = DATA / "avatars"  # Fotos als Profilbild: <Konto-ID>.jpg

# Kontofarben wie bei Google TV: kräftig, gut lesbar mit weißem Anfangsbuchstaben
COLORS = ["#1a73e8", "#e8710a", "#188038", "#a142f4", "#d93025", "#007b83", "#e52592", "#5f6368"]
# Kleine Bilder fürs Profil (Noto Color Emoji ist auf Raspberry Pi OS dabei)
EMOJIS = ["🐶", "🐱", "🦊", "🐼", "🐨", "🦁", "🐯", "🐸", "🐵", "🦄", "🐧", "🐙", "🦖", "🐝", "🦋", "🌻", "🌈", "⭐",
          "🚀", "⚽", "🎮", "🎸", "🍕"]


def set_avatar(data, account, color=None, emoji=None, image=None):
    """Profilbild ändern: Hintergrundfarbe, Emoji ("" = Anfangsbuchstabe) oder Foto (JPEG-Bytes)."""
    if color:
        account["color"] = color
    if emoji is not None:
        account["avatar"] = f"emoji:{emoji}" if emoji else ""
    if image is not None:
        AVATARS.mkdir(parents=True, exist_ok=True)
        tmp = AVATARS / f"{account['id']}.tmp"
        tmp.write_bytes(image)
        tmp.replace(avatar_file(account))
        account["avatar"] = "image"
        account["avatar_v"] = account.get("avatar_v", 0) + 1  # neues Foto: Oberfläche lädt es neu
    if emoji is not None and emoji != "image":
        avatar_file(account).unlink(missing_ok=True)
    save(data)


def avatar_file(account):
    return AVATARS / f"{account['id']}.jpg"


def _default_name():
    """Erstes Konto heißt wie der Benutzer des Pi (z. B. "kevin" -> "Kevin")."""
    try:
        name = pwd.getpwuid(os.getuid()).pw_name
    except KeyError:
        name = os.environ.get("USER", "")
    return (name or "Ich").capitalize()


def load():
    """Konten laden; beim ersten Mal das bisherige Player-Profil als erstes Konto übernehmen."""
    try:
        data = json.loads(FILE.read_text(encoding="utf-8"))
        if data.get("accounts"):
            return data
    except (OSError, ValueError):
        pass
    first = {"id": "main", "name": _default_name(), "color": COLORS[0], "pin": ""}
    old = DATA / "player"
    if old.is_dir() and not profile_dir(first).exists():
        profile_dir(first).parent.mkdir(parents=True, exist_ok=True)
        old.rename(profile_dir(first))  # Logins bleiben erhalten
    data = {"accounts": [first], "last": first["id"]}
    save(data)
    return data


def save(data):
    FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(FILE)


def find(data, account_id):
    return next((a for a in data["accounts"] if a["id"] == account_id), None)


def create(data, name):
    used = {a["color"] for a in data["accounts"]}
    color = next((c for c in COLORS if c not in used), COLORS[len(data["accounts"]) % len(COLORS)])
    account = {"id": secrets.token_hex(4), "name": name.strip()[:20] or "Konto", "color": color, "pin": ""}
    data["accounts"].append(account)
    save(data)
    return account


def delete(data, account):
    """Konto samt Player-Profil (Logins) und Einstellungen entfernen."""
    data["accounts"] = [a for a in data["accounts"] if a["id"] != account["id"]]
    if data.get("last") == account["id"]:
        data["last"] = data["accounts"][0]["id"] if data["accounts"] else None
    save(data)
    shutil.rmtree(DATA / "accounts" / account["id"], ignore_errors=True)
    avatar_file(account).unlink(missing_ok=True)
    (SETTINGS_DIR / f"{account['id']}.json").unlink(missing_ok=True)


def _hash(salt, pin):
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt), 100_000).hex()


def set_pin(data, account, pin):
    if pin:
        salt = secrets.token_hex(8)
        account["pin"] = f"{salt}${_hash(salt, pin)}"
    else:
        account["pin"] = ""
    save(data)


def check_pin(account, pin):
    if not account.get("pin"):
        return True
    salt, digest = account["pin"].split("$", 1)
    return secrets.compare_digest(_hash(salt, pin), digest)


def profile_dir(account):
    return DATA / "accounts" / account["id"] / "player"


def settings_file(account):
    return SETTINGS_DIR / f"{account['id']}.json"


def ensure_widevine(profile):
    """Neue Profile bekommen das Widevine-Modul (DRM für Netflix & Co.) eines vorhandenen Profils."""
    hint = profile / "WidevineCdm" / "latest-component-updated-widevine-cdm"
    if hint.exists():
        try:
            if Path(json.loads(hint.read_text())["Path"]).is_dir():
                return
        except (OSError, ValueError, KeyError):
            pass
        # Verweis zeigt ins Leere (z. B. nach dem Umzug des Profils): auf die Kopie im Profil zeigen
        local = sorted(d for d in (profile / "WidevineCdm").iterdir() if d.is_dir())
        if local:
            hint.write_text(json.dumps({"Path": str(local[-1])}), encoding="utf-8")
            return
    source = None
    for other in sorted((DATA / "accounts").glob("*/player/WidevineCdm/latest-component-updated-widevine-cdm")):
        try:
            path = Path(json.loads(other.read_text())["Path"])
        except (OSError, ValueError, KeyError):
            continue
        if path.is_dir():
            source = path
            break
    if source is None and Path("/opt/WidevineCdm/manifest.json").exists():
        source = Path("/opt/WidevineCdm")
    if source is None:
        return
    version = source.name
    if source == Path("/opt/WidevineCdm"):
        version = json.loads((source / "manifest.json").read_text()).get("version", "system")
    target = profile / "WidevineCdm" / version
    if not target.exists():
        shutil.copytree(source, target, symlinks=True)
    hint.write_text(json.dumps({"Path": str(target)}), encoding="utf-8")
