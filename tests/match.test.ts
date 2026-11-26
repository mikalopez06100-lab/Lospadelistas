import { describe, expect, it } from 'vitest';
import { Bot, playBotMatch } from '../scripts/bot';
import { COURT, FIXED_DT, STYLE, createDefaultTuning } from '../src/core/constants';
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

  it('Duo : sans stick, tes deux joueurs restent chacun de leur côté pendant l’échange', () => {
    // Niveau facile = toutes les aides au placement actives : c'est le cas le plus exposé.
    const m = createMatch(12, 'facile', COURT, 3, 'duo');
    const bot = new Bot(5, 60);
    const events: MatchEvent[] = [];
    let closest = Infinity;
    let rallyTicks = 0;
    while (m.tick < 120 * 90 && m.phase !== 'over') {
      // Le robot ne fait que frapper : aucun déplacement au stick, tout vient des aides.
      const inputs = bot.inputs(m, COURT, tuning).filter((i) => 'intent' in i);
      tickMatch(m, inputs, tuning, COURT, events);
      rallyTicks = m.phase === 'rally' ? rallyTicks + 1 : 0;
      // On laisse deux secondes au serveur pour regagner son côté quand il a servi en face.
      if (rallyTicks < 240) continue;
      const left = m.players.find((p) => p.team === 0 && p.zone.xMin === 0)!;
      const right = m.players.find((p) => p.team === 0 && p.zone.xMin > 0)!;
      closest = Math.min(closest, right.pos.x - left.pos.x);
      expect(left.pos.x).toBeLessThanOrEqual(COURT.width / 2 + 0.8 + 1e-9);
      expect(right.pos.x).toBeGreaterThanOrEqual(COURT.width / 2 - 0.8 - 1e-9);
    }
    expect(closest).toBeGreaterThan(1);
  });

  it('le serveur alterne droite / gauche, son partenaire ne change jamais de côté', () => {
    const t = createDefaultTuning();
    t.match.gamesToWin = 3;
    const m = createMatch(21, 'moyen', COURT, 3, 'duo');
    const bot = new Bot(8, 60);
    const events: MatchEvent[] = [];
    const sides = new Set<string>();
    const mid = COURT.width / 2;
    let rallyTicks = 0;
    while (m.tick < 120 * 600 && m.phase !== 'over') {
      tickMatch(m, bot.inputs(m, COURT, t).filter((i) => 'intent' in i), t, COURT, events);
      if (m.phase === 'serve') {
        rallyTicks = 0;
        sides.add(`${m.servingTeam}${m.serveSide}`);
        // Tout le monde est dans sa moitié, sauf éventuellement le serveur.
        for (const p of m.players) if (p.id !== m.serverId) expect(p.pos.x >= p.zone.xMin && p.pos.x <= p.zone.xMax).toBe(true);
        // Le service part en diagonale : le carré visé est de l'autre côté du serveur.
        const box = serviceBox(m.servingTeam === 0 ? 1 : 0, m.serveSide, COURT);
        expect(m.players[m.serverId].pos.x < mid).toBe(box.xMin >= mid);
      } else if (m.phase === 'rally' && ++rallyTicks === 120 * 2) {
        // Deux secondes après le service, tes deux joueurs sont de nouveau chacun de leur côté.
        for (const p of m.players) if (p.team === 0) expect(p.zone.xMin < mid ? p.pos.x < mid + 0.8 : p.pos.x > mid - 0.8).toBe(true);
      }
    }
    // Chaque équipe a servi des deux côtés.
    expect([...sides].sort()).toEqual(['0left', '0right', '1left', '1right']);
  });

  describe('smash, par 3 et par 4', () => {
    const smash = { kind: 'smash' as const, power: 1, aim: 0, swipeSpeed: 0, curvature: 0 };

    /** Place une balle haute au-dessus de Nico, près du filet, et le fait smasher. */
    function smashFrom(z: number, aim: number, seed = 1) {
      const m = createMatch(seed, 'fort', COURT, 1, 'duo');
      const events: MatchEvent[] = [];
      tickMatch(m, [{ tick: 0, playerId: 0, intent: { kind: 'drive', power: 0.5, aim: 0, swipeSpeed: 0, curvature: 0 } }], tuning, COURT, events);
      // Situation fabriquée : l'adversaire vient de jouer, la balle flotte au-dessus de Nico.
      const nico = m.players[0];
      nico.pos = { x: 7, y: 8 };
      m.ball = createBall({ x: 7, y: 8, z }, { x: 0, y: 0, z: 0 });
      m.rally.serve = null;
      m.rally.lastHitter = 1;
      m.rally.receiverBounces = 0;
      // Les adversaires sont écartés : on mesure le smash, pas leur défense.
      for (const p of m.players) if (p.team === 1) p.pos = { x: p.pos.x, y: 19.5 };
      events.length = 0;
      tickMatch(m, [{ tick: m.tick, playerId: 0, intent: { ...smash, aim } }], tuning, COURT, events);
      const hit = events.find((e) => e.type === 'hit') as Extract<MatchEvent, { type: 'hit' }> | undefined;
      const factor = m.bounceFactor;
      for (let i = 0; i < 120 * 6 && m.phase === 'rally'; i++) tickMatch(m, [], tuning, COURT, events);
      const point = events.find((e) => e.type === 'point') as Extract<MatchEvent, { type: 'point' }> | undefined;
      return { hit, factor, point };
    }

    it('balle trop basse : le smash devient un coup tendu', () => {
      expect(smashFrom(1.0, 0).hit?.kind).toBe('drive');
    });

    it('smash parfait près du filet : le rebond gicle ; plus bas, il est écrasé', () => {
      const perfect = smashFrom(2.3, 0);
      expect(perfect.hit?.kind).toBe('smash');
      expect(perfect.hit?.timing).toBe('parfait');
      expect(perfect.factor).toBeCloseTo(tuning.shot.smashKickMax, 6);
      // Balle smashable mais sous la hauteur du smash parfait : rebond écrasé.
      expect(smashFrom(1.7, 0).factor).toBe(tuning.shot.smashFlat);
    });

    it('un smash parfait à pleine puissance peut sortir la balle : par 3 ou par 4, avec le bonus de style', () => {
      const pars = new Set<number>();
      for (const aim of [-0.6, -0.3, 0, 0.3, 0.6]) {
        const { point } = smashFrom(2.3, aim);
        if (!point?.par) continue;
        pars.add(point.par);
        expect(point.result).toEqual({ winner: 0, reason: 'sortie-apres-rebond' });
        expect(point.style!.total).toBeGreaterThanOrEqual(point.par === 4 ? STYLE.par4 : STYLE.par3);
      }
      expect(pars.size).toBeGreaterThan(0);
    });
  });

  it('mode 1 pouce : tu diriges Nico au stick, Lola est jouée par l’IA', () => {
    const m = createMatch(6, 'facile', COURT, 1, 'solo');
    const [nico, lola] = m.players;
    expect(nico.manual).toBe(true);
    expect(lola.isHuman).toBe(false);
    const events: MatchEvent[] = [];
    const drive = { kind: 'drive' as const, power: 0.5, aim: 0, swipeSpeed: 0, curvature: 0 };
    tickMatch(m, [{ tick: 0, playerId: 0, intent: drive }], tuning, COURT, events);
    const y0 = nico.pos.y;
    tickMatch(m, [{ tick: 1, playerId: 0, stick: { x: 0, y: 1 } }], tuning, COURT, events);
    for (let i = 0; i < 60; i++) tickMatch(m, [], tuning, COURT, events);
    expect(nico.pos.y).toBeGreaterThan(y0 + 1);
    // Un stick adressé à Lola est ignoré : elle n'est pas à toi dans ce mode.
    const lolaBefore = { ...lola.pos };
    tickMatch(m, [{ tick: m.tick, playerId: 1, stick: { x: 1, y: 0 } }], tuning, COURT, events);
    expect(lola.stick).toBeNull();
    expect(Math.abs(lola.pos.x - lolaBefore.x)).toBeLessThan(0.2);
  });
});
