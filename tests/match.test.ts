import { describe, expect, it } from 'vitest';
import { Bot, playBotMatch } from '../scripts/bot';
import { COURT, FIXED_DT, createDefaultTuning } from '../src/core/constants';
import { createMatch, humanServeShot, receiverFor, serviceBox, tickMatch, type MatchEvent } from '../src/core/play/match';
import { predict } from '../src/core/physics/predict';
import { createBall } from '../src/core/physics/step';
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

  it('service en diagonale, depuis le couloir du serveur', () => {
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

    it('sans stick ni aide (niveau fort), tes joueurs ne bougent pas : la profondeur est ta décision', () => {
      const t = createDefaultTuning();
      t.play.assist = 0;
      const m = createMatch(4, 'fort', COURT, 3, 'duo');
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

  describe('aides selon le niveau', () => {
    const serveIntent = (aim: number) => ({ kind: 'drive' as const, power: 0.5, aim, swipeSpeed: 0, curvature: 0 });
    const lands = (level: 'facile' | 'fort', aim: number) => {
      const m = createMatch(1, level, COURT, 1, 'duo');
      const { origin, vel, box } = humanServeShot(m, serveIntent(aim), tuning, COURT);
      const first = predict(createBall(origin, vel), tuning.physics, COURT, FIXED_DT * tuning.physics.timeScale, 4).contacts[0];
      return first.surface === 'ground' && first.pos.x >= box.xMin && first.pos.x <= box.xMax && first.pos.y >= box.yMin && first.pos.y <= box.yMax;
    };

    it('en facile, un service mal visé retombe quand même dans le carré ; en fort, non', () => {
      expect(lands('facile', 0)).toBe(true);
      expect(lands('facile', 0.8)).toBe(true);
      expect(lands('facile', -0.8)).toBe(true);
      expect(lands('fort', 0)).toBe(true);
      expect(lands('fort', -0.8)).toBe(false);
    });

    it('en facile les adversaires ne smashent pas et ne montent pas au filet', () => {
      const t = createDefaultTuning();
      t.match.gamesToWin = 2;
      const { events, match } = playBotMatch(3, 'facile', 90, t, COURT, 20 * 60, 'duo', 'filet');
      const aiKinds = new Set(events.filter((e) => e.type === 'hit' && e.team === 1).map((e) => (e as { kind: string }).kind));
      expect(aiKinds.has('smash')).toBe(false);
      expect(aiKinds.has('drop')).toBe(false);
      for (const p of match.players.filter((p) => p.team === 1)) expect(p.home.y).toBeGreaterThan(COURT.netY + 5);
    });
  });

  it('Duo : sans stick, tes deux joueurs restent chacun de leur côté', () => {
    // Niveau facile = toutes les aides au placement actives : c'est le cas le plus exposé.
    const m = createMatch(12, 'facile', COURT, 3, 'duo');
    const bot = new Bot(5, 60);
    const events: MatchEvent[] = [];
    let closest = Infinity;
    while (m.tick < 120 * 90 && m.phase !== 'over') {
      // Le robot ne fait que frapper : aucun déplacement au stick, tout vient des aides.
      const inputs = bot.inputs(m, COURT, tuning).filter((i) => 'intent' in i);
      tickMatch(m, inputs, tuning, COURT, events);
      const left = m.players.find((p) => p.team === 0 && p.zone.xMin === 0)!;
      const right = m.players.find((p) => p.team === 0 && p.zone.xMin > 0)!;
      if (m.phase === 'rally') closest = Math.min(closest, right.pos.x - left.pos.x);
      expect(left.pos.x).toBeLessThanOrEqual(COURT.width / 2 + 0.8 + 1e-9);
      expect(right.pos.x).toBeGreaterThanOrEqual(COURT.width / 2 - 0.8 - 1e-9);
    }
    expect(closest).toBeGreaterThan(1);
  });

  it('personne ne change de côté de tout le match, même au service', () => {
    const t = createDefaultTuning();
    t.match.gamesToWin = 3;
    const m = createMatch(21, 'moyen', COURT, 3, 'duo');
    const bot = new Bot(8, 60);
    const events: MatchEvent[] = [];
    const servers = new Set<number>();
    const mid = COURT.width / 2;
    while (m.tick < 120 * 600 && m.phase !== 'over') {
      tickMatch(m, bot.inputs(m, COURT, t).filter((i) => 'intent' in i), t, COURT, events);
      if (m.phase === 'serve') {
        servers.add(m.serverId);
        // Au moment de servir, les quatre joueurs sont chacun dans leur moitié de largeur.
        for (const p of m.players) expect(p.pos.x >= p.zone.xMin && p.pos.x <= p.zone.xMax).toBe(true);
        // Et le service part bien en diagonale : le carré visé est de l'autre côté du serveur.
        const box = serviceBox(m.servingTeam === 0 ? 1 : 0, m.serveSide, COURT);
        expect(m.players[m.serverId].pos.x < mid).toBe(box.xMin >= mid);
      }
    }
    // Sur 3 jeux gagnants, plusieurs serveurs se sont succédé, des deux côtés du terrain.
    expect(servers.size).toBeGreaterThanOrEqual(3);
  });
});
