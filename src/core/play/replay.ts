import type { AiLevel, CourtGeometry, Tuning } from '../constants';
import { createGame, tickGame, type Game, type GameEvent, type GameInput } from './game';

/**
 * Enregistrement d'une partie : graine + réglages + entrées horodatées en ticks.
 * Rejouer = refaire tourner la simulation avec les mêmes entrées. Les entrées sont des
 * intentions de coup (direction, puissance, type), pas des pixels : le fantôme ne dépend
 * donc pas de l'écran de celui qui a joué.
 */
export interface Recording {
  version: 1;
  seed: number;
  aiLevel: AiLevel;
  tuning: Tuning;
  inputs: GameInput[];
  ticks: number;
}

export function replay(rec: Recording, court: CourtGeometry, onEvent?: (e: GameEvent, g: Game) => void): Game {
  const g = createGame(rec.seed, rec.aiLevel, court);
  const events: GameEvent[] = [];
  let next = 0;
  while (g.tick < rec.ticks) {
    const start = next;
    while (next < rec.inputs.length && rec.inputs[next].tick === g.tick) next++;
    events.length = 0;
    tickGame(g, rec.inputs.slice(start, next), rec.tuning, court, events);
    if (onEvent) for (const e of events) onEvent(e, g);
  }
  return g;
}
