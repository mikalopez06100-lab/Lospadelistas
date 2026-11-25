/**
 * Équilibrage : simule 5 minutes de jeu par niveau d'IA avec un joueur-robot dont le timing
 * a une erreur aléatoire (σ = 60 ms ≈ bon joueur, 120 ms ≈ joueur moyen), et affiche la
 * longueur des échanges et la façon dont les points se terminent.
 * Lancer : npm run sim
 */
import { it } from 'vitest';
import { COURT, createDefaultTuning, type AiLevel } from '../src/core/constants';
import { createGame, tickGame, type GameEvent, type GameInput } from '../src/core/play/game';
import { createRng, gaussian } from '../src/core/rng';
it('stats', () => {
  const t = createDefaultTuning();
  for (const sigmaMs of [60, 120]) for (const level of ['facile', 'moyen', 'fort'] as AiLevel[]) {
    const g = createGame(11, level, COURT);
    const botRng = createRng(99);
    const ev: GameEvent[] = [];
    const rallies: number[] = []; const reasons: Record<string, number> = {};
    let plannedFor: number | null = null; let swipeAt = -1;
    while (g.tick < 120 * 300) {
      const h = g.players[0]; const now: GameInput[] = [];
      // Le bot "voit" l'instant idéal et swipe avec une erreur de timing gaussienne.
      if (h.target && plannedFor !== h.target.tick && g.rally.lastHitter !== 0) { plannedFor = h.target.tick; swipeAt = h.target.tick + Math.round(gaussian(botRng, sigmaMs) / (1000 / 120)); }
      if (g.tick === swipeAt) now.push({ tick: g.tick, intent: { kind: 'drive', power: 0.5, aim: Math.atan2(5 - h.pos.x, 12) * 0.8, swipeSpeed: 0, curvature: 0 } });
      ev.length = 0; tickGame(g, now, t, COURT, ev);
      for (const e of ev) if (e.type === 'point') { rallies.push(e.shots); plannedFor = null; const k = (e.result.winner === 0 ? 'J:' : 'IA:') + e.result.reason; reasons[k] = (reasons[k] ?? 0) + 1; }
    }
    rallies.sort((a, b) => a - b);
    console.log(`σ${sigmaMs}ms`, level, 'points', rallies.length, 'score J-IA', g.score.join('-'), 'médiane', rallies[rallies.length >> 1], 'max', rallies[rallies.length - 1], JSON.stringify(reasons));
  }
}, 120000);
