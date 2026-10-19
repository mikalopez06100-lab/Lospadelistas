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
  ground: { restitution: 0.75, tangentialKeep: 0.8 },
  glass: { restitution: 0.7, tangentialKeep: 0.85 },
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
  driveMaxSpeed: 28,
  driveMinElevationDeg: 2,
  driveMaxElevationDeg: 30,
  netClearance: 0.35,
  lobThreshold: 0.3,
  lobMinSpeed: 11,
  lobMaxSpeed: 14.5,
  lobElevationDeg: 40,
  hookCurvature: 0.12,
  maxAimDeg: 50,
  aimGain: 1.3,
  contactHeight: 1.0,
  playerDepth: 1.5,
};

export interface ViewParams {
  /** Recul de la caméra derrière le fond de court (m). Plus grand = perspective plus plate. */
  camDistance: number;
  /** Hauteur de la caméra (m). Plus grand = vue plus « de dessus ». */
  camHeight: number;
  /** Rayon visuel de la balle (m) — volontairement exagéré pour la lisibilité. */
  ballVisualRadius: number;
  /** Grossissement de la balle par mètre de hauteur. */
  heightSizeGain: number;
  /** Décalage de l'ombre par mètre de hauteur (lumière oblique). */
  shadowOffsetX: number;
  shadowOffsetY: number;
}

export const DEFAULT_VIEW: ViewParams = {
  camDistance: 50,
  camHeight: 50,
  ballVisualRadius: 0.11,
  heightSizeGain: 0.12,
  shadowOffsetX: 0.15,
  shadowOffsetY: 0.1,
};

export interface Tuning {
  physics: PhysicsParams;
  shot: ShotParams;
  view: ViewParams;
}

export function createDefaultTuning(): Tuning {
  return structuredClone({ physics: DEFAULT_PHYSICS, shot: DEFAULT_SHOT, view: DEFAULT_VIEW });
}
