"""Génère les icônes de la PWA dans public/icons/ à partir de l'affiche PÁDEL 86.
Lancer : python3 scripts/make-icons.py"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)
NUIT = (11, 22, 34)

# Carré du haut de l'affiche 1x (titre, « 86 », palmiers) : 180×180 px logiques.
poster = Image.open(ROOT / "public" / "padel86" / "padel86-affiche-1x.png").convert("RGB")
square = poster.crop((0, 6, 180, 186))


def icon(size: int, inner: int) -> Image.Image:
    """Agrandissement entier au plus proche voisin (pixels nets), centré sur fond nuit."""
    k = max(1, inner // 180)
    art = square.resize((180 * k, 180 * k), Image.NEAREST)
    im = Image.new("RGB", (size, size), NUIT)
    im.paste(art, ((size - art.width) // 2, (size - art.height) // 2))
    return im


for name, size, inner in (
    ("icon-192.png", 192, 180),
    ("icon-512.png", 512, 512),
    # Icône « masquable » : le motif tient dans les 80 % centraux, le reste peut être rogné.
    ("icon-maskable-512.png", 512, 400),
    ("apple-touch-icon.png", 180, 180),
):
    icon(size, inner).save(OUT / name, optimize=True)
    print("écrit", OUT / name)
