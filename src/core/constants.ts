/**
 * Rebote — constantes centralisées. C'EST LE FICHIER À TUNER.
 *
 * Unités : mètres, secondes, m/s.
 * Repère : origine au coin gauche du fond de court du joueur humain (bas de l'écran).
 *   x ∈ [0, 10]  largeur (gauche → droite)
 *   y ∈ [0, 20]  longueur (le joueur en y = 0, l'adversaire en y = 20)
 *   z ≥ 0        hauteur
 *
 * En jeu, le panneau ⚙ modifie une copie de ces valeurs à chaud ;
 * son bouton « Copier JSON » donne les valeurs à recopier ici.
 */

/** Pas de simulation fixe (temps réel). La physique avance de FIXED_DT × timeScale. */
export const FIXED_DT = 1 / 120;

export interface CourtGeometry {
  width: number;
  length: number;
  netY: number;
  netHeightCenter: number;
  netHeightPost: number;
  /** Vitre de fond, sur toute la largeur. */
  backGlassHeight: number;
  /** Hauteur totale de la paroi de fond : vitre + grillage au-dessus. Par-dessus, c'est le « par 4 ». */
  backWallHeight: number;
  /** Profondeur des vitres latérales mesurée depuis chaque fond. */
  sideGlassDepth: number;
  sideGlassHeight: number;
  /** Grillage latéral (entre les vitres latérales). */
  fenceHeight: number;
  /** Distance ligne de service ↔ filet. */
  serviceLineFromNet: number;
}

export const COURT: CourtGeometry = {
  width: 10,
  length: 20,
  netY: 10,
  netHeightCenter: 0.88,
  netHeightPost: 0.92,
  backGlassHeight: 3,
  backWallHeight: 4,
  sideGlassDepth: 4,
  sideGlassHeight: 3,
  fenceHeight: 3,
  serviceLineFromNet: 6.95,
};

/** Comportement d'une surface au rebond. */
export interface Material {
  /** Part de la vitesse normale conservée (0 = colle, 1 = parfaitement élastique). */
  restitution: number;
  /** Part de la vitesse tangentielle conservée (frottement). */
  tangentialKeep: number;
}

export interface PhysicsParams {
  /** m/s². */
  gravity: number;
  /** Ralenti global : 1 = vitesse réelle. Un vrai échange de padel est trop rapide pour un écran de téléphone. */
  timeScale: number;
  /** Freinage de l'air, linéaire, en 1/s. Linéaire plutôt que quadratique : plus prévisible. */
  airDrag: number;
  /** Rayon physique de la balle (m). */
  ballRadius: number;
  ground: Material;
  glass: Material;
  fence: Material;
  net: Material;
  /** Sous cette vitesse verticale après rebond (m/s), la balle roule au lieu de rebondir. */
  rollThreshold: number;
  /** Freinage au roulement, en 1/s. */
  rollFriction: number;
  /** Sous cette vitesse (m/s), une balle qui roule s'arrête. */
  stopSpeed: number;
}

export const DEFAULT_PHYSICS: PhysicsParams = {
  gravity: 9.81,
  timeScale: 0.75,
  airDrag: 0.25,
  ballRadius: 0.033,
  // Balle de padel lâchée de 2,54 m : remonte à ~1,40 m → restitution ≈ 0,74.
  ground: { restitution: 0.8, tangentialKeep: 0.8 },
  glass: { restitution: 0.78, tangentialKeep: 0.85 },
  // Grillage : rebond mou. En v1 il est déterministe (pas d'aléa).
  fence: { restitution: 0.25, tangentialKeep: 0.5 },
  net: { restitution: 0.1, tangentialKeep: 0.3 },
  rollThreshold: 0.8,
  rollFriction: 1.5,
  stopSpeed: 0.15,
};

export type LobMode = 'speed' | 'hook';

