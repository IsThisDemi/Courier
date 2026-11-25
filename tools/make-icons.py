"""Icone di Courier: un aeroplanino di carta ambra su un pannello ardesia.

Uso: python3 tools/make-icons.py
Scrive assets/icon-{16,32,64,256,512}.png (finestra e area di notifica) e
build/icon.png, build/icon.ico, build/icon.icns per gli installer.
"""
import math
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
S = 1024 * 4  # si disegna grande e si rimpicciolisce: bordi puliti

PANEL_TOP = (36, 44, 60)
PANEL_BOTTOM = (14, 18, 27)
AMBER = (255, 176, 32)
AMBER_DEEP = (232, 128, 20)
ICE = (124, 196, 255)


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size - 1, size - 1), radius, fill=255)
    return m


def capsule(draw, cx, cy, length, width, angle, fill):
    """Una piuma: capsula con un capo tondo, ruotata di [angle] gradi."""
    a = math.radians(angle)
    dx, dy = math.cos(a), -math.sin(a)
    nx, ny = -dy, dx
    pts = []
    steps = 40
    half = width / 2
    tip = (cx + dx * length, cy + dy * length)
    # lato dritto dalla radice alla punta tonda
    for i in range(steps + 1):
        t = i / steps
        w = half * (0.55 + 0.45 * math.sin(math.pi * min(1, t * 1.2) / 2))
        pts.append((cx + dx * length * t + nx * w, cy + dy * length * t + ny * w))
    for i in range(steps + 1):
        th = math.pi * i / steps
        pts.append((tip[0] + nx * half * math.cos(th) + dx * half * math.sin(th),
                    tip[1] + ny * half * math.cos(th) + dy * half * math.sin(th)))
    for i in range(steps, -1, -1):
        t = i / steps
        w = half * (0.55 + 0.45 * math.sin(math.pi * min(1, t * 1.2) / 2))
        pts.append((cx + dx * length * t - nx * w, cy + dy * length * t - ny * w))
    draw.polygon(pts, fill=fill)


def make(full=True):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    margin = int(S * 0.04) if full else 0
    inner = S - 2 * margin
    bg = Image.new("RGBA", (inner, inner))
    px = bg.load()
    for y in range(inner):
        c = lerp(PANEL_TOP, PANEL_BOTTOM, y / inner)
        for x in range(0, inner, 1):
            px[x, y] = c + (255,)
    # un alone ambra dietro l'ala
    glow = Image.new("L", (inner, inner), 0)
    ImageDraw.Draw(glow).ellipse((inner * 0.18, inner * 0.2, inner * 0.92, inner * 0.94), fill=90)
    glow = glow.filter(ImageFilter.GaussianBlur(inner * 0.12))
    bg = Image.composite(Image.new("RGBA", (inner, inner), AMBER + (255,)), bg, glow.point(lambda v: v // 3))
    img.paste(bg, (margin, margin), rounded_mask(inner, int(inner * 0.23)))

    wing = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(wing)

    def P(x, y):
        return (S * x, S * y)

    # Un aeroplanino di carta che vola in alto a destra: il corriere.
    nose, left, fold, tail, flap = P(0.82, 0.20), P(0.17, 0.47), P(0.45, 0.55), P(0.55, 0.83), P(0.45, 0.68)
    d.polygon([nose, left, fold], fill=AMBER + (255,))
    d.polygon([nose, fold, tail], fill=lerp(AMBER, AMBER_DEEP, 0.55) + (255,))
    d.polygon([fold, tail, flap], fill=lerp(AMBER_DEEP, PANEL_BOTTOM, 0.35) + (255,))
    # dietro, la scia: i prossimi minuti della partita, in azzurro
    for (x, y, r) in [(0.33, 0.70, 0.045), (0.24, 0.79, 0.035), (0.16, 0.87, 0.026)]:
        d.ellipse((S * (x - r), S * (y - r), S * (x + r), S * (y + r)), fill=ICE + (255,))
    shadow = wing.split()[3].filter(ImageFilter.GaussianBlur(S * 0.02)).point(lambda v: v * 0.45)
    img.paste(Image.new("RGBA", (S, S), (0, 0, 0, 255)), (int(S * 0.01), int(S * 0.02)), shadow)
    img.alpha_composite(wing)
    return img


def main():
    big = make()
    assets = ROOT / "assets"
    for n in (16, 32, 64, 256, 512):
        big.resize((n, n), Image.LANCZOS).save(assets / f"icon-{n}.png")
    build = ROOT / "build"
    build.mkdir(exist_ok=True)
    big.resize((1024, 1024), Image.LANCZOS).save(build / "icon.png")
    big.resize((256, 256), Image.LANCZOS).save(
        build / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    with tempfile.TemporaryDirectory() as t:
        iconset = Path(t) / "icon.iconset"
        iconset.mkdir()
        for n in (16, 32, 128, 256, 512):
            big.resize((n, n), Image.LANCZOS).save(iconset / f"icon_{n}x{n}.png")
            big.resize((n * 2, n * 2), Image.LANCZOS).save(iconset / f"icon_{n}x{n}@2x.png")
        subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(build / "icon.icns")], check=True)
    print("icone scritte in assets/ e build/")


if __name__ == "__main__":
    main()
