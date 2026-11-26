"""Générateur de sprites 16x24 pour PÁDEL 86."""
from PIL import Image
from pix import rgb

W, H = 16, 24

CHARS = [
    # id, nom, surnom, équipe, peau, cheveux, style, maillot, accent, short, chaussures, raquette, extras
    dict(id='lola', name='LOLA', nick='LA PARED', team='hero', skin='T', hair='H', style='pony',
         shirt='P', acc='W', shorts='B', shoes='W', racket='C', extras=[]),
    dict(id='nico', name='NICO', nick='BANDEJA', team='hero', skin='S', hair='D', style='band',
         band='C', shirt='C', acc='B', shorts='N', shoes='W', racket='P', extras=[]),
    dict(id='gunther', name='GÜNTHER', nick='EL GUIRI', team='facile', skin='S', hair='Y', style='cap',
         cap='G', shirt='O', acc='Y', shorts='W', shoes='D', racket='L', extras=['sunburn', 'socks', 'belly']),
    dict(id='brigitte', name='BRIGITTE', nick='LA VISERA', team='facile', skin='S', hair='O', style='visor',
         cap='Y', shirt='W', acc='P', shorts='P', shoes='W', racket='Y', extras=['shades']),
    dict(id='paco', name='PACO', nick='EL BIGOTE', team='moyen', skin='T', hair='H', style='band',
         band='R', shirt='G', acc='W', shorts='W', shoes='W', racket='R', extras=['mustache']),
    dict(id='pepa', name='PEPA', nick='LA ABUELA', team='moyen', skin='S', hair='L', style='bun',
         shirt='M', acc='W', shorts='M', shoes='W', racket='G', extras=['glasses', 'skirt']),
    dict(id='toro', name='EL TORO', nick='SMASH', team='fort', skin='T', hair='H', style='bald',
         band='Y', shirt='R', acc='K', shorts='K', shoes='W', racket='Y', extras=['big', 'beard']),
    dict(id='reina', name='LA REINA', nick='LA VIBORA', team='fort', skin='D', hair='H', style='afro',
         band='P', shirt='Y', acc='M', shorts='M', shoes='W', racket='M', extras=[]),
]


