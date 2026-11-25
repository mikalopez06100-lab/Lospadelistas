import { describe, expect, it } from 'vitest';
import { playBotMatch } from '../scripts/bot';
import { COURT, STYLE, createDefaultTuning } from '../src/core/constants';
import { styleForPoint } from '../src/core/rules/style';

describe('score de style', () => {
  it('un point simple vaut la base plus la longueur de l’échange', () => {
    expect(styleForPoint({ shots: 4, perfects: 0, offGlass: 0, winnerGlass: 0 }).total).toBe(STYLE.point + 4 * STYLE.perShot);
  });

  it('un point gagné grâce aux vitres vaut nettement plus', () => {
    const plain = styleForPoint({ shots: 6, perfects: 1, offGlass: 0, winnerGlass: 0 });
    const glass = styleForPoint({ shots: 6, perfects: 1, offGlass: 1, winnerGlass: 2 });
    expect(glass.glass).toBe(2 * STYLE.glassWinner);
    expect(glass.total - plain.total).toBe(2 * STYLE.glassWinner + STYLE.offGlass);
  });

  it('les bonus sont plafonnés', () => {
    const g = styleForPoint({ shots: 500, perfects: 0, offGlass: 0, winnerGlass: 10 });
    expect(g.rally).toBe(STYLE.rallyMax);
    expect(g.glass).toBe(STYLE.glassWinnerMaxCount * STYLE.glassWinner);
  });

  it('sur un match : le style cumulé est la somme des points gagnés, jamais des points perdus', () => {
    const tuning = createDefaultTuning();
    tuning.match.gamesToWin = 2;
    const { match, events } = playBotMatch(5, 'facile', 60, tuning, COURT, 20 * 60);
    let sum = 0;
    for (const e of events) {
      if (e.type !== 'point') continue;
      if (e.result.winner === 1) expect(e.style).toBeNull();
      if (e.style) sum += e.style.total;
    }
    expect(sum).toBeGreaterThan(0);
    expect(match.style).toBe(sum);
  });
});
