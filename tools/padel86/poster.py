"""Affiche de démarrage PÁDEL 86 — 180x320 pixel art, export x6 = 1080x1920."""
import math, random
from PIL import Image, ImageDraw
from pix import rgb, draw_text, text_width, text_mask, up
import sprites

Wd, Ht = 180, 320
random.seed(86)


def lerp(a, b, t):
    return a + (b - a) * t


def make_poster(title='PÁDEL', num='86', tagline='JOUE AVEC LES VITRES !', footer='© 1986 LOS PADELISTAS',
                blink=True):
    im = Image.new('RGBA', (Wd, Ht), rgb('K'))
    raw = im.load()

    class _Safe:
        def __setitem__(self, k, v):
            x, y = int(k[0]), int(k[1])
            if 0 <= x < Wd and 0 <= y < Ht:
                raw[x, y] = v

        def __getitem__(self, k):
            return raw[k]
    px = _Safe()
    d = ImageDraw.Draw(im)

    # --- ciel : bandes tramées nuit -> violet -> rose -> orange
    bands = [(0, 'K'), (38, 'N'), (70, 'M'), (96, 'P'), (114, 'O'), (126, 'Y')]
    horizon = 132
    for y in range(horizon):
        for i in range(len(bands) - 1):
            if bands[i][0] <= y < bands[i + 1][0]:
                c0, c1 = bands[i][1], bands[i + 1][1]
                t = (y - bands[i][0]) / (bands[i + 1][0] - bands[i][0])
                break
        else:
            c0 = c1 = bands[-1][1]; t = 0
        for x in range(Wd):
            # tramage ordonné 2x2
            thr = [[0.2, 0.7], [0.95, 0.45]][y % 2][x % 2]
            px[x, y] = rgb(c1 if t > thr else c0)
    # étoiles
    for _ in range(45):
        x, y = random.randrange(Wd), random.randrange(0, 60)
        px[x, y] = rgb(random.choice('WWCY'))
    for (x, y) in ((22, 14), (150, 30), (120, 8)):
        for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
            px[x + dx, y + dy] = rgb('W')

    # --- soleil rayé
    cx, cy, R = 90, 128, 46
    for y in range(cy - R, horizon):
        for x in range(cx - R, cx + R + 1):
            if (x - cx) ** 2 + (y - cy) ** 2 <= R * R:
                k = (y - (cy - R))
                gap = k > 22 and (k % 7) < max(1, (k - 18) // 7)
                if not gap:
                    px[x, y] = rgb('Y' if k < 14 else ('O' if k < 30 else 'P'))

    # --- skyline méditerranéenne (silhouette) + palmiers
    sky = [0] * Wd
    random.seed(3)
    x = 0
    while x < Wd:
        w = random.randint(6, 14); h = random.randint(4, 16)
        if 60 < x < 120:
            h = random.randint(2, 6)
        for xx in range(x, min(Wd, x + w)):
            sky[xx] = h
        x += w
    for x in range(Wd):
        for y in range(horizon - sky[x], horizon):
            px[x, y] = rgb('N')
    # fenêtres allumées
    for _ in range(26):
        x = random.randrange(Wd)
        if sky[x] > 5:
            px[x, horizon - random.randint(2, sky[x] - 1)] = rgb('Y')

    def palm(x0, base, h, flip=1):
        for i in range(h):
            xx = x0 + int(round(math.sin(i / h * 1.2) * 3 * flip))
            px[xx, base - i] = rgb('K'); px[xx + 1, base - i] = rgb('K')
        tx, ty = x0 + int(round(math.sin(1.2) * 3 * flip)), base - h
        for a in range(7):
            ang = -math.pi / 2 + (a - 3) * 0.55
            for r in range(1, 12):
                xx = int(tx + math.cos(ang) * r * 1.1)
                yy = int(ty + math.sin(ang) * r * 0.6 + (r * r) / 18)
                if 0 <= xx < Wd and 0 <= yy < Ht:
                    px[xx, yy] = rgb('K')
                    if 0 <= yy + 1 < Ht:
                        px[xx, yy + 1] = rgb('K')
    palm(10, horizon + 6, 46, 1)
    palm(166, horizon + 6, 40, -1)

    # --- sol hors terrain
    d.rectangle([0, horizon, Wd, Ht], fill=rgb('N'))
    for y in range(horizon, Ht, 3):
        for x in range((y // 3) % 2 * 2, Wd, 4):
            px[x, y] = rgb('K')

    # --- terrain en perspective
    HY, A, B, CX = 40, 300, 118, 90
    zfar = A / (138 - HY)

    def P(u, v, h=0.0):
        z = 1 + v * (zfar - 1)
        return CX + u * B / z, HY + A / z - h * B / z

    def poly(pts, col):
        d.polygon([(round(a), round(b)) for a, b in pts], fill=rgb(col))

    def line(p0, p1, col, w=1):
        d.line([(round(p0[0]), round(p0[1])), (round(p1[0]), round(p1[1]))], fill=rgb(col), width=w)

    poly([P(-1, 0), P(1, 0), P(1, 1), P(-1, 1)], 'B')
    # lignes : fond, service, médiane
    for v in (0, 1):
        line(P(-1, v), P(1, v), 'W')
    for v in (0.15, 0.85):
        line(P(-1, v), P(1, v), 'W')
    line(P(0, 0.15), P(0, 0.85), 'W')
    line(P(-1, 0), P(-1, 1), 'W'); line(P(1, 0), P(1, 1), 'W')

    # vitres du fond (ad) : panneau + reflets tramés
    gh = 0.62
    back = [P(-1, 1), P(1, 1), P(1, 1, gh), P(-1, 1, gh)]
    x0, y0 = round(back[3][0]), round(back[3][1]); x1, y1 = round(back[1][0]), round(back[1][1])
    for y in range(y0, y1):
        for x in range(x0, x1 + 1):
            if (x + y) % 9 == 0 or (x + y) % 9 == 1 and (x // 6) % 3 == 0:
                px[x, y] = rgb('C')
    line(back[3], back[2], 'C'); line(back[0], back[3], 'L'); line(back[1], back[2], 'L')
    for u in (-0.5, 0, 0.5):
        line(P(u, 1), P(u, 1, gh), 'L')
    # grillage haut du fond
    for u in [i / 6 - 1 for i in range(13)]:
        line(P(u, 1, gh), P(u, 1, gh + 0.3), 'L')
    line(P(-1, 1, gh + 0.3), P(1, 1, gh + 0.3), 'L')

    # parois latérales : verre aux extrémités, grillage au centre
    for side in (-1, 1):
        for i in range(10):
            v0, v1 = i / 10, (i + 1) / 10
            glass = i < 2 or i > 7
            hh = gh if glass else gh + 0.3
            a, b, c = P(side, v0), P(side, v1), P(side, v1, hh)
            # poteau
            line(P(side, v0), P(side, v0, hh), 'L')
            if glass:
                xa, xb = sorted((round(a[0]), round(b[0])))
                for x in range(xa, xb + 1):
                    t = 0 if xb == xa else (x - a[0]) / (b[0] - a[0])
                    ytop = lerp(P(side, v0, hh)[1], c[1], t); ybot = lerp(a[1], b[1], t)
                    for y in range(round(ytop), round(ybot)):
                        if (x * 2 + y) % 11 == 0:
                            px[x, y] = rgb('C')
                line(P(side, v0, hh), c, 'C')
            else:
                for k in range(1, 4):
                    line(P(side, v0, hh * k / 4), P(side, v1, hh * k / 4), 'L')
        line(P(side, 1), P(side, 1, gh), 'L')

    # filet
    nh = 0.09
    line(P(-1.04, 0.5), P(1.04, 0.5), 'K')
    for i in range(0, 41):
        u = -1.04 + i * 2.08 / 40
        line(P(u, 0.5), P(u, 0.5, nh), 'L')
    line(P(-1.04, 0.5, nh), P(1.04, 0.5, nh), 'W', 1)
    line(P(-1.04, 0.5), P(-1.04, 0.5, nh * 1.4), 'W'); line(P(1.04, 0.5), P(1.04, 0.5, nh * 1.4), 'W')

    # projecteurs
    for side in (-1, 1):
        for v in (0.25, 0.75):
            top = P(side * 1.12, v, 1.6)
            bot = P(side * 1.12, v, 0)
            line(bot, top, 'L')
            tx, ty = round(top[0]), round(top[1])
            d.rectangle([tx - 3, ty - 2, tx + 3, ty], fill=rgb('W'))
            d.rectangle([tx - 3, ty - 3, tx + 3, ty - 3], fill=rgb('L'))

    # --- adversaires au fond (1x)
    toro = sprites.make(sprites.CHARS[6], 'idle')
    reina = sprites.make(sprites.CHARS[7], 'low')
    for spr, u, v in ((toro, -0.45, 0.82), (reina, 0.45, 0.78)):
        x, y = P(u, v)
        im.alpha_composite(spr, (round(x) - 8, round(y) - 23))

    # --- héros au premier plan (x3)
    lola = up(sprites.make(sprites.CHARS[0], 'swing', 'front'), 3)
    nico = up(sprites.make(sprites.CHARS[1], 'low', 'front'), 3)
    # ombres
    for (x, y, w) in ((44, 284, 34), (128, 278, 34)):
        for yy in range(y, y + 4):
            for xx in range(x - w // 2, x + w // 2):
                if (xx + yy) % 2 == 0:
                    px[xx, yy] = rgb('K')
    im.alpha_composite(lola, (20, 216))
    im.alpha_composite(nico, (104, 210))

    # --- balle + traînée
    bx, by = 118, 168
    sx0, sy0 = 64, 214
    n = 40
    for i in range(n):
        t = i / n
        tx = lerp(sx0, bx - 3, t); ty = lerp(sy0, by + 2, t)
        r = t * 2.6
        c = 'P' if t < 0.35 else ('O' if t < 0.7 else 'Y')
        if (i % 3 != 0) or t > 0.5:
            d.ellipse([tx - r, ty - r, tx + r, ty + r], fill=rgb(c))
    d.ellipse([bx - 4, by - 4, bx + 4, by + 4], fill=rgb('K'))
    d.ellipse([bx - 3, by - 3, bx + 3, by + 3], fill=rgb('Y'))
    px[bx - 1, by - 2] = rgb('W'); px[bx - 2, by - 1] = rgb('W')
    # éclats d'impact sur la vitre lointaine
    # étincelles autour de la balle
    for (dx, dy) in ((7, -6), (9, 0), (6, 6), (-1, -9)):
        px[bx + dx, by + dy] = rgb('W')

    # --- LOGO
    def logo_text(s, scale, x, y, face, side, hi):
        m = text_mask(s, scale, 1)
        # extrusion 3D (vers bas-droite) puis contour noir
        ext = set()
        for k in range(1, scale + 2):
            for (a, b) in m:
                ext.add((a + k, b + k))
        allp = m | ext
        outline = set()
        for (a, b) in allp:
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    if (a + dx, b + dy) not in allp:
                        outline.add((a + dx, b + dy))
        for (a, b) in outline:
            if 0 <= x + a < Wd and 0 <= y + b < Ht:
                px[x + a, y + b] = rgb('K')
        for (a, b) in ext:
            if (a, b) not in m and 0 <= x + a < Wd and 0 <= y + b < Ht:
                px[x + a, y + b] = rgb(side)
        mh = max(b for a, b in m)
        for (a, b) in m:
            if 0 <= x + a < Wd and 0 <= y + b < Ht:
                c = face if b < mh * 0.55 else hi
                px[x + a, y + b] = rgb(c)
        # reflet
        for (a, b) in m:
            if b == min(bb for aa, bb in m if aa == a) and (a % 5) < 2 and 0 <= x + a < Wd:
                px[x + a, y + b] = rgb('W')

    tw = text_width(title, 5, 1)
    logo_text(title, 5, (Wd - tw) // 2 - 2, 24, 'Y', 'P', 'O')
    nw = text_width(num, 6, 1)
    logo_text(num, 6, (Wd - nw) // 2 - 2, 72, 'C', 'M', 'C')
    # étoiles de part et d'autre du 86
    for sx in (34, 140):
        for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1), (2, 0), (-2, 0), (0, 2), (0, -2)):
            px[sx + dx, 90 + dy] = rgb('W' if abs(dx) + abs(dy) < 2 else 'Y')
    # bandeau sous-titre
    sub = tagline
    sw = text_width(sub, 1, 1)
    d.rectangle([(Wd - sw) // 2 - 5, 61, (Wd + sw) // 2 + 3, 69], fill=rgb('K'))
    draw_text(im, (Wd - sw) // 2, 62, sub, 'W', 1, 1)

    # --- bas d'affiche
    d.rectangle([0, 292, Wd, Ht], fill=rgb('K'))
    for x in range(0, Wd, 2):
        px[x, 291] = rgb('K')
    if blink:
        ps = 'PRESS START'
        pw = text_width(ps, 2, 1)
        draw_text(im, (Wd - pw) // 2, 295, ps, 'Y', 2, 1, shadow='P')
    draw_text(im, (Wd - text_width(footer, 1, 1)) // 2, 312, footer, 'L', 1, 1)
    return im


def crt(big, k=6):
    """Légère trame CRT : 1 ligne sur k assombrie."""
    px = big.load()
    W, H = big.size
    for y in range(k - 1, H, k):
        for x in range(W):
            r, g, b, a = px[x, y]
            px[x, y] = (int(r * 0.78), int(g * 0.78), int(b * 0.78), a)
    return big


if __name__ == '__main__':
    p = make_poster()
    p.save('/tmp/poster_1x.png')
    crt(up(p, 6)).convert('RGB').save('/tmp/poster.png')