export interface ShotParams {
  /**
   * Option de contrôle du lob :
   *  - 'speed' : swipe lent = lob, swipe rapide = coup tendu
   *  - 'hook'  : swipe courbé (crochet) = lob, swipe droit = coup tendu
   */
  lobMode: LobMode;
  /** Longueur minimale d'un swipe, en fraction de la hauteur d'écran. */
  minSwipeLength: number;
  /** Vitesse de swipe (hauteurs d'écran / s) correspondant à puissance 0 et puissance 1. */
  minSwipeSpeed: number;
  maxSwipeSpeed: number;
  /** Fenêtre (ms) de fin de geste utilisée pour mesurer la vitesse de lâcher. */
  releaseWindowMs: number;
  driveMinSpeed: number;
  driveMaxSpeed: number;
  /** Angle de départ minimum d'un coup tendu ; il est relevé automatiquement pour passer le filet. */
  driveMinElevationDeg: number;
  driveMaxElevationDeg: number;
  /** Marge visée au-dessus du filet pour les coups tendus (m). */
  netClearance: number;
  /** Mode 'speed' : sous ce seuil de puissance (0–1), le coup devient un lob. */
  lobThreshold: number;
  lobMinSpeed: number;
  lobMaxSpeed: number;
  lobElevationDeg: number;
  /** Volée amortie (IA) : vitesses et angle minimum. */
  dropMinSpeed: number;
  dropMaxSpeed: number;
  dropElevationDeg: number;
  /** Smash : vitesses, angle plongeant maximum (°) et marge au-dessus du filet (m). */
  smashMinSpeed: number;
  smashMaxSpeed: number;
  smashMaxDownDeg: number;
  smashNetClearance: number;
  /**
   * Rebond d'un smash chez l'adversaire : la vitesse verticale du premier rebond est multipliée
   * par un facteur. Smash ordinaire : `smashFlat` (rebond écrasé, la balle reste dans le court).
   * Smash parfait : de `smashKickMin` (puissance 0) à `smashKickMax` (puissance 1) ; le rebond
   * gicle, et c'est ce qui sort la balle : par 3 le plus souvent, par 4 seulement à pleine puissance.
   */
  smashFlat: number;
  smashKickMin: number;
  smashKickMax: number;
  /** Mode Duo : longueur du geste (fraction de la hauteur d'écran) à partir de laquelle il est « long ». */
  longSwipe: number;
  /** Mode 'hook' : courbure (écart max à la corde / longueur) au-delà de laquelle c'est un lob. */
  hookCurvature: number;
  /** Angle latéral maximum du coup. */
  maxAimDeg: number;
  /** Amplification de l'angle latéral du swipe (le pouce swipe surtout vers le haut). */
  aimGain: number;
  /** Hauteur de frappe (m). */
  contactHeight: number;
  /** Profondeur à laquelle se tient le joueur en phase 0 (m). */
  playerDepth: number;
}

export const DEFAULT_SHOT: ShotParams = {
  lobMode: 'speed',
  minSwipeLength: 0.04,
  minSwipeSpeed: 0.6,
  maxSwipeSpeed: 3.5,
  releaseWindowMs: 100,
  driveMinSpeed: 14,
  driveMaxSpeed: 25,
  driveMinElevationDeg: 2,
  driveMaxElevationDeg: 30,
  netClearance: 0.35,
  lobThreshold: 0.3,
  lobMinSpeed: 11,
  lobMaxSpeed: 14.5,
  lobElevationDeg: 40,
  dropMinSpeed: 5,
  dropMaxSpeed: 11,
  dropElevationDeg: 12,
  smashMinSpeed: 20,
  smashMaxSpeed: 29,
  smashMaxDownDeg: 30,
  smashNetClearance: 0.15,
  smashFlat: 0.72,
  smashKickMin: 0.9,
  smashKickMax: 1.12,
  longSwipe: 0.2,
  hookCurvature: 0.12,
  maxAimDeg: 50,
  aimGain: 1.3,
  contactHeight: 1.0,
  playerDepth: 1.5,
};