class Grid:
    def __init__(self):
        self.g = [['.'] * W for _ in range(H)]

    def p(self, x, y, c):
        if 0 <= x < W and 0 <= y < H:
            self.g[y][x] = c

    def rect(self, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.p(x, y, c)

    def outline(self, col='K'):
        src = [row[:] for row in self.g]
        for y in range(H):
            for x in range(W):
                if src[y][x] == '.':
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        xx, yy = x + dx, y + dy
                        if 0 <= xx < W and 0 <= yy < H and src[yy][xx] not in '.':
                            self.g[y][x] = col
                            break

    def img(self):
        im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        px = im.load()
        for y in range(H):
            for x in range(W):
                c = self.g[y][x]
                if c != '.':
                    px[x, y] = rgb(c)
        return im


def racket(g, cx, cy, col, angle='up'):
    """Raquette de pádel : tête pleine 5x6 avec trous, manche 1x3."""
    if angle == 'up':
        g.rect(cx - 2, cy - 7, cx + 2, cy - 3, col)
        g.rect(cx - 1, cy - 8, cx + 1, cy - 8, col)
        g.p(cx - 1, cy - 5, 'K'); g.p(cx + 1, cy - 5, 'K'); g.p(cx, cy - 6, 'K')
        g.rect(cx, cy - 2, cx, cy, 'K')
    elif angle == 'side':  # pointée vers la droite
        g.rect(cx + 3, cy - 2, cx + 7, cy + 2, col)
        g.rect(cx + 8, cy - 1, cx + 8, cy + 1, col)
        g.p(cx + 5, cy - 1, 'K'); g.p(cx + 5, cy + 1, 'K'); g.p(cx + 6, cy, 'K')
        g.rect(cx + 1, cy, cx + 2, cy, 'K')
    elif angle == 'down':
        g.rect(cx - 2, cy + 3, cx + 2, cy + 7, col)
        g.rect(cx - 1, cy + 8, cx + 1, cy + 8, col)
        g.p(cx - 1, cy + 5, 'K'); g.p(cx + 1, cy + 5, 'K'); g.p(cx, cy + 6, 'K')
        g.rect(cx, cy + 1, cx, cy + 2, 'K')


def make(ch, frame='idle', facing='front'):
    g = Grid()
    big = 'big' in ch['extras']
    bob = 1 if frame in ('run1', 'run2') else 0
    oy = bob  # décalage vertical du haut du corps
    sk, sh = ch['skin'], ch['shirt']
    if 'sunburn' in ch['extras']:
        sk = 'S'

    # --- jambes / short
    legL, legR = (5, 6), (9, 10)
    footL, footR = 0, 0
    if frame == 'run1':
        footL, footR = -1, 1
    elif frame == 'run2':
        footL, footR = 1, -1
    for (x0, x1), f in ((legL, footL), (legR, footR)):
        g.rect(x0, 18, x1, 20 + min(f, 0), sk)
        sock = 'W'
        g.rect(x0, 21 + min(f, 0), x1, 21 + min(f, 0), sock)
        g.rect(x0 - (1 if x0 < 8 else 0), 22 + min(f, 0), x1 + (1 if x0 > 8 else 0), 22 + min(f, 0), ch['shoes'])
    if 'socks' in ch['extras']:  # chaussettes hautes + sandales
        for (x0, x1), f in ((legL, footL), (legR, footR)):
            g.rect(x0, 19 + min(f, 0), x1, 21 + min(f, 0), 'W')
    if 'skirt' in ch['extras']:
        g.rect(4, 16 + oy, 11, 18 + oy, ch['shorts'])
    else:
        g.rect(5, 16 + oy, 10, 18 + oy, ch['shorts'])
        g.p(7, 18 + oy, '.'); g.p(8, 18 + oy, '.')

    # --- torse
    tx0, tx1 = (3, 12) if big else (4, 11)
    g.rect(tx0, 10 + oy, tx1, 15 + oy, sh)
    g.rect(tx0, 13 + oy, tx1, 13 + oy, ch['acc'])  # bande
    if 'belly' in ch['extras']:
        g.rect(tx0, 14 + oy, tx1, 15 + oy, sh); g.p(tx0 - 1, 14 + oy, sh); g.p(tx1 + 1, 14 + oy, sh)
    if ch['id'] in ('gunther',):  # chemise hawaïenne : motifs
        for (x, y) in ((5, 11), (9, 12), (6, 15), (10, 14)):
            g.p(x, y + oy, 'Y')
    if facing == 'front':
        g.rect(7, 10 + oy, 8, 10 + oy, sk)  # col

    # --- bras gauche (côté écran gauche)
    ax = tx0 - 1
    g.rect(ax, 10 + oy, ax, 11 + oy, sh)
    g.rect(ax, 12 + oy, ax, 14 + oy, sk)
    # --- bras droit + raquette
    rx = tx1 + 1
    if frame == 'swing':
        g.rect(rx, 10 + oy, rx, 11 + oy, sh)
        g.rect(rx + 1, 9 + oy, rx + 1, 10 + oy, sk)
        racket(g, rx + 1, 8 + oy, ch['racket'], 'up')
    elif frame == 'low':
        g.rect(rx, 10 + oy, rx, 11 + oy, sh)
        g.rect(rx, 12 + oy, rx + 1, 13 + oy, sk)
        racket(g, rx + 1, 13 + oy, ch['racket'], 'down')
    else:
        g.rect(rx, 10 + oy, rx, 11 + oy, sh)
        g.rect(rx, 12 + oy, rx, 14 + oy, sk)
        racket(g, rx, 15 + oy, ch['racket'], 'down') if False else racket(g, rx, 14 + oy, ch['racket'], 'up')

    # --- tête
    hx0, hx1, hy0, hy1 = 5, 10, 3 + oy, 9 + oy
    g.rect(hx0, hy0, hx1, hy1, sk)
    st, hc = ch['style'], ch['hair']
    if facing == 'back':
        g.rect(hx0, hy0, hx1, hy1 - 1, hc if st not in ('bald',) else sk)
    if st in ('pony', 'short', 'band', 'bun'):
        g.rect(hx0, hy0, hx1, hy0 + 1, hc); g.p(hx0, hy0 + 2, hc); g.p(hx1, hy0 + 2, hc)
    if st == 'pony':
        g.rect(hx1 + 1, hy0 + 1, hx1 + 1, hy0 + 5, hc); g.p(hx1 + 2, hy0 + 4, hc); g.p(hx1 + 1, hy0 + 1, 'P')
    if st == 'bun':
        g.rect(7, hy0 - 2, 8, hy0 - 1, hc)
    if st in ('band', 'bald'):
        g.rect(hx0, hy0 + 2, hx1, hy0 + 2, ch['band'])
        g.p(hx0 - 1, hy0 + 3, ch['band'])
    if st == 'bald':
        g.rect(hx0 + 1, hy0, hx1 - 1, hy0, sk)
    if st == 'afro':
        g.rect(hx0 - 1, hy0 - 2, hx1 + 1, hy0 + 1, hc)
        g.rect(hx0 - 2, hy0 - 1, hx1 + 2, hy0 + 3, hc)
        g.rect(hx0, hy0 + 2, hx1, hy0 + 2, ch['band'])
        g.rect(hx0, hy0 + 3, hx1, hy1, sk)
        g.rect(hx0 - 2, hy0 + 4, hx0 - 1, hy0 + 5, hc); g.rect(hx1 + 1, hy0 + 4, hx1 + 2, hy0 + 5, hc)
    if st == 'cap':
        g.rect(hx0, hy0, hx1, hy0 + 1, ch['cap']); g.rect(hx0 - 2, hy0 + 2, hx1, hy0 + 2, ch['cap'])
        g.p(hx1, hy0 + 3, hc)
    if st == 'visor':
        g.rect(hx0, hy0, hx1, hy0, hc); g.rect(hx0 - 1, hy0 + 1, hx1 + 1, hy0 + 1, ch['cap'])
        g.rect(hx0 - 1, hy0 + 2, hx0 - 1, hy0 + 6, hc); g.rect(hx1 + 1, hy0 + 2, hx1 + 1, hy0 + 6, hc)

    if facing == 'front':
        ey = hy0 + 4 if st != 'afro' else hy0 + 4
        g.p(6, ey, 'K'); g.p(9, ey, 'K')
        if 'shades' in ch['extras']:
            g.rect(5, ey, 10, ey, 'K'); g.p(6, ey, 'C'); g.p(9, ey, 'C')
        if 'glasses' in ch['extras']:
            g.p(5, ey, 'W'); g.p(7, ey, 'W'); g.p(8, ey, 'W'); g.p(10, ey, 'W')
        if 'mustache' in ch['extras']:
            g.rect(6, ey + 2, 9, ey + 2, 'H')
        if 'beard' in ch['extras']:
            g.rect(5, ey + 2, 10, hy1, 'H'); g.rect(7, ey + 2, 8, ey + 2, sk)
        else:
            g.rect(7, ey + 3, 8, ey + 3, 'R' if ch['id'] in ('brigitte', 'reina', 'lola') else 'D')
        if 'sunburn' in ch['extras']:
            g.p(5, ey + 1, 'P'); g.p(10, ey + 1, 'P'); g.p(7, ey + 1, 'P'); g.p(8, ey + 1, 'P')
    g.outline('K')
    return g.img()


FRAMES = ['idle', 'run1', 'run2', 'swing', 'low']


def sheet(scale=1):
    """Planche : une ligne par perso, colonnes = frames + vue de dos."""
    cols = FRAMES + ['back']
    im = Image.new('RGBA', (W * len(cols), H * len(CHARS)), (0, 0, 0, 0))
    for r, ch in enumerate(CHARS):
        for c, fr in enumerate(cols):
            s = make(ch, 'idle', 'back') if fr == 'back' else make(ch, fr)
            im.alpha_composite(s, (c * W, r * H))
    return im


if __name__ == '__main__':
    from pix import up
    bg = Image.new('RGBA', (W * 6 + 12, H * len(CHARS) + 16), rgb('N'))
    bg.alpha_composite(sheet(), (6, 8))
    up(bg, 5).save('/tmp/sheet_preview.png')
