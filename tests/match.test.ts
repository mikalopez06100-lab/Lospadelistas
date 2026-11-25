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
    const b = replay({ version: 3, seed: 7, aiLevel: 'moyen', mode: 'solo', tuning, inputs: a.inputs, ticks: a.match.tick }, COURT);
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

  describe('mode Duo : tu diriges les deux joueurs', () => {
    it('un match complet va à son terme, et tes deux joueurs frappent', () => {
      const { match, events } = playBotMatch(2, 'facile', 90, tuning, COURT, 30 * 60, 'duo');
      expect(match.phase).toBe('over');
      const hitters = new Set(events.filter((e) => e.type === 'hit').map((e) => (e as { playerId: number }).playerId));
      expect(hitters.has(0) && hitters.has(1)).toBe(true);
    });

    it('rejeu exact avec les déplacements au stick', () => {
      const a = playBotMatch(9, 'moyen', 90, tuning, COURT, 3 * 60, 'duo', 'filet');
      expect(a.inputs.some((i) => 'stick' in i)).toBe(true);
      const b = replay({ version: 3, seed: 9, aiLevel: 'moyen', mode: 'duo', tuning, inputs: a.inputs, ticks: a.match.tick }, COURT);
      expect(b.score).toEqual(a.match.score);
      expect(b.players.map((p) => p.pos)).toEqual(a.match.players.map((p) => p.pos));
    });

    it('sans stick ni aide, tes joueurs ne bougent pas : la profondeur est ta décision', () => {
      const t = createDefaultTuning();
      t.play.assist = 0;
      const m = createMatch(4, 'facile', COURT, 3, 'duo');
      const before = m.players.slice(0, 2).map((p) => ({ ...p.pos }));
      const events: MatchEvent[] = [];
      // Un service, puis on laisse filer : aucun déplacement automatique.
      tickMatch(m, [{ tick: 0, playerId: 0, intent: { kind: 'drive', power: 0.5, aim: 0, swipeSpeed: 0, curvature: 0 } }], t, COURT, events);
      while (m.phase === 'rally') tickMatch(m, [], t, COURT, events);
      expect(m.players.slice(0, 2).map((p) => p.pos)).toEqual(before);
    });

    it('le stick déplace le joueur, borné à son camp', () => {
      const m = createMatch(4, 'facile', COURT, 3, 'duo');
      const events: MatchEvent[] = [];
      tickMatch(m, [{ tick: 0, playerId: 0, intent: { kind: 'drive', power: 0.5, aim: 0, swipeSpeed: 0, curvature: 0 } }], tuning, COURT, events);
      tickMatch(m, [{ tick: 1, playerId: 1, stick: { x: 0, y: 1 } }], tuning, COURT, events);
      const y0 = m.players[1].pos.y;
      for (let i = 0; i < 40; i++) tickMatch(m, [], tuning, COURT, events);
      expect(m.players[1].pos.y).toBeGreaterThan(y0 + 0.5);
      for (let i = 0; i < 120 && m.phase === 'rally'; i++) tickMatch(m, [], tuning, COURT, events);
      expect(m.players[1].pos.y).toBeLessThanOrEqual(COURT.netY - 0.8);
    });
  });
});