export interface PlayParams {
  /** Portée de frappe autour du joueur, au sol (m). */
  reach: number;
  /** Hauteurs de frappe possibles (m). */
  minContactZ: number;
  maxContactZ: number;
  /** Hauteur de frappe idéale (m) : le placement automatique la recherche. */
  idealContactZ: number;
  /** Vitesse de déplacement automatique du joueur (m/s, temps physique). */
  moveSpeed: number;
  /** Un swipe fait un peu avant que la balle soit à portée est gardé en mémoire (ms). */
  swipeBufferMs: number;
  /** Erreur de direction maximale pour une frappe au pire timing (°). */
  maxTimingAimErrorDeg: number;
  /** Erreur de puissance maximale pour une frappe au pire timing (fraction). */
  maxTimingPowerError: number;
  /** Pénalité de choix pour une volée (le placement préfère jouer après le rebond). */
  volleyPenalty: number;
  /** Mode Duo : hauteur maximale d'une balle jouable au-dessus de la tête (m). */
  overheadZ: number;
  /** Mode Duo : hauteur minimale de la balle pour smasher ; plus bas, le geste donne un coup tendu rasant. */
  smashMinZ: number;
  /** Smash « parfait » (celui qui peut sortir la balle) : hauteur de balle minimale et distance maximale au filet (m). */
  kickMinZ: number;
  /** Hauteur de frappe idéale d'un smash (m) : c'est par rapport à elle qu'il est « Parfait ». */
  smashIdealZ: number;
  kickMaxNetDistance: number;
  /**
   * Mode Duo : aide latérale. Un joueur que tu ne touches pas se décale tout seul vers la balle,
   * en largeur seulement, à cette fraction de sa vitesse (0 = aucune aide). La profondeur
   * (monter au filet, reculer) reste toujours ta décision.
   */
  assist: number;
  /** Mode Duo : vitesse de tes joueurs au stick (m/s, temps physique). */
  duoMoveSpeed: number;
}

export const DEFAULT_PLAY: PlayParams = {
  reach: 1.3,
  minContactZ: 0.2,
  maxContactZ: 2.2,
  idealContactZ: 1.0,
  moveSpeed: 4.5,
  swipeBufferMs: 220,
  maxTimingAimErrorDeg: 14,
  maxTimingPowerError: 0.25,
  volleyPenalty: 0.8,
  overheadZ: 2.7,
  smashMinZ: 1.6,
  kickMinZ: 1.9,
  smashIdealZ: 2.3,
  kickMaxNetDistance: 4.5,
  assist: 0.7,
  duoMoveSpeed: 6.5,
};

export type AiLevel = 'facile' | 'moyen' | 'fort';

export interface AiParams {
  /** Temps avant que l'IA réagisse à un coup (s, temps physique). */
  reaction: number;
  moveSpeed: number;
  /** Écart type de l'erreur sur le point visé (m). */
  aimError: number;
  /** Probabilité de jouer un lob. */
  lobChance: number;
  /** Puissance visée : profondeur du point de chute dans le camp adverse (m depuis le filet). */
  minDepth: number;
  maxDepth: number;
  /** Probabilité de faute directe (coup trop long ou trop large) à chaque frappe. */
  errorChance: number;
  /** Probabilité de viser le côté opposé au joueur (le « terrain ouvert »). */
  openCourtBias: number;
  /** Position d'attente : distance depuis la vitre de fond (m). Plus grand = plus près du filet, plus de volées. */
  homeDepth: number;
  /** Réticence à jouer de volée (même échelle que play.volleyPenalty). */
  volleyPenalty: number;
  /** Écart type de l'erreur de service (m) : au-delà du carré, c'est la faute. */
  serveError: number;
  /** Au filet : probabilité de jouer une volée amortie ou un smash (les coups qui concluent). 0 = jamais. */
  attackChance: number;
  /** Duo : probabilité de monter au filet quand l'occasion se présente. 0 = reste au fond. */
  netChance: number;
  /**
   * Marge supplémentaire au-dessus du filet pour ses coups tendus (m). Plus elle est grande, plus
   * la balle est bombée : elle rebondit plus haut et laisse plus de temps, y compris après la vitre.
   */
  loft: number;
}

