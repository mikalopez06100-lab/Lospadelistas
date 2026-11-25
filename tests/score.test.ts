import { describe, expect, it } from 'vitest';
import { awardPoint, createScore, isGoldenPoint, pointsLabel } from '../src/core/rules/score';

describe('score', () => {
  it('0-15-30-40-jeu', () => {
    const s = createScore(3);
    expect(pointsLabel(s)).toBe('0 – 0');
    awardPoint(s, 0);
    awardPoint(s, 0);
    awardPoint(s, 1);
    expect(pointsLabel(s)).toBe('30 – 15');
    awardPoint(s, 0);
    expect(awardPoint(s, 0)).toEqual({ game: true, match: false });
    expect(s.games).toEqual([1, 0]);
    expect(s.points).toEqual([0, 0]);
  });

  it('point en or à 40-40 : le point suivant gagne le jeu, sans avantage', () => {
    const s = createScore(3);
    for (let i = 0; i < 3; i++) {
      awardPoint(s, 0);
      awardPoint(s, 1);
    }
    expect(isGoldenPoint(s)).toBe(true);
    expect(pointsLabel(s)).toBe('Point en or');
    expect(awardPoint(s, 1)).toEqual({ game: true, match: false });
    expect(s.games).toEqual([0, 1]);
  });

  it('match en 3 jeux gagnants, puis plus rien ne compte', () => {
    const s = createScore(3);
    let last = { game: false, match: false };
    for (let i = 0; i < 12; i++) last = awardPoint(s, 1);
    expect(last).toEqual({ game: true, match: true });
    expect(s.winner).toBe(1);
    expect(awardPoint(s, 0)).toEqual({ game: false, match: false });
    expect(s.games).toEqual([0, 3]);
  });

  it('le nombre de jeux gagnants est paramétrable', () => {
    const s = createScore(1);
    for (let i = 0; i < 4; i++) awardPoint(s, 0);
    expect(s.winner).toBe(0);
  });
});
