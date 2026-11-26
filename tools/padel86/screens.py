"""Maquettes d'écrans PÁDEL 86 : en jeu (vue de dessus, portrait) et menu."""
from PIL import Image, ImageDraw
from pix import rgb, draw_text, text_width, up
import sprites

Wd, Ht = 180, 320


def box(d, x0, y0, x1, y1, fill='K', border='W', shadow='P'):
    d.rectangle([x0 + 2, y0 + 2, x1 + 2, y1 + 2], fill=rgb(shadow))
    d.rectangle([x0, y0, x1, y1], fill=rgb(border))
    d.rectangle([x0 + 1, y0 + 1, x1 - 1, y1 - 1], fill=rgb(fill))


def ingame():
    im = Image.new('RGBA', (Wd, Ht), rgb('N'))
    px = im.load(); d = ImageDraw.Draw(im)
    for y in range(Ht):
        for x in range((y % 2), Wd, 2):
            if (x // 2 + y // 2) % 3 == 0:
                px[x, y] = rgb('K')
    # terrain vue de dessus (10 x 20 m -> 120 x 240 px)
    cx0, cy0, cw, chh = 30, 50, 120, 240
    d.rectangle([cx0 - 4, cy0 - 4, cx0 + cw + 3, cy0 + chh + 3], fill=rgb('L'))  # cadre métal
    # vitres : bord cyan intérieur avec reflets
    d.rectangle([cx0 - 3, cy0 - 3, cx0 + cw + 2, cy0 + chh + 2], fill=rgb('C'))
    d.rectangle([cx0, cy0, cx0 + cw - 1, cy0 + chh - 1], fill=rgb('B'))
    # grillage sur les côtés (zone centrale)
    for y in range(cy0 + 48, cy0 + chh - 48):
        for x in (cx0 - 3, cx0 - 2, cx0 + cw + 1, cx0 + cw + 2):
            px[x, y] = rgb('L' if (y // 2) % 2 else 'K')
    # lignes
    W = rgb('W')
    d.line([cx0, cy0 + 36, cx0 + cw - 1, cy0 + 36], fill=W)
    d.line([cx0, cy0 + chh - 37, cx0 + cw - 1, cy0 + chh - 37], fill=W)
    d.line([cx0 + cw // 2, cy0 + 36, cx0 + cw // 2, cy0 + chh - 37], fill=W)
    # filet
    ny = cy0 + chh // 2
    d.rectangle([cx0 - 6, ny - 1, cx0 + cw + 5, ny + 1], fill=rgb('K'))
    for x in range(cx0 - 6, cx0 + cw + 6, 2):
        px[x, ny] = rgb('W')
    # reflets vitres (diagonales)
    for (x, y) in ((cx0 + 10, cy0 - 3), (cx0 + 80, cy0 + chh + 2)):
        for k in range(6):
            if 0 <= x + k < Wd:
                px[x + k, y] = rgb('W')
    # joueurs adverses (face), héros (dos)
    toro = sprites.make(sprites.CHARS[6], 'idle')
    reina = sprites.make(sprites.CHARS[7], 'run1')
    lola = sprites.make(sprites.CHARS[0], 'swing', 'back')
    nico = sprites.make(sprites.CHARS[1], 'idle', 'back')
    for spr, (x, y) in ((toro, (52, 70)), (reina, (110, 95)), (lola, (58, 222)), (nico, (108, 240))):
        for yy in range(y + 21, y + 24):
            for xx in range(x + 3, x + 13):
                if (xx + yy) % 2 == 0:
                    px[xx, yy] = rgb('K')
        im.alpha_composite(spr, (x, y))
    # balle + ombre
    d.ellipse([96, 150, 99, 153], fill=rgb('K'))
    d.ellipse([92, 140, 97, 145], fill=rgb('Y'))
    px[93, 141] = rgb('W')
    for k, (x, y) in enumerate(((80, 160), (84, 154), (88, 148))):
        px[x, y] = rgb('P'); px[x + 1, y] = rgb('O')
    # éclat « VITRE ! »
    draw_text(im, 128, 120, 'VITRE!', 'Y', 1, 1, shadow='K')

    # HUD score
    box(d, 4, 4, 175, 38, 'K', 'C', 'M')
    draw_text(im, 10, 12, 'LOLA/NICO', 'P', 1, 1)
    draw_text(im, 10, 25, 'TORO/REINA', 'L', 1, 1)
    d.rectangle([10, 20, 70, 20], fill=rgb('N'))
    # cases score
    for i, (a, b) in enumerate((('1', '0'), ('30', '15'))):
        x = 92 + i * 30
        d.rectangle([x, 8, x + 24, 34], fill=rgb('N'))
        draw_text(im, x + 12 - text_width(a, 1, 1) // 2, 12, a, 'Y', 1, 1)
        draw_text(im, x + 12 - text_width(b, 1, 1) // 2, 25, b, 'W', 1, 1)
    draw_text(im, 152, 12, '2:41', 'W', 1, 1)
    d.rectangle([150, 23, 172, 33], fill=rgb('P'))
    draw_text(im, 153, 25, 'DUO', 'W', 1, 1)
    # zones pouces
    for (x, lab) in ((8, 'LOLA'), (98, 'NICO')):
        d.rectangle([x, 298, x + 73, 315], outline=rgb('C'))
        draw_text(im, x + 37 - text_width(lab, 1, 1) // 2, 304, lab, 'C', 1, 1)
    return im


def menu():
    im = Image.new('RGBA', (Wd, Ht), rgb('K'))
    px = im.load(); d = ImageDraw.Draw(im)
    # damier de fond rétro
    for y in range(Ht):
        for x in range(Wd):
            if ((x // 10) + (y // 10)) % 2 == 0:
                px[x, y] = rgb('N')
    draw_text(im, (Wd - text_width('PÁDEL 86', 2, 1)) // 2, 16, 'PÁDEL 86', 'Y', 2, 1, shadow='P')
    y = 44
    sections = [
        ('MODE', [('DUO  2 POUCES', True), ('CLASSIQUE  1 POUCE', False)]),
        ('ADVERSAIRES', [('LOS GUIRIS', False), ('LOS PRIMOS', True), ('LOS REYES', False)]),
        ('FORMAT', [('1 JEU  3 MIN', True), ('3 JEUX  10 MIN', False)]),
    ]
    for title, opts in sections:
        draw_text(im, 14, y, title, 'C', 1, 1)
        y += 11
        for lab, sel in opts:
            if sel:
                box(d, 12, y - 3, 167, y + 9, 'P', 'W', 'M')
                draw_text(im, 18, y, '> ' + lab, 'W', 1, 1)
            else:
                d.rectangle([12, y - 3, 167, y + 9], outline=rgb('L'))
                draw_text(im, 18, y, '  ' + lab, 'L', 1, 1)
            y += 16
        y += 6
    # adversaires du niveau choisi
    gun, pep = sprites.make(sprites.CHARS[4], 'idle'), sprites.make(sprites.CHARS[5], 'idle')
    im.alpha_composite(up(gun, 2), (44, 222)); im.alpha_composite(up(pep, 2), (104, 222))
    draw_text(im, (Wd - text_width('PACO & PEPA', 1, 1)) // 2, 272, 'PACO & PEPA', 'W', 1, 1)
    box(d, 30, 288, 149, 308, 'Y', 'W', 'P')
    draw_text(im, (Wd - text_width('JOUER !', 2, 1)) // 2, 292, 'JOUER !', 'K', 2, 1)
    return im


if __name__ == '__main__':
    import poster, os
    os.makedirs('out', exist_ok=True)
    ingame().save('out/padel86-ecran-jeu-1x.png')
    menu().save('out/padel86-ecran-menu-1x.png')
    poster.make_poster(blink=False).save('out/padel86-titre-noblink-1x.png')
    both = Image.new('RGBA', (Wd * 2 + 10, Ht), rgb('W'))
    both.alpha_composite(ingame(), (0, 0)); both.alpha_composite(menu(), (Wd + 10, 0))
    up(both, 3).save('/tmp/screens_prev.png')
