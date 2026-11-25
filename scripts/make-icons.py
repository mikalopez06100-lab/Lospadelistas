"""Génère les icônes de la PWA dans public/icons/. Lancer : python3 scripts/make-icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)
S = 2048  # dessin en grand, réduit ensuite pour l'anticrénelage


def draw() -> Image.Image:
    im = Image.new("RGB", (S, S), "#0b1622")
    d = ImageDraw.Draw(im)
    # Terrain en perspective. Tout le motif tient dans les 80 % centraux (zone sûre des icônes masquables).
    court = [(0.24 * S, 0.30 * S), (0.76 * S, 0.30 * S), (0.86 * S, 0.84 * S), (0.14 * S, 0.84 * S)]
    d.polygon(court, fill="#1f5fa8")
    # Vitre de fond.
    glass = [(0.24 * S, 0.14 * S), (0.76 * S, 0.14 * S), (0.76 * S, 0.30 * S), (0.24 * S, 0.30 * S)]
    d.polygon(glass, fill="#1b3350")
    w = int(S * 0.012)
    d.line(glass + [glass[0]], fill="#cdeeff", width=w, joint="curve")
    for fx in (0.41, 0.59):
        d.line([(fx * S, 0.14 * S), (fx * S, 0.30 * S)], fill="#7fa9c4", width=w // 2)
    d.line(court + [court[0]], fill="#ffffff", width=w, joint="curve")
    # Filet.
    d.line([(0.185 * S, 0.60 * S), (0.815 * S, 0.60 * S)], fill="#ffffff", width=int(w * 1.6))
    # Trajectoire : rebond au sol puis sur la vitre.
    pts = [(0.30 * S, 0.74 * S), (0.44 * S, 0.47 * S), (0.56 * S, 0.40 * S), (0.60 * S, 0.24 * S), (0.66 * S, 0.40 * S)]
    for a, b in zip(pts, pts[1:]):
        d.line([a, b], fill="#e4f23a", width=int(w * 0.9))
    # Ombre et balle.
    d.ellipse([0.62 * S, 0.50 * S, 0.76 * S, 0.55 * S], fill="#153f73")
    r = 0.085 * S
    cx, cy = 0.69 * S, 0.40 * S
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill="#e4f23a", outline="#2a3300", width=w // 2)
    d.ellipse([cx - r * 0.55, cy - r * 0.6, cx - r * 0.05, cy - r * 0.1], fill="#f6ffb0")
    return im


base = draw()
for name, size in (("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)):
    base.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)
    print("écrit", OUT / name)
