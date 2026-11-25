# Rebote

Jeu mobile de padel arcade, jouable d'une main, en sessions de 2 à 3 minutes.
Le cœur du jeu : **jouer avec les vitres**.

**État : phase 1, échange 1 contre 1 face à une IA.** Le placement est automatique et tu
frappes au swipe. Les fautes principales sont détectées. Le bac à sable de la phase 0
(physique seule) reste accessible avec le bouton « Échange / Bac à sable ».

Jouable en ligne : https://lospadelistas.vercel.app

## Lancer en local

Prérequis : Node 20 ou plus récent.

```bash
npm install
npm run dev        # serveur de dev, accessible sur le réseau local
npm test           # tests unitaires (physique, geste → coup, règles, échange, rejeu)
npm run sim        # équilibrage : 5 min simulées par niveau d'IA, stats des échanges
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

Limite à connaître : l'installation en PWA (phase 3) exige du HTTPS. Le réseau local suffit
pour jouer, pas pour tester l'installation : il faudra un déploiement de prévisualisation.

## Comment jouer

### Échange (phase 1)

- **Ton joueur se place tout seul**, à l'endroit où la balle sera jouable : de préférence
  après le rebond, à hauteur de hanche, éventuellement après la vitre.
- **Quand l'anneau vert apparaît sous ton joueur, swipe vers le haut** depuis la moitié basse
  de l'écran. La direction du geste donne la direction du coup, sa vitesse donne la puissance.
- **Timing** : swiper au bon moment donne « Parfait ! ». Trop tôt ou trop tard dégrade la
  direction et la puissance, mais la balle part quand même (pas de raté total en v1). Un swipe
  fait jusqu'à 220 ms avant que la balle soit à portée est gardé en mémoire.
- **Fautes détectées** : balle dans le filet, vitre adverse touchée sans rebond, balle dehors
  avant le rebond, double rebond, balle retombée dans son propre camp.
- **IA : facile / moyen / fort** : temps de réaction, vitesse, précision, jeu vers le côté
  libre, taux de fautes directes. Les paramètres sont dans `AI_LEVELS` (`src/core/constants.ts`).

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
    rules/rally.ts        règles de l'échange : fautes, double rebond, sorties
    play/positioning.ts   placement automatique : instants où la balle sera jouable
    play/game.ts          échange 1 contre 1 : boucle de jeu, frappes, IA
    play/replay.ts        enregistrement et rejeu d'une partie (base des fantômes)
    rng.ts                aléatoire à graine (jamais Math.random dans core/)
    sandbox.ts            état du bac à sable (phase 0)
  render/      Canvas 2D : lit l'état sans jamais le modifier
  input/       Pointer Events → swipes horodatés
  app/         panneau de réglages
tests/         vitest
scripts/       simulation d'équilibrage (npm run sim)
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
