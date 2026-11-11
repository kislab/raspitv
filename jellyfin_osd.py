"""Player-Oberfläche für Jellyfin im Stil einer TV-App, gezeichnet als Einblendung in mpv.

mpv zeichnet sie über `osd-overlay` (ASS-Grafik) direkt über das Video – das funktioniert auch mit
der direkten Hardware-Ausgabe (vo=dmabuf-wayland), bei der kein Qt-Fenster darüber liegen kann.
Alle Funktionen hier sind rein: Zustand rein, ASS-Text raus. Koordinaten in 1920×1080.
"""
import time

W, H = 1920, 1080
FONT = "Nunito Sans"
ACCENT = (0xAA, 0x5C, 0xC3)   # Jellyfin-Lila
MARGIN = 120


def color(rgb):
    r, g, b = rgb
    return f"&H{b:02X}{g:02X}{r:02X}&"


def alpha(opacity):
    """Deckkraft 0..1 -> ASS-Alpha (00 = deckend, FF = durchsichtig)."""
    return f"&H{int(round((1 - opacity) * 255)):02X}&"


def esc(text):
    return (text or "").replace("\\", "⧵").replace("{", "(").replace("}", ")").replace("\n", " ")


def shape(path, rgb=(0, 0, 0), opacity=1.0):
    return f"{{\\an7\\pos(0,0)\\bord0\\shad0\\blur0\\1c{color(rgb)}\\1a{alpha(opacity)}\\p1}}{path}{{\\p0}}"


def rect(x, y, w, h):
    return f"m {x:.0f} {y:.0f} l {x + w:.0f} {y:.0f} {x + w:.0f} {y + h:.0f} {x:.0f} {y + h:.0f}"


def rounded(x, y, w, h, r):
    r = min(r, w / 2, h / 2)
    k = r * 0.45
    x2, y2 = x + w, y + h
    return (f"m {x + r:.1f} {y:.1f} l {x2 - r:.1f} {y:.1f} b {x2 - k:.1f} {y:.1f} {x2:.1f} {y + k:.1f} {x2:.1f} {y + r:.1f} "
            f"l {x2:.1f} {y2 - r:.1f} b {x2:.1f} {y2 - k:.1f} {x2 - k:.1f} {y2:.1f} {x2 - r:.1f} {y2:.1f} "
            f"l {x + r:.1f} {y2:.1f} b {x + k:.1f} {y2:.1f} {x:.1f} {y2 - k:.1f} {x:.1f} {y2 - r:.1f} "
            f"l {x:.1f} {y + r:.1f} b {x:.1f} {y + k:.1f} {x + k:.1f} {y:.1f} {x + r:.1f} {y:.1f}")


def circle(cx, cy, r):
    return rounded(cx - r, cy - r, 2 * r, 2 * r, r)


def text(x, y, content, size, rgb=(255, 255, 255), opacity=1.0, align=7, bold=False, shadow=True):
    sh = "\\shad0\\bord2\\3c&H000000&\\3a&HA0&\\blur3" if shadow else "\\shad0\\bord0"
    return (f"{{\\an{align}\\pos({x:.0f},{y:.0f})\\fn{FONT}\\fs{size}\\b{1 if bold else 0}{sh}"
            f"\\1c{color(rgb)}\\1a{alpha(opacity)}}}{esc(content)}")


