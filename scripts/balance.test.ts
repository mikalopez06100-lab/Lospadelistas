/**
 * Équilibrage : simule des matchs complets par niveau d'IA, avec un joueur-robot dont le
 * timing a une erreur aléatoire (σ = 60 ms ≈ bon joueur, 120 ms ≈ joueur moyen).
 * Affiche durée, score, longueur des échanges et façon dont les points se terminent.
 * Lancer : npm run sim  (REBOTE_JEUX=1 pour le format court, REBOTE_MODE=duo, REBOTE_TACTIQUE=filet)
 */
import { it } from 'vitest';
import { COURT, FIXED_DT, createDefaultTuning, type AiLevel } from '../src/core/constants';
import { playBotMatch } from './bot';

it('équilibrage des matchs', () => {
  const t = createDefaultTuning();
  t.match.gamesToWin = Number(process.env.REBOTE_JEUX ?? 3);
  const mode = (process.env.REBOTE_MODE ?? 'solo') as 'solo' | 'duo';
  const tactic = (process.env.REBOTE_TACTIQUE ?? 'fond') as 'fond' | 'filet';
  console.log(`mode ${mode}${mode === 'duo' ? ` · tactique ${tactic}` : ''} · ${t.match.gamesToWin} jeu(x) gagnant(s)`);
  for (const sigma of [60, 120]) {
    for (const level of ['facile', 'moyen', 'fort'] as AiLevel[]) {
      const durations: number[] = [];
      const rallies: number[] = [];
      const reasons: Record<string, number> = {};
      let won = 0;
      let points = 0;
      let faults = 0;
      let glass1 = 0;
      let glass2 = 0;
      let style = 0;
      const par3 = [0, 0];
      const par4 = [0, 0];
      for (let seed = 1; seed <= 6; seed++) {
        const { match, events } = playBotMatch(seed * 31, level, sigma, t, COURT, 30 * 60, mode, tactic);
        durations.push((match.tick * FIXED_DT) / 60);
        if (match.score.winner === 0) won++;
        style += match.style;
        for (const e of events) {
          if (e.type === 'fault') faults++;
          if (e.type !== 'point') continue;
          points++;
          if (e.winnerGlass >= 1) glass1++;
          if (e.winnerGlass >= 2) glass2++;
          if (e.par === 3) par3[e.result.winner]++;
          if (e.par === 4) par4[e.result.winner]++;
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
          `${(points / 6).toFixed(0)} pts/match · échange médian ${rallies[rallies.length >> 1]} (max ${rallies[rallies.length - 1]}) · fautes de service ${faults} · coups gagnants avec 1 vitre+ ${glass1}, 2 vitres+ ${glass2} · style moyen ${(style / 6).toFixed(0)} · PAR3 nous ${par3[0]} eux ${par3[1]} · PAR4 nous ${par4[0]} eux ${par4[1]} · ${top}`,
      );
    }
  }
}, 600000);
