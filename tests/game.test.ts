import { describe, expect, it } from 'vitest';
import { COURT, createDefaultTuning, type AiLevel } from '../src/core/constants';
import { createGame, tickGame, type GameEvent, type GameInput } from '../src/core/play/game';
import { replay } from '../src/core/play/replay';
import { createRng, gaussian } from '../src/core/rng';

const tuning = createDefaultTuning();

/**
 * Joueur-robot : il connaît l'instant de frappe idéal mais swipe avec une erreur de timing
 * aléatoire (σ = 90 ms), comme un joueur correct. Coup tendu moyen vers le centre.
 */
function play(seed: number, level: AiLevel, seconds: number) {
  const g = createGame(seed, level, COURT);
  const botRng = createRng(seed + 1000);
  const inputs: GameInput[] = [];
  const events: GameEvent[] = [];
  const rallies: number[] = [];
  const reasons: string[] = [];
  const ticks = Math.round(seconds * 120);
  let plannedFor: number | null = null;
  let swipeAt = -1;
  while (g.tick < ticks) {
    const human = g.players[0];
    if (human.target && plannedFor !== human.target.tick && g.rally.lastHitter !== 0) {
      plannedFor = human.target.tick;
      swipeAt = human.target.tick + Math.round(gaussian(botRng, 90) / (1000 / 120));
    }
    const now: GameInput[] = [];
    if (g.tick === swipeAt) {
      const aim = Math.atan2(COURT.width / 2 - human.pos.x, 12) * 0.8;
      now.push({ tick: g.tick, intent: { kind: 'drive', power: 0.5, aim, swipeSpeed: 0, curvature: 0 } });
      inputs.push(...now);
    }
    events.length = 0;
    tickGame(g, now, tuning, COURT, events);
    for (const e of events) if (e.type === 'point') {
      rallies.push(e.shots);
      plannedFor = null;
      reasons.push(`${e.result.winner === 0 ? 'J' : 'IA'}:${e.result.reason}`);
    }
  }
  return { g, inputs, rallies, reasons, ticks };
}

describe('échange 1 contre 1', () => {
  it('un joueur au timing correct tient des échanges de 6 coups ou plus, et les points se terminent', () => {
    const { rallies, reasons } = play(1, 'facile', 180);
    // Visible en cas d'échec : longueur des échanges et façon dont ils se terminent.
    expect(rallies.length, reasons.join(' ')).toBeGreaterThanOrEqual(4);
    expect(Math.max(...rallies), `${rallies.join(',')} — ${reasons.join(' ')}`).toBeGreaterThanOrEqual(6);
  });

  it('même graine + mêmes entrées = même partie (base des fantômes)', () => {
    const a = play(7, 'moyen', 60);
    const b = replay({ version: 1, seed: 7, aiLevel: 'moyen', tuning, inputs: a.inputs, ticks: a.ticks }, COURT);
    expect(b.score).toEqual(a.g.score);
    expect(b.ball?.pos).toEqual(a.g.ball?.pos);
    expect(b.players[0].pos).toEqual(a.g.players[0].pos);
    expect(b.tick).toBe(a.g.tick);
  });

  it('sans aucun swipe, le joueur perd tous les points', () => {
    const g = createGame(3, 'facile', COURT);
    const events: GameEvent[] = [];
    while (g.tick < 120 * 20) tickGame(g, [], tuning, COURT, events);
    expect(g.score[0]).toBe(0);
    expect(g.score[1]).toBeGreaterThan(2);
  });
});
