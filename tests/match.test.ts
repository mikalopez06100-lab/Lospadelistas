import { describe, expect, it } from 'vitest';
import { playBotMatch } from '../scripts/bot';
import { COURT, createDefaultTuning } from '../src/core/constants';
import { createMatch, receiverFor, serviceBox, tickMatch, type MatchEvent } from '../src/core/play/match';
import { replay } from '../src/core/play/replay';

const tuning = createDefaultTuning();
// Format long du brief : 3 jeux gagnants, pour que les deux équipes servent.
tuning.match.gamesToWin = 3;

describe('match en double', () => {
  it('un match complet va à son terme : un vainqueur, score cohérent', () => {
    const { match, events } = playBotMatch(1, 'facile', 90, tuning, COURT, 20 * 60);
    expect(match.phase).toBe('over');
    const w = match.score.winner!;
    expect(match.score.games[w]).toBe(tuning.match.gamesToWin);
    expect(match.score.games[w === 0 ? 1 : 0]).toBeLessThan(tuning.match.gamesToWin);
    // Les quatre joueurs ont frappé, et chacun des deux camps a servi.
    const hitters = new Set(events.filter((e) => e.type === 'hit').map((e) => (e as { playerId: number }).playerId));
    expect([...hitters].sort()).toEqual([0, 1, 2, 3]);
    const servers = new Set(events.filter((e) => e.type === 'serve').map((e) => (e as { serverId: number }).serverId));
    expect(servers.size).toBeGreaterThanOrEqual(3);
  });

  it('même graine + mêmes entrées = même match (base des fantômes)', () => {
    const a = playBotMatch(7, 'moyen', 90, tuning, COURT, 4 * 60);
    const b = replay({ version: 2, seed: 7, aiLevel: 'moyen', tuning, inputs: a.inputs, ticks: a.match.tick }, COURT);
    expect(b.score).toEqual(a.match.score);
    expect(b.players.map((p) => p.pos)).toEqual(a.match.players.map((p) => p.pos));
    expect(b.ball?.pos).toEqual(a.match.ball?.pos);
  });

  it('service en diagonale : du côté droit au premier point, gauche au suivant', () => {
    const m = createMatch(3, 'facile', COURT, 3);
    expect(m.serveSide).toBe('right');
    // Tu sers de ta droite (x > 5) vers la droite adverse, qui est x < 5 vue depuis l'autre camp.
    expect(serviceBox(1, 'right', COURT)).toEqual({ xMin: 0, xMax: 5, yMin: 10, yMax: 16.95 });
    expect(receiverFor(m, COURT)).toBe(2);
    expect(m.players[0].pos.x).toBeGreaterThan(5);
  });

  it('sans aucun swipe, tu ne sers jamais : le match attend', () => {
    const m = createMatch(3, 'facile', COURT, 3);
    const events: MatchEvent[] = [];
    while (m.tick < 120 * 30) tickMatch(m, [], tuning, COURT, events);
    expect(m.phase).toBe('serve');
    expect(events.some((e) => e.type === 'serve')).toBe(false);
  });
});
