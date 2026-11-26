"""Assemble la bible d'univers PÁDEL 86 en un seul fichier HTML autonome."""
import base64, json, html
from pix import PAL, PAL_NAMES
import sprites


def b64(path, mime):
    return f"data:{mime};base64," + base64.b64encode(open(path, 'rb').read()).decode()


A = {
    'title': b64('out/padel86-affiche-1x.png', 'image/png'),
    'title_nb': b64('out/padel86-titre-noblink-1x.png', 'image/png'),
    'sheet': b64('out/padel86-sprites-1x.png', 'image/png'),
    'game': b64('out/padel86-ecran-jeu-1x.png', 'image/png'),
    'menu': b64('out/padel86-ecran-menu-1x.png', 'image/png'),
    'theme': b64('out/padel86-theme.mp3', 'audio/mpeg'),
}
SFX = ['coin', 'hit', 'vitre', 'smash', 'point', 'faute', 'victoire', 'defaite']
SFX_LABEL = {'coin': 'Validation menu', 'hit': 'Frappe', 'vitre': 'Rebond vitre', 'smash': 'Smash',
             'point': 'Point gagné', 'faute': 'Faute', 'victoire': 'Victoire', 'defaite': 'Défaite'}
for s in SFX:
    A['sfx_' + s] = b64(f'out/sfx/{s}.mp3', 'audio/mpeg')

LORE = {
    'lola': dict(full='Lola Vega', city='Barcelone', role='Défense · fond de court',
                 bio="Elle a grandi entre deux vitres du club du Poblenou. Elle lit un rebond avant qu'il n'existe. Tant qu'elle est derrière, rien ne meurt.",
                 special=('REBOTE FANTASMA', "La balle longe la vitre et retombe morte au pied du filet."),
                 stats=dict(Puissance=3, Vitesse=4, Vitres=5, Toucher=4)),
    'nico': dict(full='Nico Rossi', city='Nice · port Lympia', role='Attaque · filet',
                 bio="Bandeau cyan, sourire de plagiste, il ne recule jamais. Son terrain, c'est les deux mètres devant le filet.",
                 special=('BANDEJA AZUR', "Bandeja coupée qui fuit le long du grillage, imprenable."),
                 stats=dict(Puissance=4, Vitesse=4, Vitres=3, Toucher=4)),
    'gunther': dict(full='Günther', city='Düsseldorf → Salou', role='Niveau facile',
                    bio="En vacances à Salou chaque été depuis 1979. Chaussettes-sandales, coup de soleil permanent, enthousiasme intact.",
                    special=('LOB SOMBRILLA', "Un lob très haut… et très prévisible."),
                    stats=dict(Puissance=2, Vitesse=1, Vitres=1, Toucher=2)),
    'brigitte': dict(full='Brigitte', city='Lyon', role='Niveau facile',
                     bio="Sa visière jaune lui donne au moins deux points de confiance. Elle a lu un livre sur le pádel dans l'avion.",
                     special=('CHIQUITA AU HASARD', "Une balle courte qui part… quelque part."),
                     stats=dict(Puissance=2, Vitesse=2, Vitres=2, Toucher=3)),
    'paco': dict(full='Paco', city='Valence', role='Niveau moyen',
                 bio="Gérant du club depuis toujours. Il connaît chaque fissure de chaque vitre et il s'en sert.",
                 special=('GLOBO TRAMPA', "Lob qui tape le haut du grillage et change de trajectoire."),
                 stats=dict(Puissance=3, Vitesse=3, Vitres=3, Toucher=3)),
    'pepa': dict(full='Pepa', city='Acapulco → Valence', role='Niveau moyen',
                 bio="71 ans. Elle jure avoir vu jouer le tout premier match de pádel à Acapulco en 1969. Personne n'ose vérifier.",
                 special=('ABUELAZO', "Lob millimétré qui meurt dans le coin des vitres."),
                 stats=dict(Puissance=1, Vitesse=2, Vitres=5, Toucher=5)),
    'toro': dict(full='El Toro', city='Madrid', role='Niveau fort',
                 bio="130 kilos de bonne humeur. Il ne fait pas de bruit en marchant, seulement en frappant.",
                 special=('TORNADO', "Smash qui ressort par-dessus la vitre : point direct, sauf si on sort du court."),
                 stats=dict(Puissance=5, Vitesse=3, Vitres=2, Toucher=2)),
    'reina': dict(full='La Reina', city='Séville', role='Niveau fort',
                  bio="Championne invaincue du Circuito Neón. Elle joue en chantant et ne regarde jamais la balle partir.",
                  special=('VÍBORA REAL', "Víbora liftée-coupée qui accélère après la vitre."),
                  stats=dict(Puissance=4, Vitesse=5, Vitres=4, Toucher=5)),
}
TEAMS = {'hero': ('TON DUO', 'P'), 'facile': ('LOS GUIRIS · facile', 'G'),
         'moyen': ('LOS PRIMOS · moyen', 'O'), 'fort': ('LOS REYES · fort', 'R')}

