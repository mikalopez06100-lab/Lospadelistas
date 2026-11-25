# Rebote

Jeu mobile de padel arcade, jouable d'une main, en sessions de 2 à 3 minutes.
Le cœur du jeu : **jouer avec les vitres**.

**État : prototype complet, avec deux modes de jeu.**

- **Duo (2 pouces, par défaut)** : tu diriges tes deux joueurs, un pouce chacun. Tu les montes
  au filet, tu volleyes, tu recules quand on te lobe, tu smashes. C'est la vraie logique du padel.
- **Classique (1 pouce)** : ton joueur se place tout seul, tu ne fais que frapper, avec un
  partenaire IA.

Dans les deux cas : match en double avec service, point en or, sons, vibrations, ralenti
« Rebote », score de style, et installation sur l'écran d'accueil du téléphone (PWA, hors ligne).

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
- Service : un swipe vers le haut, n'importe où sur l'écran et sans contrainte de vitesse.

### Mode Classique : match en double à un pouce

- **Les équipes** : toi (orange) à droite, ton partenaire IA (saumon) à gauche, contre deux IA
  (bleu). Chacun couvre sa moitié du terrain. Dans la bande centrale, la balle revient au plus
  rapide des deux. Avec le bouton Dbg, tu vois qui doit prendre la balle.
- **Service** : quand c'est à toi, « À toi de servir » s'affiche. Swipe vers le haut : un geste
  droit vise le centre du carré, la direction décale le point visé, la puissance règle la
  profondeur. Le service se fait en diagonale, à droite sur les points pairs et à gauche sur les
  points impairs. Faute → 2e balle, filet puis carré → let, deux fautes → point perdu. Après le
  rebond, la balle peut toucher la vitre mais pas le grillage.
- **Retour de service** : seul le receveur désigné peut jouer, et seulement après le rebond.
- **Pendant l'échange** : quand l'anneau vert s'allume sous ton joueur, swipe vers le haut. Le
  timing donne « Parfait ! », « Trop tôt » ou « Trop tard ». Un mauvais timing dégrade le coup,
  mais la balle part quand même. Un swipe fait jusqu'à 220 ms avant que la balle soit à portée
  est gardé en mémoire. Les balles de la moitié de ton partenaire, c'est lui qui les joue.
- **Score** : 15 – 30 – 40, point en or à 40-40 (pas d'avantage), puis jeu. Le service passe à
  l'autre équipe à chaque jeu, et alterne entre les deux joueurs d'une même équipe.
- **Format : 1 jeu par défaut**, réglable de 1 à 5 jeux dans ⚙ (section Jeu). Voir
  « Équilibrage » plus bas pour savoir pourquoi ce n'est pas 3.
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

- **Sons** : synthétisés en WebAudio, sans aucun fichier. Frappe, rebond au sol, vitre (le plus
  travaillé), grillage, filet, point gagné ou perdu, fin de match. Le son se coupe avec 🔊 ; le
  jeu reste entièrement jouable sans (tout a un retour visuel).
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
Les icônes sont générées par `python3 scripts/make-icons.py`.

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
| `view.camDistance` / `camHeight` | Inclinaison et force de la perspective. |
| `play.moveSpeed` / `play.reach` | Vitesse du placement automatique et portée de frappe : c'est ce qui rend un coup adverse imprenable ou non. |
| `play.maxTimingAimErrorDeg` / `maxTimingPowerError` | Pénalité d'un mauvais timing. |
| `AI_LEVELS` | Les trois niveaux d'IA (non réglables dans le panneau ⚙). |
| `match.gamesToWin` | Nombre de jeux gagnants pour le match (1 par défaut). |
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
    rules/score.ts        15-30-40, point en or, jeux, fin de match
    rules/style.ts        score de style d'un point
    play/positioning.ts   placement automatique : instants où la balle sera jouable
    play/match.ts         match en double : service, répartition des balles, frappes, IA
    play/replay.ts        enregistrement et rejeu d'un match (base des fantômes)
    rng.ts                aléatoire à graine (jamais Math.random dans core/)
    sandbox.ts            état du bac à sable (phase 0)
  render/      Canvas 2D : lit l'état sans jamais le modifier
    player.ts             joueurs dessinés en squelette 3D projeté : course, armé, frappe
  input/       touch.ts (un swipe, mode classique) et duoTouch.ts (deux pouces : stick + frappe)
  audio/       sons synthétisés (WebAudio) et vibrations
  app/         panneau de réglages
public/        manifest, service worker et icônes de la PWA
tests/         vitest
scripts/       joueur-robot et simulation d'équilibrage (npm run sim)
```

Choix techniques :

- **Canvas 2D sans moteur de jeu.** La physique 2D + hauteur est faite maison, donc Phaser
  n'apporterait guère plus qu'un 1 Mo de JS de plus. Le bundle actuel fait environ 10 Ko gzippé.
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
| Classique | moyen (120 ms) | 5 | 3 | 0 |
| Duo, reste au fond | bon | 6 | 6 | 2 |
| Duo, reste au fond | moyen | 2 | 0 | 0 |
| Duo, monte au filet | bon | 6 | 6 | 1 |
| Duo, monte au filet | moyen | 3 | 0 | 0 |

À lire avec prudence :

- **Le Duo est plus dur que le Classique** pour un joueur moyen, parce qu'il faut se placer.
- **Monter au filet ne rapporte pas encore nettement plus que rester au fond**, alors que c'est
  le cœur du padel. Soit le robot monte mal, soit le jeu ne récompense pas assez le filet. C'est
  le premier point à vérifier en jouant.
- **Un match en 3 jeux dure 8 à 12 minutes** (échange médian de 8 à 28 coups), d'où le format
  en 1 jeu par défaut.

Ce robot n'est qu'une approximation : seul un test sur téléphone dira si le jeu est trop facile,
trop dur ou trop passif.