def clock(seconds):
    seconds = max(int(seconds or 0), 0)
    h, rest = divmod(seconds, 3600)
    m, s = divmod(rest, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def gradient(y0, y1, top_opacity, bottom_opacity, steps=24):
    """Senkrechter Verlauf aus schmalen Streifen (ASS kennt keine Verläufe)."""
    out = []
    edges = [round(y0 + (y1 - y0) * i / steps) for i in range(steps + 1)]
    for i in range(steps):
        t = (i + 0.5) / steps
        op = top_opacity + (bottom_opacity - top_opacity) * t
        if op > 0.01:  # Bänder stoßen genau aneinander – Überlappung gäbe dunkle Linien
            out.append(shape(rect(0, edges[i], W, edges[i + 1] - edges[i]), (0, 0, 0), op))
    return out


def pause_icon(cx, cy, size):
    bar = size * 0.28
    gap = size * 0.22
    h = size * 0.8
    return [shape(circle(cx, cy, size), (0, 0, 0), 0.45),
            shape(rect(cx - gap / 2 - bar, cy - h / 2, bar, h) + " " + rect(cx + gap / 2, cy - h / 2, bar, h),
                  (255, 255, 255), 0.95)]


def controls(info, pos, duration, paused, cached=0.0, seek_hint=""):
    """Die Leiste: Titel oben links, unten Fortschrittsbalken, Zeiten und Tastenhinweise."""
    out = []
    out += gradient(0, 260, 0.75, 0.0, 14)
    out += gradient(H - 380, H, 0.0, 0.88)

    # Titel
    y = 70
    if info.get("series"):
        out.append(text(MARGIN, y, info["series"].upper(), 30, (200, 200, 210), 0.95, bold=True))
        y += 44
    out.append(text(MARGIN, y, info.get("title") or "", 56, bold=True))
    if info.get("meta"):
        out.append(text(MARGIN, y + 76, info["meta"], 30, (210, 210, 220), 0.9))

    # Fortschrittsbalken
    bar_y, bar_h = H - 190, 8
    bar_w = W - 2 * MARGIN
    frac = min(max(pos / duration, 0), 1) if duration else 0
    cache_frac = min(max(cached / duration, 0), 1) if duration else 0
    out.append(shape(rounded(MARGIN, bar_y, bar_w, bar_h, bar_h / 2), (255, 255, 255), 0.28))
    if cache_frac > frac:
        out.append(shape(rounded(MARGIN, bar_y, bar_w * cache_frac, bar_h, bar_h / 2), (255, 255, 255), 0.45))
    if frac > 0:
        out.append(shape(rounded(MARGIN, bar_y, max(bar_w * frac, bar_h), bar_h, bar_h / 2), ACCENT, 1))
    out.append(shape(circle(MARGIN + bar_w * frac, bar_y + bar_h / 2, 15), (255, 255, 255), 1))

    # Zeiten
    out.append(text(MARGIN, bar_y + 34, clock(pos), 36, bold=True))
    if duration:
        rest = max(duration - pos, 0)
        ends = time.strftime("%H:%M", time.localtime(time.time() + rest))
        out.append(text(W - MARGIN, bar_y + 34, f"-{clock(rest)}  ·  endet um {ends}", 36, align=9))
    if seek_hint:
        out.append(text(MARGIN + bar_w * frac, bar_y - 30, seek_hint, 34, bold=True, align=2))

    # Tastenhinweise
    hints = "OK  Pause / Weiter      ◀ ▶  10 s spulen      ▲ ▼  1 min spulen      MENÜ  Ton & Untertitel      ZURÜCK  Beenden"
    if paused:
        hints = hints.replace("Pause / Weiter", "Weiter")
    out.append(text(W / 2, H - 70, hints, 26, (220, 220, 230), 0.8, align=8))

    if paused:
        out += pause_icon(W / 2, H / 2 - 40, 80)
    return out


def speaker(cx, cy, s, rgb, opacity, muted):
    """Lautsprecher-Symbol (gefüllt) mit Wellen bzw. Kreuz, Größe s um (cx, cy)."""
    r = s / 2
    body = (f"m {cx - 0.9 * r:.1f} {cy - 0.3 * r:.1f} l {cx - 0.5 * r:.1f} {cy - 0.3 * r:.1f} "
            f"{cx - 0.05 * r:.1f} {cy - 0.75 * r:.1f} {cx - 0.05 * r:.1f} {cy + 0.75 * r:.1f} "
            f"{cx - 0.5 * r:.1f} {cy + 0.3 * r:.1f} {cx - 0.9 * r:.1f} {cy + 0.3 * r:.1f}")
    out = [shape(body, rgb, opacity)]
    w = 0.13 * s
    if muted:
        for a, b in ((-1, 1), (1, -1)):
            x1, y1, x2, y2 = cx + 0.3 * r, cy + a * 0.35 * r, cx + 0.95 * r, cy + b * 0.35 * r
            # Strich als schmales Viereck
            dx, dy = (y2 - y1), -(x2 - x1)
            n = (dx * dx + dy * dy) ** 0.5 or 1
            ox, oy = dx / n * w / 2, dy / n * w / 2
            out.append(shape(f"m {x1 + ox:.1f} {y1 + oy:.1f} l {x2 + ox:.1f} {y2 + oy:.1f} "
                             f"{x2 - ox:.1f} {y2 - oy:.1f} {x1 - ox:.1f} {y1 - oy:.1f}", rgb, opacity))
    else:
        out.append(shape(rect(cx + 0.2 * r, cy - 0.32 * r, w, 0.64 * r), rgb, opacity))
        out.append(shape(rect(cx + 0.55 * r, cy - 0.55 * r, w, 1.1 * r), rgb, opacity))
    return out


def volume(value, muted):
    """Senkrechte Lautstärke-Leiste links – wie in RaspiTV (qml/VolumeOsd.qml) und in Netflix & Co."""
    u = 24  # RaspiTV-Einheit bei 1920 px Breite
    w, h = 4 * u, 22 * u
    x, y = 4 * u, (H - h) / 2
    fg = (150, 150, 160) if muted else (255, 255, 255)
    out = [shape(rounded(x, y + 0.3 * u, w, h, w / 2), (0, 0, 0), 0.3),   # leichter Schatten
           shape(rounded(x, y, w, h, w / 2), (20, 20, 28), 1.0)]
    cx = x + w / 2
    out.append(text(cx, y + 2.2 * u, "–" if muted else str(round(value)), 40, fg, align=5, bold=True, shadow=False))
    tw = 0.5 * u
    tx, ty, th = cx - tw / 2, y + 4.4 * u, h - 8.8 * u
    out.append(shape(rounded(tx, ty, tw, th, tw / 2), (255, 255, 255), 0.18))
    fill = max(tw if value > 0 else 0, th * value / 100)
    if fill:
        out.append(shape(rounded(tx, ty + th - fill, tw, fill, tw / 2), (255, 255, 255), 0.35 if muted else 1))
    out += speaker(cx, y + h - 2.2 * u, 1.8 * u, fg, 1.0, muted or value == 0)
    return out


def track_label(track):
    lang = (track.get("lang") or "").lower()
    names = {"de": "Deutsch", "ger": "Deutsch", "deu": "Deutsch", "en": "Englisch", "eng": "Englisch",
             "ja": "Japanisch", "jpn": "Japanisch", "fr": "Französisch", "fre": "Französisch", "fra": "Französisch",
             "es": "Spanisch", "spa": "Spanisch", "it": "Italienisch", "ita": "Italienisch"}
    parts = [names.get(lang, lang.upper() if lang else "")]
    title = track.get("title") or ""
    if title and title.lower() not in (parts[0] or "").lower():
        parts.append(title)
    if track.get("type") == "audio" and track.get("demux-channel-count"):
        ch = track["demux-channel-count"]
        parts.append({1: "Mono", 2: "Stereo", 6: "5.1", 8: "7.1"}.get(ch, f"{ch} Kanäle"))
    if track.get("type") == "sub" and track.get("forced"):
        parts.append("erzwungen")
    label = " · ".join(p for p in parts if p)
    return label or f"Spur {track.get('id')}"


def menu_entries(tracks):
    """Menüzeilen: (Art, Text, ausgewählt, Aktion) – Überschriften haben Aktion None."""
    audio = [t for t in tracks if t.get("type") == "audio"]
    subs = [t for t in tracks if t.get("type") == "sub"]
    rows = [("header", "Tonspur", False, None)]
    rows += [("item", track_label(t), bool(t.get("selected")), ("aid", t["id"])) for t in audio]
    rows.append(("header", "Untertitel", False, None))
    rows.append(("item", "Aus", not any(t.get("selected") for t in subs), ("sid", "no")))
    rows += [("item", track_label(t), bool(t.get("selected")), ("sid", t["id"])) for t in subs]
    return rows


def menu(rows, index):
    """Seitenleiste rechts mit Ton- und Untertitelspuren."""
    panel_w = 640
    x0 = W - panel_w
    out = [shape(rect(0, 0, W, H), (0, 0, 0), 0.35), shape(rect(x0, 0, panel_w, H), (22, 22, 30), 0.96)]
    out.append(text(x0 + 60, 70, "Ton & Untertitel", 48, bold=True, shadow=False))
    y = 170
    # Ausschnitt, damit die gewählte Zeile sichtbar bleibt
    visible = 13
    selectable = [i for i, r in enumerate(rows)]
    start = max(0, min(index - visible // 2, len(rows) - visible))
    for i in selectable[start:start + visible]:
        kind, label, selected, _ = rows[i]
        if kind == "header":
            y += 14
            out.append(text(x0 + 60, y, label.upper(), 26, (160, 160, 175), shadow=False, bold=True))
            y += 50
            continue
        focused = i == index
        if focused:
            out.append(shape(rounded(x0 + 36, y - 10, panel_w - 72, 64, 14), (255, 255, 255), 1))
        fg = (16, 16, 22) if focused else (235, 235, 240)
        if selected:
            out.append(shape(circle(x0 + 82, y + 22, 8), ACCENT if not focused else (16, 16, 22), 1))
        out.append(text(x0 + 110, y + 3, label, 32, fg, bold=focused, shadow=False))
        y += 72
    out.append(text(x0 + 60, H - 70, "OK  Auswählen      ZURÜCK  Schließen", 26, (160, 160, 175), shadow=False))
    return out
