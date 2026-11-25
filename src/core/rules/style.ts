import { STYLE } from '../constants';

/**
 * Score de style : il récompense la manière, pas seulement le résultat. Il n'est attribué
 * que sur les points gagnés par ton équipe (hors fautes de service adverses).
 */
export interface StyleInput {
  /** Frappes de l'échange, service compris. */
  shots: number;
  /** Tes frappes au timing « Parfait » pendant l'échange. */
  perfects: number;
  /** Tes frappes jouées en sortie de vitre. */
  offGlass: number;
  /** Vitres touchées dans le camp adverse par le coup gagnant, après son rebond. */
  winnerGlass: number;
}

export interface StyleGain {
  total: number;
  base: number;
  rally: number;
  timing: number;
  offGlass: number;
  glass: number;
}

export function styleForPoint(i: StyleInput): StyleGain {
  const base = STYLE.point;
  const rally = Math.min(STYLE.rallyMax, i.shots * STYLE.perShot);
  const timing = i.perfects * STYLE.perfect;
  const offGlass = i.offGlass * STYLE.offGlass;
  const glass = Math.min(i.winnerGlass, STYLE.glassWinnerMaxCount) * STYLE.glassWinner;
  return { total: base + rally + timing + offGlass + glass, base, rally, timing, offGlass, glass };
}