cards = []
for i, ch in enumerate(sprites.CHARS):
    L = LORE[ch['id']]
    team, tcol = TEAMS[ch['team']]
    stats = "".join(
        f'<div class="st"><span>{k}</span><i>' + "".join(f'<b class="{"on" if j < v else ""}"></b>' for j in range(5)) + '</i></div>'
        for k, v in L['stats'].items())
    cards.append(f'''
<article class="card" style="--accent:{PAL[ch['shirt'] if ch['shirt'] != 'K' else 'R']}">
  <div class="sprite"><canvas data-row="{i}" width="16" height="24"></canvas></div>
  <div class="info">
    <div class="team" style="color:{PAL[tcol]}">{team}</div>
    <h3>{html.escape(ch['name'])}</h3>
    <div class="nick">« {html.escape(ch['nick'])} »</div>
    <p class="meta">{L['full']} · {L['city']} · {L['role']}</p>
    <p>{L['bio']}</p>
    <div class="special"><b>{L['special'][0]}</b> {L['special'][1]}</div>
    <div class="stats">{stats}</div>
  </div>
</article>''')

swatches = "".join(
    f'<div class="sw"><span style="background:{v}"></span><b>{k}</b><em>{PAL_NAMES[k]}</em><code>{v}</code></div>'
    for k, v in PAL.items())
import unicodedata
def _slug(t): return unicodedata.normalize('NFKD', t).encode('ascii', 'ignore').decode().lower().replace(' ', '-')
css_vars = "\n".join(f"  --p86-{_slug(PAL_NAMES[k])}: {v};" for k, v in PAL.items())
sfx_btns = "".join(f'<button class="sfx" data-s="{s}">▶ {SFX_LABEL[s]}<small>{s}.mp3</small></button>' for s in SFX)

