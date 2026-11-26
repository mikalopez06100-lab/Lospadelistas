"""PÁDEL 86 — palette, police bitmap 5x7 et utilitaires pixel."""
from PIL import Image

PAL = {
    'K': '#0b1622',  # nuit (contours) — reprend le theme-color actuel
    'N': '#1d2b53',  # bleu nuit
    'B': '#2a5bd7',  # bleu pista
    'C': '#29e0ff',  # cyan néon
    'P': '#ff3d8b',  # rose pop
    'M': '#8f3bd9',  # violet
    'Y': '#ffd23f',  # jaune balle
    'O': '#ff8a1f',  # orange coucher de soleil
    'R': '#e8323c',  # rouge
    'G': '#3ec46d',  # vert
    'W': '#fff4e0',  # blanc crème
    'S': '#f6c08f',  # peau claire
    'T': '#c27a4c',  # peau mate
    'D': '#7a4128',  # peau foncée / cheveux châtains
    'L': '#8a94a6',  # gris acier (cadre vitres)
    'H': '#2b1810',  # cheveux bruns foncés
}
PAL_NAMES = {
    'K': 'Nuit', 'N': 'Bleu nuit', 'B': 'Bleu pista', 'C': 'Cyan néon',
    'P': 'Rose pop', 'M': 'Violet', 'Y': 'Jaune balle', 'O': 'Orange sunset',
    'R': 'Rouge', 'G': 'Vert', 'W': 'Crème', 'S': 'Peau claire',
    'T': 'Peau mate', 'D': 'Châtain', 'L': 'Acier', 'H': 'Brun',
}


def rgb(c):
    h = PAL[c].lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


# --- Police 5x7 -------------------------------------------------------------
_F = {
 'A': ".###.#...##...########...##...##...#", 'B': "####.#...##...#####.#...##...#####.",
 'C': ".####...#....#....#....#.....####", 'D': "####.#...##...##...##...##...#####.",
 'E': "######....#....####.#....#....#####", 'F': "######....#....####.#....#....#....",
 'G': ".#####....#....#..###...##...#.####", 'H': "#...##...##...#######...##...##...#",
 'I': "#####..#....#....#....#....#..#####", 'J': "....#....#....#....##...##...#.###.",
 'K': "#...##..#.#.#..##...#.#..#..#.#...#", 'L': "#....#....#....#....#....#....#####",
 'M': "#...###.###.#.##...##...##...##...#", 'N': "#...###..##.#.##..###...##...##...#",
 'O': ".###.#...##...##...##...##...#.###.", 'P': "####.#...##...#####.#....#....#....",
 'Q': ".###.#...##...##...##.#.##..#..##.#", 'R': "####.#...##...#####.#.#..#..#.#...#",
 'S': ".#####....#.....###.....#....#####.", 'T': "#####..#....#....#....#....#....#..",
 'U': "#...##...##...##...##...##...#.###.", 'V': "#...##...##...##...#.#.#..#.#...#..",
 'W': "#...##...##...##.#.##.#.###.###...#", 'X': "#...##...#.#.#...#...#.#.#...##...#",
 'Y': "#...##...#.#.#...#....#....#....#..", 'Z': "#####....#...#...#...#...#....#####",
 '0': ".###.#...##..###.#.###..##...#.###.", '1': "..#...##....#....#....#....#...###.",
 '2': ".###.#...#....#...#...#...#....#####", '3': "####.....#....#.###.....#....#####.",
 '4': "...#...##..#.#.#..#.#####...#....#.", '5': "######....####.....#....#....#####.",
 '6': ".###.#....#....####.#...##...#.###.", '7': "#####....#...#...#...#....#....#...",
 '8': ".###.#...##...#.###.#...##...#.###.", '9': ".###.#...##...#.####....#....#.###.",
 ' ': "." * 35, '.': "." * 30 + "..#..", ',': "." * 25 + "..#...#...",
 '!': "..#....#....#....#....#.........#..", '?': ".###.#...#....#...#...#.........#..",
 '-': "." * 15 + ".###." + "." * 15, ':': ".....", "'": "..#....#....." + "." * 22,
 '©': ".###.#...##.#.##.#..##.#.##...#.###.", '/': "....#....#...#...#...#...#....#....",
 '&': ".##..#..#..##...##.##.#..#.#..#.##.#", '+': ".......#....#..#####..#....#.......",
 '*': ".......#.#.#.###.#####.###.#.#.#....",
}

