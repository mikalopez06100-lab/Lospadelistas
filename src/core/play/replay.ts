import type { AiLevel, CourtGeometry, Tuning } from '../constants';
import { createMatch, tickMatch, type Match, type MatchEvent, type MatchInput } from './match';

/**
 * Enregistrement d'un match : graine + réglages + entrées horodatées en ticks.
 * Rejouer = refaire tourner la simulation avec les mêmes entrées. Les entrées sont des
 * intentions de coup (direction, puissance, type), pas des pixels : le fantôme ne dépend
 * donc pas de l'écran de celui qui a joué.
 */
export interface Recording {
  version: 2;
  seed: number;
  aiLevel: AiLevel;
  tuning: Tuning;
  inputs: MatchInput[];
  ticks: number;
}

export function replay(rec: Recording, court: CourtGeometry, onEvent?: (e: MatchEvent, m: Match) => void): Match {
  const m = createMatch(rec.seed, rec.aiLevel, court, rec.tuning.match.gamesToWin);
  const events: MatchEvent[] = [];
  let next = 0;
  while (m.tick < rec.ticks) {
    const start = next;
    while (next < rec.inputs.length && rec.inputs[next].tick === m.tick) next++;
    events.length = 0;
    tickMatch(m, rec.inputs.slice(start, next), rec.tuning, court, events);
    if (onEvent) for (const e of events) onEvent(e, m);
  }
  return m;
}
