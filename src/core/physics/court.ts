import type { CourtGeometry } from '../constants';

export type WallSurface = 'glass' | 'fence';

/** Hauteur du filet à l'abscisse x : 0,88 m au centre, 0,92 m aux poteaux, linéaire entre les deux. */
export function netHeightAt(court: CourtGeometry, x: number): number {
  const half = court.width / 2;
  const t = Math.min(1, Math.abs(x - half) / half);
  return court.netHeightCenter + (court.netHeightPost - court.netHeightCenter) * t;
}

/** Ce que la balle rencontre sur une paroi latérale au point (y, z) ; null = elle passe par-dessus. */
export function sideWallSurface(court: CourtGeometry, y: number, z: number): WallSurface | null {
  if (y < 0 || y > court.length) return null;
  const isGlass = y <= court.sideGlassDepth || y >= court.length - court.sideGlassDepth;
  if (isGlass) return z <= court.sideGlassHeight ? 'glass' : null;
  return z <= court.fenceHeight ? 'fence' : null;
}

/** Vitre de fond : toute la largeur, jusqu'à backGlassHeight. Au-dessus, la balle sort (v1). */
export function backWallSurface(court: CourtGeometry, x: number, z: number): WallSurface | null {
  if (x < 0 || x > court.width) return null;
  return z <= court.backGlassHeight ? 'glass' : null;
}

export function isInsideEnclosure(court: CourtGeometry, x: number, y: number): boolean {
  return x >= 0 && x <= court.width && y >= 0 && y <= court.length;
}