def _R(*rows): return "".join(rows)
_F['A'] = _R(".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#")
_F['C'] = _R(".####", "#....", "#....", "#....", "#....", "#....", ".####")
_F['2'] = _R(".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####")
_F['©'] = _R(".###.", "#...#", "#.###", "#.#.#", "#.###", "#...#", ".###.")
_F['&'] = _R(".##..", "#..#.", ".##..", ".##.#", "#..#.", "#..#.", ".##.#")
_F['*'] = _R(".....", "#.#.#", ".###.", "#####", ".###.", "#.#.#", ".....")
_F['©'] = _R(".###.", "#...#", "#.##.", "#.#..", "#.##.", "#...#", ".###.")
_F['>'] = _R(".#...", "..#..", "...#.", "....#", "...#.", "..#..", ".#...")
_F[':'] = "......##...##.........##...##......"
# Accents : glyphe de base + accent sur la ligne -1 (rendu à part)
ACCENT = {'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U', 'Ñ': 'N', 'À': 'A', 'È': 'E', 'Ç': 'C'}
for k, v in list(_F.items()):
    _F[k] = (v + "." * 35)[:35]


def glyph(ch):
    base = ACCENT.get(ch, ch)
    return _F.get(base.upper(), _F['?'])


def text_width(s, scale=1, spacing=1):
    return len(s) * (5 + spacing) * scale - spacing * scale


def draw_text(img, x, y, s, col, scale=1, spacing=1, shadow=None):
    px = img.load()
    W, H = img.size

    def dot(xx, yy, c):
        for dy in range(scale):
            for dx in range(scale):
                a, b = xx + dx, yy + dy
                if 0 <= a < W and 0 <= b < H:
                    px[a, b] = c
    cx = x
    for ch in s:
        g = glyph(ch)
        for i, v in enumerate(g):
            if v == '#':
                gx, gy = i % 5, i // 5
                if shadow:
                    dot(cx + gx * scale + scale, y + gy * scale + scale, rgb(shadow))
        for i, v in enumerate(g):
            if v == '#':
                gx, gy = i % 5, i // 5
                dot(cx + gx * scale, y + gy * scale, rgb(col))
        if ch in ACCENT:
            if ch == 'Ñ':
                for gx in (1, 2, 3):
                    dot(cx + gx * scale, y - 2 * scale, rgb(col))
            elif ch in 'ÀÈ':
                dot(cx + 1 * scale, y - 3 * scale, rgb(col)); dot(cx + 2 * scale, y - 2 * scale, rgb(col))
            elif ch == 'Ç':
                dot(cx + 2 * scale, y + 7 * scale, rgb(col))
            else:
                dot(cx + 3 * scale, y - 3 * scale, rgb(col)); dot(cx + 2 * scale, y - 2 * scale, rgb(col))
        cx += (5 + spacing) * scale
    return cx


def text_mask(s, scale=1, spacing=1):
    """Renvoie un set de pixels (x,y) couverts par le texte, origine 0,0 (accents en y négatif)."""
    pts = set()
    cx = 0
    for ch in s:
        g = glyph(ch)
        for i, v in enumerate(g):
            if v == '#':
                gx, gy = i % 5, i // 5
                for dy in range(scale):
                    for dx in range(scale):
                        pts.add((cx + gx * scale + dx, gy * scale + dy))
        if ch in ACCENT and ch not in 'ÑÇ':
            for (gx, gy) in ((3, -3), (2, -2)):
                for dy in range(scale):
                    for dx in range(scale):
                        pts.add((cx + gx * scale + dx, gy * scale + dy))
        cx += (5 + spacing) * scale
    return pts


def from_rows(rows):
    """Construit une image RGBA depuis une liste de chaînes de codes palette ('.' = transparent)."""
    h, w = len(rows), max(len(r) for r in rows)
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    px = img.load()
    for y, r in enumerate(rows):
        for x, c in enumerate(r):
            if c in PAL:
                px[x, y] = rgb(c)
    return img


def up(img, k):
    return img.resize((img.width * k, img.height * k), Image.NEAREST)