export const AI_LEVELS: Record<AiLevel, AiParams> = {
  // Facile = pour apprendre : adversaires lents, qui jouent sur toi, ratent souvent, n'attaquent pas et restent au fond.
  facile: { reaction: 0.45, moveSpeed: 3.0, aimError: 1.4, lobChance: 0.1, minDepth: 3.5, maxDepth: 6.5, errorChance: 0.2, openCourtBias: 0.1, homeDepth: 3, volleyPenalty: 0.8, serveError: 0.7, attackChance: 0, netChance: 0, loft: 1.1 },
  moyen: { reaction: 0.25, moveSpeed: 4.2, aimError: 0.9, lobChance: 0.15, minDepth: 5, maxDepth: 8.5, errorChance: 0.08, openCourtBias: 0.5, homeDepth: 4, volleyPenalty: 0.5, serveError: 0.6, attackChance: 0.35, netChance: 0.65, loft: 0.4 },
  fort: { reaction: 0.15, moveSpeed: 4.8, aimError: 0.5, lobChance: 0.2, minDepth: 6, maxDepth: 9.3, errorChance: 0.05, openCourtBias: 0.75, homeDepth: 5.5, volleyPenalty: 0.2, serveError: 0.45, attackChance: 0.55, netChance: 0.85, loft: 0 },
};

/** Barème du score de style (points gagnés par ton équipe uniquement). */
export const STYLE = {
  /** Point gagné. */
  point: 100,
  /** Par frappe de l'échange, plafonné à rallyMax. */
  perShot: 5,
  rallyMax: 100,
  /** Par frappe « Parfait » de ta part. */
  perfect: 20,
  /** Par balle que tu joues en sortie de vitre. */
  offGlass: 50,
  /** Par vitre touchée par le coup gagnant après son rebond (le cœur du jeu). */
  glassWinner: 150,
  glassWinnerMaxCount: 3,
  /** À partir de ce nombre de vitres, le coup gagnant déclenche le ralenti « Rebote ». */
  slowMoGlassCount: 2,
  /** Smash qui sort par-dessus une paroi latérale (3 m) ou par-dessus le fond (4 m). */
  par3: 400,
  par4: 800,
};

/**
 * Aides au joueur selon le niveau choisi : le niveau règle la force des adversaires ET le
 * confort de jeu. Facile = toutes les aides, fort = aucune.
 */
export interface Aids {
  /** Le service retombe toujours dans le carré : le point visé y est ramené. */
  serveInBox: boolean;
  /** Duo : sur une balle à jouer après ta vitre, le joueur concerné va se placer tout seul. */
  glassAutoPlace: boolean;
  /** Duo : sur une balle sortie de ta vitre, un geste vers le haut donne toujours un lob propre. */
  glassSafeLob: boolean;
  /** Duo : portée de frappe supplémentaire sur une balle sortie de ta vitre (m). */
  glassReachBonus: number;
}

export const AIDS: Record<AiLevel, Aids> = {
  facile: { serveInBox: true, glassAutoPlace: true, glassSafeLob: true, glassReachBonus: 0.4 },
  moyen: { serveInBox: false, glassAutoPlace: true, glassSafeLob: false, glassReachBonus: 0.2 },
  fort: { serveInBox: false, glassAutoPlace: false, glassSafeLob: false, glassReachBonus: 0 },
};

/** Niveau de l'IA partenaire (fixe : un partenaire correct, ni boulet ni sauveur). */
export const PARTNER_LEVEL: AiLevel = 'moyen';

export interface MatchParams {
  /** Nombre de jeux gagnants pour le match. Le jeu se joue en 1 jeu (avec égalité et avantage). */
  gamesToWin: number;
}

export const DEFAULT_MATCH: MatchParams = { gamesToWin: 1 };

export interface Tuning {
  physics: PhysicsParams;
  shot: ShotParams;
  play: PlayParams;
  match: MatchParams;
}

export function createDefaultTuning(): Tuning {
  return structuredClone({
    physics: DEFAULT_PHYSICS,
    shot: DEFAULT_SHOT,
    play: DEFAULT_PLAY,
    match: DEFAULT_MATCH,
  });
}