HTML = f'''<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PÁDEL 86 — Bible de l'univers</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Space+Grotesk:wght@400;600&display=swap" rel="stylesheet">
<style>
:root{{--k:{PAL['K']};--n:{PAL['N']};--b:{PAL['B']};--c:{PAL['C']};--p:{PAL['P']};--m:{PAL['M']};--y:{PAL['Y']};--o:{PAL['O']};--w:{PAL['W']};--l:{PAL['L']};
--px:'Press Start 2P',ui-monospace,monospace;--tx:'Space Grotesk',system-ui,sans-serif}}
*{{box-sizing:border-box}}
html{{background:var(--k);color:var(--w)}}
body{{margin:0;font:16px/1.6 var(--tx);background:
 linear-gradient(rgba(0,0,0,.18) 50%,transparent 50%) 0 0/100% 4px,var(--k)}}
img,canvas{{image-rendering:pixelated;image-rendering:crisp-edges}}
.wrap{{max-width:1080px;margin:0 auto;padding:0 20px}}
h1,h2,h3,.px{{font-family:var(--px);font-weight:400;letter-spacing:.02em}}
h2{{font-size:clamp(18px,3.4vw,28px);line-height:1.4;margin:0 0 18px;color:var(--y);text-shadow:3px 3px 0 var(--p)}}
section{{padding:64px 0;border-top:4px dashed var(--n)}}
.num{{font-family:var(--px);font-size:11px;color:var(--c);display:block;margin-bottom:12px}}
.lead{{font-size:19px;max-width:720px;color:#e9dfd0}}
/* HERO */
.hero{{display:grid;grid-template-columns:minmax(0,360px) 1fr;gap:48px;align-items:center;padding:48px 0 64px}}
.phone{{position:relative;border:10px solid #202a3a;border-radius:34px;background:#000;box-shadow:0 0 0 3px var(--m),12px 12px 0 var(--p);overflow:hidden;cursor:pointer;aspect-ratio:9/16}}
.phone img{{width:100%;height:100%;display:block}}
.phone .hint{{position:absolute;left:0;right:0;top:8px;text-align:center;font:9px var(--px);color:var(--w);opacity:.8}}
.hero h1{{font-size:clamp(28px,6vw,56px);line-height:1.15;margin:0 0 16px;color:var(--y);text-shadow:4px 4px 0 var(--p),8px 8px 0 var(--m)}}
.hero h1 span{{color:var(--c);text-shadow:4px 4px 0 var(--m)}}
.tag{{display:inline-block;font:11px var(--px);background:var(--p);color:var(--w);padding:8px 10px;margin:4px 6px 4px 0}}
.btn{{font:12px var(--px);background:var(--y);color:var(--k);border:0;padding:14px 18px;box-shadow:4px 4px 0 var(--p);cursor:pointer;margin-top:18px}}
.btn:active{{transform:translate(2px,2px);box-shadow:2px 2px 0 var(--p)}}
.note{{border-left:4px solid var(--o);padding:10px 14px;background:rgba(255,138,31,.08);margin:18px 0;font-size:15px}}
/* palette */
.pal{{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}}
.sw{{background:var(--n);padding:8px;display:grid;grid-template-columns:44px 1fr;gap:2px 10px;align-items:center}}
.sw span{{grid-row:span 3;width:44px;height:44px;border:2px solid var(--k);box-shadow:3px 3px 0 #000}}
.sw b{{font:10px var(--px)}} .sw em{{font-style:normal;font-size:13px}} .sw code{{font-size:12px;color:var(--l)}}
/* cards */
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:18px}}
.card{{background:var(--n);display:grid;grid-template-columns:112px 1fr;gap:16px;padding:16px;border:3px solid var(--k);box-shadow:6px 6px 0 var(--accent)}}
.sprite{{background:repeating-linear-gradient(45deg,#16224a 0 6px,#1d2b53 6px 12px);display:flex;align-items:center;align-self:start;min-height:170px;justify-content:center;padding:8px 0;border:2px solid var(--k)}}
.sprite canvas{{width:96px;height:144px}}
.card h3{{margin:4px 0;font-size:15px;color:var(--w)}}
.team{{font:9px var(--px)}}
.nick{{font:10px var(--px);color:var(--accent);margin-bottom:6px}}
.card p{{margin:6px 0;font-size:14px;line-height:1.5}} .meta{{color:var(--l)}}
.special{{font-size:13px;background:var(--k);padding:8px;margin:8px 0}} .special b{{font:9px var(--px);color:var(--y);display:block;margin-bottom:4px}}
.st{{display:flex;justify-content:space-between;align-items:center;font-size:12px}}
.st i{{display:flex;gap:3px}} .st b{{width:12px;height:8px;background:var(--k)}} .st b.on{{background:var(--accent)}}
/* screens */
.screens{{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:24px}}
.screens figure{{margin:0}} .screens img{{width:100%;border:4px solid var(--k);box-shadow:6px 6px 0 var(--m)}}
figcaption{{font-size:14px;color:var(--l);margin-top:10px}}
/* arenas */
.arenas{{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px}}
.arena{{padding:16px;min-height:200px;border:3px solid var(--k);box-shadow:6px 6px 0 #000;display:flex;flex-direction:column;justify-content:flex-end}}
.arena h3{{font-size:13px;margin:0 0 8px}} .arena p{{margin:0;font-size:14px}}
/* audio */
.player{{background:var(--n);padding:20px;border:3px solid var(--k);box-shadow:6px 6px 0 var(--c)}}
.player audio{{width:100%;margin-top:10px}}
.sfxs{{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-top:18px}}
.sfx{{font:10px var(--px);background:var(--k);color:var(--w);border:2px solid var(--c);padding:12px;text-align:left;cursor:pointer}}
.sfx small{{display:block;font:12px var(--tx);color:var(--l);margin-top:6px}}
.sfx:hover{{background:var(--c);color:var(--k)}}
table{{width:100%;border-collapse:collapse;font-size:14px}} td,th{{padding:8px;border-bottom:1px solid var(--n);text-align:left;vertical-align:top}}
th{{font:10px var(--px);color:var(--c)}}
pre{{background:#000;border:2px solid var(--n);padding:14px;overflow:auto;font-size:13px;color:var(--c)}}
ul.rules li{{margin:6px 0}}
footer{{padding:40px 0 60px;font:10px var(--px);color:var(--l);text-align:center}}
@media(max-width:720px){{.hero{{grid-template-columns:1fr}} .phone{{max-width:300px;margin:0 auto}} .card{{grid-template-columns:90px 1fr}} .sprite canvas{{width:80px;height:120px}}}}
@media print{{body{{background:var(--k)}} .btn,.sfxs,audio{{display:none}}}}
</style></head><body>
<div class="wrap">

<header class="hero">
  <div class="phone" id="phone" title="Clique pour lancer la musique">
    <img id="titleimg" src="{A['title']}" alt="Écran titre PÁDEL 86">
    <div class="hint">▶ TOUCHE POUR LE SON</div>
  </div>
  <div>
    <span class="num">BIBLE D'UNIVERS · V1 · NOV. 2026</span>
    <h1>PÁDEL <span>86</span></h1>
    <p class="lead">Un jeu de pádel d'arcade qui se joue au pouce, habillé comme une borne de 1986 : 16 couleurs, pixels assumés, synthés analogiques et des vitres partout.</p>
    <span class="tag">ARCADE</span><span class="tag" style="background:var(--b)">PORTRAIT</span><span class="tag" style="background:var(--m)">1-2 POUCES</span><span class="tag" style="background:var(--o)">3 MIN</span>
    <br><button class="btn" id="play">♪ LANCER LE THÈME</button>
  </div>
</header>

<section>
  <span class="num">01 — LE NOM</span>
  <h2>Pourquoi « PÁDEL 86 »</h2>
  <p class="lead">Court, international, et l'accent sur le Á ancre le jeu dans son pays d'origine. « 86 » date l'univers en une seconde : l'âge d'or des bornes, des cassettes et des néons.</p>
  <div class="note"><b>« Padel Match » est écarté :</b> c'est déjà le nom d'une appli de tournois connectée aux classements FFT sur l'App Store français. « Pop Padel » est aussi pris (réservation de terrains). Le champ « Padel + mot générique » est saturé : un nom générique ne serait ni déposable ni trouvable dans les stores. Avant de publier, vérifie « Pádel 86 » sur l'INPI/EUIPO (classes 9 et 41) et dans les stores.</div>
  <p>Repli si besoin : <b>SUPER PÁDEL 86</b>, <b>PÁDEL ARCADE 86</b>. Le slogan reste celui de ton prototype : <b>« JOUE AVEC LES VITRES ! »</b></p>
</section>

<section>
  <span class="num">02 — L'UNIVERS</span>
  <h2>Circuito Neón, été 1986</h2>
  <p class="lead">Chaque été, de Barcelone à Nice, le Circuito Neón réunit les paires les plus folles de la Méditerranée sur des pistes de verre éclairées au néon. Une seule règle compte : <b>les vitres font partie du jeu.</b></p>
  <p>Tu diriges le duo Lola et Nico. Pour décrocher le trophée, il faut battre trois paires de plus en plus coriaces : les touristes de <b>Los Guiris</b>, les cousins du club de <b>Los Primos</b>, puis <b>Los Reyes</b>, la paire invaincue du circuit. Les trois niveaux de difficulté de ton menu actuel deviennent ces trois duos : la difficulté a enfin un visage.</p>
  <p>Ton : pop, chaleureux, jamais cynique. L'humour vient des personnages (les chaussettes-sandales de Günther, la mamie qui lobe), pas de la moquerie.</p>
</section>

<section>
  <span class="num">03 — DIRECTION ARTISTIQUE</span>
  <h2>Palette 16 couleurs</h2>
  <p>Contrainte façon console 8 bits : <b>rien hors de ces 16 couleurs</b>, pas de dégradé lisse (on trame), contour de 1 px « Nuit » autour de chaque sprite. Le fond « Nuit » #0b1622 reprend la couleur de thème actuelle de l'appli.</p>
  <div class="pal">{swatches}</div>
  <ul class="rules">
    <li><b>Résolution logique 180×320</b> (9:16), mise à l'échelle par multiple entier (×3, ×4, ×6), lissage coupé (<code>image-rendering: pixelated</code>).</li>
    <li><b>Sprites 16×24 px</b>, animations à 8 i/s : course sur 2 images, frappe sur 1 image tenue 120 ms.</li>
    <li><b>Ressenti des coups :</b> arrêt de 60 ms sur chaque smash, secousse d'écran de 2 px, flash blanc d'une image quand la balle touche une vitre, texte « VITRE ! » qui apparaît puis disparaît.</li>
    <li><b>Typo :</b> logo dessiné au pixel (police maison 5×7) ; textes d'interface en <i>Press Start 2P</i> (Google Fonts, licence OFL, usage commercial OK).</li>
  </ul>
</section>

<section>
  <span class="num">04 — PERSONNAGES</span>
  <h2>8 joueurs, 4 paires</h2>
  <p>Chaque sprite existe en 6 poses : repos, course ×2, frappe haute, volée basse, vue de dos (pour ta paire, vue de derrière en jeu). Les stats sont des intentions de gameplay à régler dans ton IA actuelle (vitesse de déplacement, précision, usage des vitres).</p>
  <div class="grid">{''.join(cards)}</div>
  <p class="note">Idée de déblocage : <b>EL ROBOT-86</b>, une machine lance-balles devenue consciente, boss secret après une victoire contre Los Reyes sans perdre un jeu.</p>
</section>

<section>
  <span class="num">05 — ÉCRANS</span>
  <h2>Le jeu habillé</h2>
  <div class="screens">
    <figure><img src="{A['title']}" alt=""><figcaption>Écran titre : « PRESS START » clignote à 2 Hz, le thème démarre au premier toucher (contrainte iOS).</figcaption></figure>
    <figure><img src="{A['menu']}" alt=""><figcaption>Menu : tes options actuelles (Mode, Adversaires, Format) en boutons pixel. Le niveau affiche la paire adverse.</figcaption></figure>
    <figure><img src="{A['game']}" alt=""><figcaption>En jeu : vue de dessus portrait, vitres cyan, grillage gris au centre des côtés, tableau de score d'arcade, zones de pouce du mode Duo.</figcaption></figure>
  </div>
</section>

<section>
  <span class="num">06 — ARÈNES</span>
  <h2>4 pistes à débloquer</h2>
  <div class="arenas">
    <div class="arena" style="background:linear-gradient(180deg,var(--k),var(--n) 55%,var(--m))"><h3 style="color:var(--c)">PISTA NEÓN</h3><p>Barcelone, la nuit. Néons rose et cyan. Piste de départ.</p></div>
    <div class="arena" style="background:linear-gradient(180deg,var(--m),var(--p) 40%,var(--o) 75%,var(--y))"><h3 style="color:var(--k)">EL PUERTO</h3><p style="color:var(--k)">Le port de Nice au coucher du soleil. Une mouette traverse parfois la piste et dévie la balle.</p></div>
    <div class="arena" style="background:linear-gradient(180deg,var(--c),var(--w) 60%,var(--o))"><h3 style="color:var(--k)">AZOTEA</h3><p style="color:var(--k)">Un toit de Madrid à midi. La chaleur fait trembler l'image et la balle va 10 % plus vite.</p></div>
    <div class="arena" style="background:linear-gradient(180deg,#5a3a22,#a8743f 60%,#e8c58a)"><h3 style="color:var(--w)">ACAPULCO 1969</h3><p>Hommage au premier terrain de l'histoire du pádel. Palette sépia, piste bonus.</p></div>
  </div>
</section>

<section>
  <span class="num">07 — SON</span>
  <h2>Thème électro old school</h2>
  <div class="player">
    <div class="px" style="font-size:12px;color:var(--y)">« CIRCUITO NEÓN » · 120 BPM · LA MINEUR · 64 S EN BOUCLE</div>
    <p style="font-size:14px;margin:8px 0 0">Boîte à rythmes façon 808 (kick, clap, charleston, cloche), basse carrée syncopée façon électro-funk, arpèges 8 bits et lead à écho pointé. Structure : intro → A → B → break « vitres » → A’. La fin se raccorde au début pour une boucle sans coupure.</p>
    <audio id="theme" controls loop src="{A['theme']}"></audio>
    <div class="sfxs">{sfx_btns}</div>
  </div>
  <table style="margin-top:22px">
    <tr><th>ÉVÉNEMENT</th><th>SON</th></tr>
    <tr><td>Écran titre, menu, match</td><td>padel86-theme.mp3 en boucle (volume −6 dB pendant le match)</td></tr>
    <tr><td>Valider un choix / START</td><td>coin</td></tr>
    <tr><td>Frappe normale · lob · volée</td><td>hit</td></tr>
    <tr><td>Balle sur une vitre</td><td>vitre (+ flash blanc)</td></tr>
    <tr><td>Smash</td><td>smash (+ arrêt 60 ms + secousse)</td></tr>
    <tr><td>Point gagné / perdu</td><td>point / faute</td></tr>
    <tr><td>Fin de match</td><td>victoire / defaite (couper le thème)</td></tr>
  </table>
</section>

<section>
  <span class="num">08 — INTÉGRATION</span>
  <h2>Pour Claude Code</h2>
  <p>Le dossier livré contient tous les fichiers sources (sprites, maquettes, affiche, audio) et un brief <code>BRIEF-CLAUDE-CODE.md</code> à déposer à la racine du repo. Variables CSS de la palette :</p>
  <pre>:root {{
{css_vars}
}}</pre>
  <p>Planche de sprites <code>padel86-sprites-1x.png</code> : cellules 16×24, lignes = {', '.join(c['id'] for c in sprites.CHARS)}, colonnes = idle, run1, run2, swing, low, back.</p>
</section>

<footer>© 1986 LOS PADELISTAS · INSERT COIN TO CONTINUE</footer>
</div>
<script>
const SHEET="{A['sheet']}", T1="{A['title']}", T2="{A['title_nb']}";
const SFX={json.dumps({s: A['sfx_' + s] for s in SFX})};
// clignotement PRESS START
let on=true;setInterval(()=>{{on=!on;document.getElementById('titleimg').src=on?T1:T2}},500);
// son
const theme=document.getElementById('theme');theme.volume=.7;
function toggle(){{if(theme.paused){{theme.play();new Audio(SFX.coin).play()}}else theme.pause()}}
document.getElementById('phone').onclick=toggle;document.getElementById('play').onclick=toggle;
document.querySelectorAll('.sfx').forEach(b=>b.onclick=()=>new Audio(SFX[b.dataset.s]).play());
// sprites animés
const img=new Image();img.src=SHEET;img.onload=()=>{{
  const cvs=[...document.querySelectorAll('canvas[data-row]')];let t=0;
  const seq=[0,0,1,2,1,2,1,2,3,3,0,4,4,0,5,5];
  setInterval(()=>{{t++;cvs.forEach((c,i)=>{{const x=c.getContext('2d');const f=seq[(t+i*3)%seq.length];
    x.clearRect(0,0,16,24);x.drawImage(img,f*16,+c.dataset.row*24,16,24,0,0,16,24)}})}},140);
}};
</script>
</body></html>'''

open('out/padel86-bible-univers.html', 'w').write(HTML)
print(len(HTML) // 1024, 'Ko')
