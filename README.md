# Rebote

Jeu mobile de padel arcade, jouable d'une main, en sessions de 2 à 3 minutes.
Le cœur du jeu : **jouer avec les vitres**.

**État : phase 0, bac à sable physique.** Tu lances la balle au swipe et tu regardes les rebonds.
Pas encore de règles ni d'IA.

## Lancer en local

Prérequis : Node 20 ou plus récent.

```bash
npm install
npm run dev        # serveur de dev, accessible sur le réseau local
npm test           # tests unitaires (physique, geste → coup)
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

## Comment jouer (phase 0)

- **Swipe vers le haut en partant de la moitié basse de l'écran.** Le joueur se place là où ton
  doigt démarre, la direction du swipe donne la direction du coup, sa vitesse donne la puissance.
- **Lob** : deux modes à comparer, le bouton « Lob » bascule de l'un à l'autre.
  - *Lob : lent* : un swipe lent donne un lob, un swipe rapide un coup tendu.
  - *Lob : crochet* : un swipe courbé donne un lob, un swipe droit un coup tendu.
- **↺ Rejouer** relance exactement le dernier coup. C'est l'outil pour comparer avant/après un réglage.
- **Debug** affiche la trajectoire prévue (jaune), l'aperçu du coup pendant le geste (orange),
  les impacts prévus (○ sol, ✕ vitre), les vitesses et les mesures du geste.

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
    sandbox.ts            état du bac à sable (phase 0)
  render/      Canvas 2D : lit l'état sans jamais le modifier
  input/       Pointer Events → swipes horodatés
  app/         panneau de réglages
tests/         vitest
```

Choix techniques :

- **Canvas 2D sans moteur de jeu.** La physique 2D + hauteur est faite maison, donc Phaser
  n'apporterait guère plus qu'un 1 Mo de JS de plus. Le bundle actuel fait environ 10 Ko gzippé.
- **Pas fixe de 120 Hz.** Le rendu suit la fréquence de l'écran et interpole entre deux pas. La
  simulation ne dépend donc pas du framerate, ce qu'il faudra pour rejouer des « fantômes ».
- **Collisions analytiques.** Toutes les surfaces sont des plans alignés sur les axes, donc
  l'instant d'impact est calculé exactement. Pas d'effet tunnel, et les coins (deux vitres dans le
  même pas) sont gérés.
- **Aide au tir sur les coups tendus.** Le jeu choisit le plus petit angle qui passe le filet avec
  la marge `netClearance`. Le joueur ne choisit que la direction et la puissance.
