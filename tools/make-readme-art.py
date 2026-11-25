"""Le immagini del README: banner, le tre schede e la modalita' compatta.

Parte dalle foto che fa tests/shots.js (Chromium senza finestre, dati dal simulatore):

    node tests/shots.js <dir>/overlay --overlay 0.78 --width 380
    node tests/shots.js <dir>/compact --overlay 0.78 --width 380 --compact 1
    python3 tools/make-readme-art.py <dir> [--font Archivo.ttf]

e le posa su un fondo scuro coi colori dell'app. Niente immagini del gioco: sono di Valve.
--font vuole un .ttf (Archivo e' solo in woff2 nel renderer: si converte con fontTools);
senza, si usa Avenir Next Condensed di macOS.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "readme"

BG_TOP = (20, 25, 37)
BG_BOTTOM = (4, 5, 8)
TEXT_1 = (232, 237, 245)
TEXT_2 = (141, 151, 168)
AMBER = (255, 176, 32)
ICE = (124, 196, 255)
LINE = (60, 68, 84)


def font(path, size, weight=700, width=100):
    if path:
        f = ImageFont.truetype(str(path), size)
        try:
            f.set_variation_by_axes([weight, width])
        except Exception:
            pass
        return f
    return ImageFont.truetype("/System/Library/Fonts/Avenir Next Condensed.ttc", size, index=0 if weight >= 600 else 7)


def backdrop(w, h):
    img = Image.new("RGBA", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / h
        d.line((0, y, w, y), fill=tuple(round(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOTTOM)) + (255,))
    # una luce ambra in alto a destra e una azzurra in basso a sinistra, sfocate
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    g.ellipse((w * 0.55, -h * 0.5, w * 1.3, h * 0.6), fill=AMBER + (40,))
    g.ellipse((-w * 0.3, h * 0.55, w * 0.4, h * 1.5), fill=ICE + (28,))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(min(w, h) * 0.18)))
    # la griglia del tabellone delle partenze, appena accennata
    grid = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grid)
    for x in range(0, w, 48):
        gd.line((x, 0, x, h), fill=(255, 255, 255, 7))
    for y in range(0, h, 48):
        gd.line((0, y, w, y), fill=(255, 255, 255, 7))
    img.alpha_composite(grid)
    return img


def panel(shot, height=None, radius=26):
    """Il pannello dell'app come finestra: tagliato, angoli tondi, ombra sotto."""
    im = Image.open(shot).convert("RGBA")
    if height and im.height > height:
        im = im.crop((0, 0, im.width, height))
        # sfuma il taglio in basso, come se la finestra continuasse
        fade = Image.new("L", im.size, 255)
        fd = ImageDraw.Draw(fade)
        span = 160
        for i in range(span):
            fd.line((0, im.height - span + i, im.width, im.height - span + i), fill=round(255 * (1 - i / span)))
        im.putalpha(Image.composite(im.split()[3], Image.new("L", im.size, 0), fade))
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius, fill=255)
    a = Image.composite(im.split()[3], Image.new("L", im.size, 0), mask)
    # sotto il pannello semitrasparente, un vetro scuro: sul fondo nero si legge come sopra il gioco
    glass = Image.new("RGBA", im.size, (10, 13, 20, 0))
    glass.putalpha(mask.point(lambda v: v * 0.55))
    glass.alpha_composite(im)
    glass.putalpha(Image.composite(Image.new("L", im.size, 255), Image.new("L", im.size, 0), a.point(lambda v: 255 if v else 0)))
    glass.putalpha(Image.composite(glass.split()[3], Image.new("L", im.size, 0), mask))
    if height and Image.open(shot).height > height:
        glass.putalpha(Image.composite(glass.split()[3], Image.new("L", im.size, 0), fade))
    return glass


def drop(canvas, im, x, y, blur=28, offset=18, alpha=150):
    sh = Image.new("RGBA", (im.width + blur * 4, im.height + blur * 4), (0, 0, 0, 0))
    sh.paste(Image.new("RGBA", im.size, (0, 0, 0, alpha)), (blur * 2, blur * 2), im.split()[3])
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    canvas.alpha_composite(sh, (x - blur * 2, y - blur * 2 + offset))
    canvas.alpha_composite(im, (x, y))


