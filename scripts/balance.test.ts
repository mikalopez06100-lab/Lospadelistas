/**
 * Équilibrage : simule des matchs complets par niveau d'IA, avec un joueur-robot dont le
 * timing a une erreur aléatoire (σ = 60 ms ≈ bon joueur, 120 ms ≈ joueur moyen).
 * Affiche durée, score, longueur des échanges et façon dont les points se terminent.
 * Lancer : npm run sim  (JEUX=1 npm run sim pour le format court)
 */
import { it } from 'vitest';
import { COURT, FIXED_DT, createDefaultTuning, type AiLevel } from '../src/core/constants';
import { playBotMatch } from './bot';

it('équilibrage des matchs', () => {
  const t = createDefaultTuning();
  t.match.gamesToWin = Number(process.env.JEUX ?? 3);
  for (const sigma of [60, 120]) {
    for (const level of ['facile', 'moyen', 'fort'] as AiLevel[]) {
      const durations: number[] = [];
      const rallies: number[] = [];
      const reasons: Record<string, number> = {};
      let won = 0;
      let points = 0;
      let faults = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const { match, events } = playBotMatch(seed * 31, level, sigma, t, COURT, 30 * 60);
        durations.push((match.tick * FIXED_DT) / 60);
        if (match.score.winner === 0) won++;
        for (const e of events) {
          if (e.type === 'fault') faults++;
          if (e.type !== 'point') continue;
          points++;
          rallies.push(e.shots);
          const k = `${e.result.winner === 0 ? 'nous' : 'eux'}:${e.result.reason}`;
          reasons[k] = (reasons[k] ?? 0) + 1;
        }
      }
      rallies.sort((a, b) => a - b);
      durations.sort((a, b) => a - b);
      const top = Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(', ');
      console.log(
        `σ${sigma}ms ${level.padEnd(6)} matchs gagnés ${won}/6 · durée médiane ${durations[3].toFixed(1)} min · ` +
          `${(points / 6).toFixed(0)} pts/match · échange médian ${rallies[rallies.length >> 1]} (max ${rallies[rallies.length - 1]}) · fautes de service ${faults} · ${top}`,
      );
    }
  }
}, 600000);
