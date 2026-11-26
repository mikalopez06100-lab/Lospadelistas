# PÁDEL 86

Jeu mobile de padel arcade en pixel art (16 couleurs, ambiance 1986). Le cœur du jeu :
**jouer avec les vitres**. Nom de code d'origine : Rebote.

**État : prototype complet, avec deux modes de jeu.**

- **Duo (2 pouces, par défaut)** : tu diriges Lola et Nico, un pouce chacun. Tu les montes
  au filet, tu volleyes, tu recules quand on te lobe, tu smashes. C'est la vraie logique du padel.
- **Classique (1 pouce)** : Nico se place tout seul, tu ne fais que frapper, Lola est jouée par l'IA.

Trois paires adverses à battre l'une après l'autre : **Los Guiris** (facile), **Los Primos**
(moyen), **Los Reyes** (fort). Une victoire propose d'affronter la paire suivante ; les paires
battues sont marquées d'une étoile au menu (toutes restent sélectionnables).

**Un match = un jeu**, compté comme au padel : 15, 30, 40, puis égalité et avantage (deux points
d'écart pour gagner). Service, musique et sons du kit, ralenti « Rebote », score de style, et
installation sur l'écran d'accueil du téléphone (PWA).

Jouable en ligne : https://lospadelistas.vercel.app

## Lancer en local

Prérequis : Node 20 ou plus récent.

```bash
npm install
npm run dev        # serveur de dev, accessible sur le réseau local
npm test           # tests unitaires (physique, geste → coup, règles, échange, rejeu)
npm run sim        # équilibrage : matchs simulés par niveau d'IA
                   # options : REBOTE_MODE=duo  REBOTE_TACTIQUE=filet  REBOTE_JEUX=1
npm run build      # build de production dans dist/
```

## Tester sur ton téléphone (réseau local)

1. Le téléphone et l'ordinateur doivent être sur **le même Wi-Fi**.
2. Lance `npm run dev`. Vite affiche deux adresses :
   ```
   ➜  Local:   http://localhost:5173/
   ➜  Network: http://192.168.1.42:5173/
   ```
3. Ouvre l'adresse **Network** dans Safari ou Chrome sur le téléphone.
4. Si la page ne charge pas : le pare-feu de l'ordinateur bloque le port 5173. Sur macOS, autorise
   Node dans Réglages → Réseau → Pare-feu. Sur Windows, autorise Node quand la fenêtre le demande.

Limite à connaître : l'installation en PWA exige du HTTPS. Le réseau local suffit pour jouer,
pas pour tester l'installation : pour ça, utilise l'adresse Vercel.

## Univers graphique « PÁDEL 86 »

Tout l'habillage vient du kit de l'auteur ; la simulation n'en dépend pas.

- **Assets** : `public/padel86/` (planche de sprites 16×24, affiche du titre, thème, 8 sons).
- **Références** : `docs/padel86/` (brief, bible de l'univers, maquettes du menu et du jeu).
- **Générateurs** : `tools/padel86/*.py` (palette, police, sprites, affiche, musique), pour
  régénérer les assets après une modification.
- **Rendu** : `src/render/p86.ts`. Pixel art **en perspective et en plein écran** : le terrain
  est vu de derrière ta paire, comme sur l'affiche, mais tracé sans lissage (remplissage ligne
  par ligne, traits de Bresenham). La grille de pixels s'adapte à l'écran : zoom entier le plus
  grand qui laisse au moins 180 pixels de large, puis la grille couvre tout l'écran. Pixels
  carrés, aucune bande. Ta paire, au premier plan, est dessinée ×2 ; les adversaires ×1.
  C'est un écart assumé par rapport à la maquette en jeu du kit (vue de dessus 180×320 fixe),
  pour garder la lisibilité de la hauteur de balle et de la profondeur.
  Le HUD et les textes en jeu utilisent la police bitmap 5×7 du kit (`src/render/font.ts`).
- **Écrans HTML** (titre, menu, fin de match) : `src/style.css`, palette en variables CSS
  `--p86-*`, police Press Start 2P embarquée (pas d'appel à Google Fonts, donc hors ligne).
- **Son** : `src/audio/sfx.ts`. Le thème démarre au premier toucher (PRESS START), joue à plein
  volume au menu, à −6 dB en match, et se coupe à la fin du match. Les impacts sans échantillon
  dans le kit (sol, filet, grillage) restent synthétisés.
- **Ressenti** : smash = arrêt sur image de 60 ms + secousse de 2 px ; vitre = flash blanc sur
  le segment touché + « VITRE ! ».

## Comment jouer

### Mode Duo : un pouce par joueur

- **Moitié gauche de l'écran = ton joueur de gauche, moitié droite = ton joueur de droite.**
- **Glisser le pouce** : un stick apparaît là où tu poses le doigt, le joueur se déplace dans
  cette direction (vers le haut de l'écran = vers le filet).
- **Coup de pouce sec** (geste de moins de 0,4 s) : le joueur frappe. Tant que le pouce file,
  le joueur ne bouge pas : il ne se déplace que quand le pouce se pose.
  - vers le haut, rapide : **coup tendu** ;
  - vers le haut, en douceur : **lob** ;
  - vers le bas : **smash** si la balle est haute (au moins 1,6 m), **amortie** sinon.
  La direction du geste vise à gauche ou à droite. Le nom du coup s'affiche à chaque frappe.
- **Repère jaune au sol** : l'endroit où la balle va rebondir dans ton camp. **Anneau vert** sous
  un joueur : la balle est à sa portée, c'est le moment de frapper.
- **Aide latérale** : un joueur que tu ne touches pas se décale tout seul en largeur vers la
  balle, mais seulement si elle passe à sa profondeur. Monter et reculer reste ta décision : si
  on te lobe alors que tu es au filet, personne ne recule à ta place. L'aide se règle ou se coupe
  dans ⚙ (« Duo — aide latérale »).
- **Les adversaires jouent la même logique** : ils montent au filet après un lob ou quand tu
  restes au fond, reculent quand tu les lobes, et smashent les balles hautes près du filet. Un
  smash qui rebondit et sort par-dessus la vitre de fond donne le point (« sortie après rebond »).
- **Service** : le carré visé est surligné. Pose le doigt n'importe où et tire un trait vers le
  haut : un trait pointillé montre la trajectoire et le point de chute en direct (blanc = dans le
  carré, rouge = faute). La direction du trait décale le point visé, sa longueur règle la
  profondeur. Tu ajustes sans te presser, tu relâches, ça part. Pareil en mode Classique.

### Les aides dépendent du niveau

Le niveau règle la force des adversaires **et** le confort de jeu (`AIDS` et `AI_LEVELS` dans
`src/core/constants.ts`) :

| | Facile | Moyen | Fort |
|---|---|---|---|
| Service ramené dans le carré | oui | non | non |
| Placement automatique sur une balle à jouer après ta vitre | oui | oui | non |
| En sortie de vitre, un geste vers le haut donne un lob propre | oui | non | non |
| Portée de frappe en plus en sortie de vitre | +0,4 m | +0,2 m | aucune |
| Adversaires : balles bombées (plus de temps pour toi) | très | un peu | non |
| Adversaires : smash, amortie, montée au filet | jamais | parfois | souvent |

### Mode Classique : match en double à un pouce

- **Les équipes** : toi (orange) à droite, ton partenaire IA (saumon) à gauche, contre deux IA
  (bleu). Chacun couvre sa moitié du terrain. Dans la bande centrale, la balle revient au plus
  rapide des deux. Avec le bouton Dbg, tu vois qui doit prendre la balle.
- **Service** : quand c'est à toi, « À toi de servir » s'affiche. Swipe vers le haut : un geste
  droit vise le centre du carré, la direction décale le point visé, la puissance règle la
  profondeur. Le service part en diagonale, à droite puis à gauche. Faute → 2e balle, filet puis carré → let, deux fautes → point perdu. Après le
  rebond, la balle peut toucher la vitre mais pas le grillage.
- **Retour de service** : seul le receveur désigné peut jouer, et seulement après le rebond.
- **Pendant l'échange** : quand l'anneau vert s'allume sous ton joueur, swipe vers le haut. Le
  timing donne « Parfait ! », « Trop tôt » ou « Trop tard ». Un mauvais timing dégrade le coup,
  mais la balle part quand même. Un swipe fait jusqu'à 220 ms avant que la balle soit à portée
  est gardé en mémoire. Les balles de la moitié de ton partenaire, c'est lui qui les joue.
- **Score** : 15, 30, 40, puis égalité et avantage. Le match se joue en un seul jeu, et tu sers.
- **Chacun son côté** : Lola à gauche, Nico à droite, adversaires pareil. Au service, le serveur
  sert une fois à droite, une fois à gauche, comme au padel, mais son partenaire ne change pas de
  côté et le serveur regagne le sien juste après. En Duo, un joueur que tu ne touches pas ne va
  jamais s'installer dans le couloir de son partenaire.
- **IA : facile / moyen / fort** (adversaires seulement, ton partenaire est toujours « moyen ») :
  réaction, vitesse, précision, jeu vers le côté libre, position plus ou moins près du filet,
  volées amorties pour conclure, fautes directes. Les paramètres sont dans `AI_LEVELS`
  (`src/core/constants.ts`).

### Bac à sable (phase 0)

- Swipe vers le haut depuis la moitié basse : le joueur part de là où ton doigt démarre.
- **↺** relance exactement le dernier coup, pour comparer avant et après un réglage.

### Dans les deux modes

- **Lob** : deux modes à comparer avec le bouton « Lob ».
  - *Lob : lent* : un swipe lent donne un lob, un swipe rapide un coup tendu.
  - *Lob : crochet* : un swipe courbé donne un lob, un swipe droit un coup tendu.
- **Dbg** affiche la trajectoire prévue (jaune), l'aperçu du coup pendant le geste (orange),
  les impacts prévus (○ sol, ✕ vitre), le point de frappe visé par le placement (cercle vert)
  et les vitesses.

## Sons, vibrations, style (phase 3)

- **Sons et musique** : ceux du kit PÁDEL 86. Le bouton SON coupe tout, et le réglage est
  mémorisé. Le jeu reste entièrement jouable sans son.
- **Vibrations** : sur tes frappes fortes et sur les points gagnés. **Android uniquement** :
  Safari sur iPhone n'implémente pas l'API Vibration, il faudra l'appli native (Capacitor) pour ça.
- **Ralenti « Rebote »** : quand un coup gagnant touche au moins 2 vitres après son rebond, le
  temps ralentit environ une seconde. C'est rare (quelques pourcents des points). Pour voir
  l'effet tout de suite : `rebote.slowMo()` dans la console du navigateur.
- **Score de style** : attribué sur les points gagnés par ton équipe. Barème dans `STYLE`
  (`src/core/constants.ts`) : 100 par point, 5 par frappe de l'échange (max 100), 20 par frappe
  « Parfait », 50 par balle jouée en sortie de vitre, 150 par vitre touchée par le coup gagnant.
  Le meilleur score par niveau d'IA est gardé sur le téléphone.

## Installer sur le téléphone (PWA)

Ouvre https://lospadelistas.vercel.app sur le téléphone :

- **Android (Chrome)** : bouton « Installer l'appli » sur l'écran d'accueil du jeu, ou menu ⋮ →
  « Ajouter à l'écran d'accueil ».
- **iPhone (Safari)** : bouton Partager → « Sur l'écran d'accueil ».

Une fois installé, le jeu s'ouvre en plein écran et fonctionne hors ligne. Les mises à jour
arrivent au lancement suivant quand le téléphone est en ligne. Le service worker
(`public/sw.js`) n'est actif que sur le build de production, pas avec `npm run dev`.
Les icônes sont générées à partir de l'affiche par `python3 scripts/make-icons.py`.
Hors ligne, le jeu et ses sons fonctionnent ; seule la musique a besoin du réseau.

## Ajuster les constantes physiques

Deux façons de faire :

1. **Sur le téléphone, à chaud** : le bouton ⚙ ouvre les curseurs (physique, frappe, vue). Les
   valeurs sont gardées sur ce téléphone (localStorage). « Copier JSON » copie l'ensemble des
   réglages, que tu reportes ensuite dans le fichier ci-dessous.
2. **Dans le code** : tout est dans [`src/core/constants.ts`](src/core/constants.ts). Chaque valeur
   est commentée. Les plus importantes pour le ressenti :

| Constante | Effet |
|---|---|
| `physics.timeScale` | Ralenti global. Le padel réel est trop rapide pour un écran de téléphone. |
| `physics.ground.restitution` | Hauteur du rebond au sol. Elle détermine à quelle hauteur la balle arrive sur la vitre. |
| `physics.glass.restitution` / `tangentialKeep` | Vitesse de sortie de la vitre, et à quel point la balle « glisse » le long de la vitre. |
| `shot.driveMinSpeed` / `driveMaxSpeed` | Plage de vitesse des coups tendus. À puissance max, la balle touche la vitre de fond directement (faute en phase 1). |
| `shot.netClearance` | Marge de passage au-dessus du filet. Le jeu relève l'angle du coup tendu pour passer le filet. |
| `shot.lobThreshold` / `hookCurvature` | Seuil de déclenchement du lob dans chacun des deux modes. |
| `play.moveSpeed` / `play.reach` | Vitesse du placement automatique et portée de frappe : c'est ce qui rend un coup adverse imprenable ou non. |
| `play.maxTimingAimErrorDeg` / `maxTimingPowerError` | Pénalité d'un mauvais timing. |
| `AI_LEVELS` | Les trois niveaux d'IA (non réglables dans le panneau ⚙). |
| `play.duoMoveSpeed` | Mode Duo : vitesse de tes joueurs au stick. |
| `play.assist`, `play.overheadZ`, `play.smashMinZ` | Mode Duo : aide latérale, hauteur max jouable au-dessus de la tête, hauteur min pour smasher. |
| `shot.smash*` | Vitesses du smash, angle plongeant maximum, marge au-dessus du filet. |

Le panneau ⚙ garde tes valeurs sur ce téléphone. Après une modification de `constants.ts`,
clique sur « Valeurs par défaut » dans le panneau pour repartir des nouvelles valeurs.

## Architecture

```
src/
  core/        logique pure : aucun DOM ni canvas, entièrement testable
    constants.ts          toutes les constantes à régler
    physics/step.ts       intégration et collisions balayées (sol, vitres, grillage, filet)
    physics/predict.ts    prédiction de trajectoire avec la même fonction que le jeu
    shot/swipeToShot.ts   geste → intention de coup → vitesse initiale
    shot/aim.ts           coup visé vers un point (utilisé par l'IA, mêmes limites que le joueur)
    rules/rally.ts        règles de l'échange et du service : fautes, let, double rebond
    rules/score.ts        15-30-40, égalité, avantage, jeu, fin de match
    rules/style.ts        score de style d'un point
    play/positioning.ts   placement automatique : instants où la balle sera jouable
    play/match.ts         match en double : service, répartition des balles, frappes, IA
    play/replay.ts        enregistrement et rejeu d'un match (base des fantômes)
    rng.ts                aléatoire à graine (jamais Math.random dans core/)
    sandbox.ts            état du bac à sable (phase 0)
  render/      Canvas 2D : lit l'état sans jamais le modifier
    p86.ts                rendu pixel en perspective, plein écran : terrain, sprites, balle, HUD
    font.ts               police bitmap 5×7 du kit
  input/       touch.ts (un swipe, mode classique) et duoTouch.ts (deux pouces : stick + frappe)
  audio/       sons et musique du kit, vibrations
  app/         panneau de réglages
public/        manifest, service worker, icônes, et le kit PÁDEL 86 (padel86/)
docs/padel86/  brief, bible de l'univers et maquettes de référence
tools/padel86/ générateurs Python des assets
tests/         vitest
scripts/       joueur-robot et simulation d'équilibrage (npm run sim)
```

Choix techniques :

- **Canvas 2D sans moteur de jeu.** La physique 2D + hauteur est faite maison, donc Phaser
  n'apporterait guère plus qu'un 1 Mo de JS de plus. Le code du jeu pèse environ 25 Ko gzippé.
- **Pas fixe de 120 Hz.** Le rendu suit la fréquence de l'écran et interpole entre deux pas. La
  simulation ne dépend donc pas du framerate, ce qu'il faudra pour rejouer des « fantômes ».
- **Collisions analytiques.** Toutes les surfaces sont des plans alignés sur les axes, donc
  l'instant d'impact est calculé exactement. Pas d'effet tunnel, et les coins (deux vitres dans le
  même pas) sont gérés.
- **Rejeu déterministe.** Une partie se rejoue à partir de sa graine et de la liste des coups
  joués, horodatés en ticks. Les coups sont enregistrés comme des intentions (direction,
  puissance, type), pas comme des pixels : un fantôme ne dépend pas de l'écran de son joueur.
  Un test vérifie que le rejeu redonne exactement la même partie. Dans la console du navigateur,
  `rebote.recording()` renvoie l'enregistrement de la partie en cours.
- **Aide au tir sur les coups tendus.** Le jeu choisit le plus petit angle qui passe le filet avec
  la marge `netClearance`. Le joueur ne choisit que la direction et la puissance.

## Équilibrage (mesuré, pas ressenti)

`npm run sim` joue des matchs complets avec un joueur-robot à ta place. Le robot connaît l'instant
de frappe idéal mais swipe avec une erreur de timing aléatoire (60 ms ≈ bon joueur, 120 ms ≈
joueur moyen). En Duo il dirige aussi les deux joueurs au stick.

Matchs en 3 jeux gagnés par le robot, sur 6 :

| Mode | Robot | IA facile | IA moyen | IA fort |
|---|---|---|---|---|
| Classique | bon (60 ms) | 6 | 5 | 2 |
| Classique | moyen (120 ms) | 6 | 4 | 0 |
| Duo | bon | 6 | 6 | 5 |
| Duo | moyen | 6 | 4 | 0 |

À lire avec prudence :

- **Facile est maintenant un vrai niveau d'apprentissage** dans les deux modes.
- **En Duo, « fort » est trop facile pour un joueur précis** (5 sur 6) depuis que tes joueurs
  courent plus vite. À durcir quand le niveau facile sera validé en vrai.
- Ces mesures portent sur des matchs en 3 jeux, pour avoir assez de points ; le jeu réel se
  joue en 1 jeu.
- `npm run sim` affiche aussi la jouabilité après la vitre par niveau (temps disponible, hauteur).

Ce robot n'est qu'une approximation : seul un test sur téléphone dira si le jeu est trop facile,
trop dur ou trop passif.