def pill(img, x, y, text, f, fg=TEXT_1, border=LINE):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    w = d.textlength(text, font=f)
    h = f.size + 26
    d.rounded_rectangle((x, y, x + w + 44, y + h), h // 2, outline=border + (255,), width=3, fill=(255, 255, 255, 14))
    d.text((x + 22, y + h / 2), text, font=f, fill=fg, anchor="lm")
    img.alpha_composite(layer)
    return x + w + 44 + 16


def hero(shots, fpath):
    W, H = 2000, 1000
    img = backdrop(W, H)
    d = ImageDraw.Draw(img)
    icon = Image.open(ROOT / "assets" / "icon-512.png").convert("RGBA").resize((210, 210), Image.LANCZOS)
    drop(img, icon, 110, 150, blur=20, offset=12, alpha=120)
    d.text((104, 390), "Courier", font=font(fpath, 168, 800, 100), fill=TEXT_1)
    d.text((112, 600), "Your co-pilot for Dota 2.", font=font(fpath, 58, 700, 100), fill=TEXT_1)
    d.text((112, 672), "Draft, timings and pro builds,", font=font(fpath, 58, 700, 100), fill=AMBER)
    d.text((112, 742), "right on top of the game.", font=font(fpath, 58, 700, 100), fill=AMBER)
    x = 112
    pf = font(fpath, 34, 500, 100)
    for t in ("Windows", "macOS", "Free & open source"):
        x = pill(img, x, 850, t, pf)

    live = panel(shots / "overlay" / "overlay-live.png", 1240).resize((450, 734), Image.LANCZOS)
    items = panel(shots / "overlay" / "overlay-items.png", 1240).resize((450, 734), Image.LANCZOS)
    draft = panel(shots / "overlay" / "overlay-draft.png", 1340).resize((500, 882), Image.LANCZOS)
    drop(img, live, 1010, 190)
    drop(img, items, 1500, 190)
    drop(img, draft, 1225, 70)
    return img


def tabs(shots, fpath):
    W, H = 2000, 1240
    img = backdrop(W, H)
    d = ImageDraw.Draw(img)
    names = [("overlay-draft.png", "Draft", "Counters, synergy, bans"),
             ("overlay-live.png", "Match", "The next minutes, minute by minute"),
             ("overlay-items.png", "Items", "What the pros buy, in order")]
    pw = 540
    gap = (W - 3 * pw) // 4
    for i, (f, title, sub) in enumerate(names):
        p = panel(shots / "overlay" / f, 1300).resize((pw, round(1300 * pw / 760)), Image.LANCZOS)
        x = gap + i * (pw + gap)
        drop(img, p, x, 60)
        cx = x + pw // 2
        d.text((cx, 1080), title, font=font(fpath, 58, 800, 100), fill=TEXT_1, anchor="mm")
        d.text((cx, 1140), sub, font=font(fpath, 34, 500, 100), fill=TEXT_2, anchor="mm")
    return img


def compact(shots, fpath):
    W, H = 2000, 760
    img = backdrop(W, H)
    d = ImageDraw.Draw(img)
    p = panel(shots / "compact" / "overlay-compact-live.png")
    p = p.resize((round(p.width * 0.95), round(p.height * 0.95)), Image.LANCZOS)
    drop(img, p, 1120, (H - p.height) // 2)
    d.text((140, 210), "Compact mode", font=font(fpath, 92, 800, 100), fill=TEXT_1)
    lines = ["Just the clock, what to buy next", "and what's coming up.", "Alt+C, mid-game."]
    for i, t in enumerate(lines):
        d.text((146, 350 + i * 72), t, font=font(fpath, 50, 600, 100), fill=AMBER if i == 2 else TEXT_2)
    return img


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    shots = Path(args[0])
    fpath = Path(args[args.index("--font") + 1]) if "--font" in args else None
    OUT.mkdir(parents=True, exist_ok=True)
    for name, fn in (("hero", hero), ("tabs", tabs), ("compact", compact)):
        im = fn(shots, fpath).convert("RGB")
        out = OUT / f"{name}.jpg"
        im.save(out, quality=90, optimize=True, progressive=True)
        print(f"{out.relative_to(ROOT)}  {im.width}x{im.height}  {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
