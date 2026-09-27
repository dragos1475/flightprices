"""
Generează imaginile de pornire (splash) pentru iPhone, în variantă luminoasă și întunecată.
iPhone le afișează cât timp se deschide aplicația instalată pe ecranul principal.

Rulare (din folderul proiectului):
    pip install pillow
    python tools/genereaza_splash.py

Imaginile ajung în icons/splash/. Legăturile către ele sunt deja în index.html.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons" / "splash"
ICON = ROOT / "icons" / "icon-512.png"

# (lățime, înălțime, densitate) în puncte, pentru modelele de iPhone uzuale
SIZES = [(430, 932, 3), (393, 852, 3), (390, 844, 3), (428, 926, 3), (414, 896, 3), (414, 896, 2),
         (375, 812, 3), (414, 736, 3), (375, 667, 2), (402, 874, 3), (440, 956, 3)]

THEMES = {
    "light": {"bg": (244, 245, 247), "glow": (98, 88, 244, 60)},
    "dark": {"bg": (14, 17, 22), "glow": (98, 88, 244, 90)},
}


def make(w_pt, h_pt, scale, theme):
    W, H = w_pt * scale, h_pt * scale
    img = Image.new("RGB", (W, H), THEMES[theme]["bg"])
    # o lumină violet discretă în partea de sus (ca fundalul aplicației)
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    r = int(W * 0.9)
    d.ellipse([W // 2 - r, -int(r * 1.2), W // 2 + r, int(r * 0.55)], fill=THEMES[theme]["glow"])
    glow = glow.filter(ImageFilter.GaussianBlur(W // 6))
    img.paste(glow, (0, 0), glow)
    # iconița, în aceeași poziție ca pe ecranul animat din aplicație (puțin deasupra centrului)
    size = 84 * scale
    icon = Image.open(ICON).convert("RGBA").resize((size, size), Image.LANCZOS)
    img.paste(icon, ((W - size) // 2, H // 2 - int(92 * scale)), icon)
    return img


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for w, h, s in SIZES:
        for theme in THEMES:
            path = OUT / f"splash-{w * s}x{h * s}-{theme}.png"
            make(w, h, s, theme).save(path, optimize=True)
            print("scris", path.relative_to(ROOT))


if __name__ == "__main__":
    main()
