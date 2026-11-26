# Brief Claude Code — Refonte rétro « PÁDEL 86 »

Repo : `mikalopez06100-lab/Lospadelistas` (déployé sur lospadelistas.vercel.app).
Objectif : habiller le prototype « Rebote » dans l'univers **PÁDEL 86** (pixel art 16 couleurs, arcade 1986) **sans toucher à la physique ni aux contrôles** (mode Duo, Classique, aides par niveau, vitres).
Référence visuelle complète : `padel86-bible-univers.html`.

## 0. Avant de coder
- Lis le code existant et liste où sont dessinés le terrain, les joueurs, la balle, le HUD et les menus (canvas ? DOM ?). Propose le plan d'intégration avant de modifier.
- Travaille sur une branche `design/padel86`, pas sur `main` (chaque push sur `main` déploie en production sur Vercel).

## 1. Assets à copier dans `/public/padel86/`
| Fichier | Usage |
|---|---|
| `padel86-sprites-1x.png` + `padel86-sprites.json` | Planche 16×24. Lignes : lola, nico, gunther, brigitte, paco, pepa, toro, reina. Colonnes : idle, run1, run2, swing, low, back |
| `padel86-affiche-1x.png` / `padel86-titre-noblink-1x.png` | Écran titre (alterner les deux toutes les 500 ms = PRESS START qui clignote) |
| `padel86-affiche.png` | Version 1080×1920 : splash PWA, store, réseaux |
| `padel86-ecran-jeu-1x.png`, `padel86-ecran-menu-1x.png` | Maquettes cibles (référence, pas des assets runtime) |
| `padel86-theme.mp3` | Musique en boucle (titre, menu, match à −6 dB) |
| `sfx/*.mp3` | coin, hit, vitre, smash, point, faute, victoire, defaite |
| `tools/*.py` | Générateurs Python (palette, police, sprites, affiche, musique) pour régénérer après modification |

## 2. Rendu
- Résolution logique **180×320**. Rendre dans un canvas offscreen 180×320 puis l'agrandir à l'échelle entière max qui tient à l'écran (`Math.floor`), centré, bandes « Nuit » autour.
- `ctx.imageSmoothingEnabled = false` + CSS `image-rendering: pixelated`.
- Si la physique est en mètres ou en pixels écran : ne change que la projection, pas la simulation. Terrain 10×20 m → 120×240 px logiques (1 m = 12 px), comme dans la maquette en jeu.
- Palette stricte (variables CSS ci-dessous). Aucun dégradé lisse, aucune ombre floue.

```css
:root {
  --p86-nuit:#0b1622; --p86-bleu-nuit:#1d2b53; --p86-bleu-pista:#2a5bd7; --p86-cyan-neon:#29e0ff;
  --p86-rose-pop:#ff3d8b; --p86-violet:#8f3bd9; --p86-jaune-balle:#ffd23f; --p86-orange-sunset:#ff8a1f;
  --p86-rouge:#e8323c; --p86-vert:#3ec46d; --p86-creme:#fff4e0; --p86-peau-claire:#f6c08f;
  --p86-peau-mate:#c27a4c; --p86-chatain:#7a4128; --p86-acier:#8a94a6; --p86-brun:#2b1810;
}
```

## 3. Joueurs
- Ta paire (en bas, vue de dos) : Lola (gauche) + Nico (droite) → colonne `back` au repos, `run1/run2` en déplacement (8 i/s), `swing` pour frappe haute/smash, `low` pour volée/coup bas.
- Adversaires (en haut, de face) selon le niveau :
  - Facile → **Los Guiris** : Günther + Brigitte
  - Moyen → **Los Primos** : Paco + Pepa
  - Fort → **Los Reyes** : El Toro + La Reina
- Ombre tramée sous chaque joueur (damier 1 px), balle jaune 4 px + ombre au sol qui matérialise la hauteur.

## 4. Ressenti des coups
- Smash : arrêt de 60 ms + secousse d'écran de 2 px pendant 120 ms + son `smash`.
- Rebond vitre : flash blanc d'une image sur le segment de vitre touché + texte « VITRE ! » (jaune, contour nuit) qui apparaît puis disparaît en 400 ms + son `vitre`.
- Frappe : son `hit`. Point : `point` / `faute`. Fin de match : couper le thème, `victoire` / `defaite`.

## 5. Interface
- Renommer « Rebote » en **PÁDEL 86** (titre, manifest PWA, `<title>`, icônes). Slogan conservé : « JOUE AVEC LES VITRES ! ».
- Menu : mêmes options qu'aujourd'hui, en boutons pixel (fond nuit, bordure 1 px, option active en rose pop avec ombre violette décalée de 2 px). Les niveaux affichent les noms des paires + leurs sprites ×2.
- HUD : cadre cyan, ombre violette, noms des paires, jeux / points, chrono, badge DUO/CLASSIQUE.
- Police UI : `Press Start 2P` (Google Fonts, OFL). Tailles multiples de 8 px seulement.
- Audio iOS : démarrer le thème au premier toucher (« PRESS START »), jamais en autoplay.
- `theme-color` inchangé (#0b1622).

## 6. Critères de fin
- [ ] Aucune régression de gameplay (tester Duo + Classique, 3 niveaux, sandbox).
- [ ] Rendu net sans flou sur iPhone (DPR 3) et Android.
- [ ] 60 i/s tenus sur un iPhone de 3 ans.
- [ ] Toutes les couleurs à l'écran appartiennent à la palette.
- [ ] Le son se coupe avec le bouton 🔊 existant et ce réglage est mémorisé.
- [ ] Déploiement de preview Vercel sur la branche, pas en production.
