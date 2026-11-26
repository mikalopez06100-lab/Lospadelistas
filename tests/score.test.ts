import { describe, expect, it } from 'vitest';
import { awardPoint, createScore, isDeuce, pointLabels } from '../src/core/rules/score';

describe('score', () => {
  it('0-15-30-40-jeu', () => {
    const s = createScore(3);
    expect(pointLabels(s)).toEqual(['0', '0']);
    awardPoint(s, 0);
    awardPoint(s, 0);
    awardPoint(s, 1);
    expect(pointLabels(s)).toEqual(['30', '15']);
    awardPoint(s, 0);
    expect(pointLabels(s)).toEqual(['40', '15']);
    expect(awardPoint(s, 0)).toEqual({ game: true, match: false });
    expect(s.games).toEqual([1, 0]);
    expect(s.points).toEqual([0, 0]);
  });

  it('à 40-40 : égalité, puis avantage, et il faut deux points d’écart', () => {
    const s = createScore(1);
    for (let i = 0; i < 3; i++) {
      awardPoint(s, 0);
      awardPoint(s, 1);
    }
    expect(isDeuce(s)).toBe(true);
    expect(pointLabels(s)).toEqual(['40', '40']);
    expect(awardPoint(s, 1)).toEqual({ game: false, match: false });
    expect(pointLabels(s)).toEqual(['40', 'AV']);
    // L'avantage est perdu : retour à l'égalité.
    awardPoint(s, 0);
    expect(isDeuce(s)).toBe(true);
    expect(pointLabels(s)).toEqual(['40', '40']);
    awardPoint(s, 0);
    expect(pointLabels(s)).toEqual(['AV', '40']);
    expect(awardPoint(s, 0)).toEqual({ game: true, match: true });
    expect(s.winner).toBe(0);
  });

  it('le match en 1 jeu se termine au premier jeu gagné, puis plus rien ne compte', () => {
    const s = createScore(1);
    let last = { game: false, match: false };
    for (let i = 0; i < 4; i++) last = awardPoint(s, 1);
    expect(last).toEqual({ game: true, match: true });
    expect(s.winner).toBe(1);
    expect(awardPoint(s, 0)).toEqual({ game: false, match: false });
    expect(s.games).toEqual([0, 1]);
  });

  it('plusieurs jeux gagnants restent possibles (tests et simulation)', () => {
    const s = createScore(3);
    for (let i = 0; i < 12; i++) awardPoint(s, 1);
    expect(s.winner).toBe(1);
    expect(s.games).toEqual([0, 3]);
  });
});
