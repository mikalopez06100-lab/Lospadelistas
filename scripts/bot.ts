import { FIXED_DT, type AiLevel, type CourtGeometry, type Tuning } from '../src/core/constants';
import { createMatch, HUMAN_ID, tickMatch, type Match, type MatchEvent, type MatchInput } from '../src/core/play/match';
import { createRng, gaussian, type Rng } from '../src/core/rng';

/**
 * Joueur-robot qui tient la place du joueur humain : il connaît l'instant de frappe idéal mais
 * swipe avec une erreur de timing gaussienne (σ en ms), coup tendu moyen vers le côté libre.
 * Il sert à tester et à équilibrer le jeu, pas à jouer bien.
 */
export class Bot {
  private rng: Rng;
  private plannedFor: number | null = null;
  private swipeAt = -1;

  constructor(
    seed: number,
    private sigmaMs: number,
    private power = 0.5,
  ) {
    this.rng = createRng(seed);
  }

  inputs(m: Match, court: CourtGeometry): MatchInput[] {
    const me = m.players[HUMAN_ID];
    if (m.phase === 'serve' && m.serverId === HUMAN_ID) {
      if (m.phaseTicks === 60) return [{ tick: m.tick, intent: { kind: 'drive', power: 0.5, aim: 0, swipeSpeed: 0, curvature: 0 } }];
      return [];
    }
    if (m.phase !== 'rally') {
      this.plannedFor = null;
      return [];
    }
    if (me.target && this.plannedFor !== me.target.tick && m.rally.lastHitter !== me.team) {
      this.plannedFor = me.target.tick;
      this.swipeAt = me.target.tick + Math.round(gaussian(this.rng, this.sigmaMs) / (1000 * FIXED_DT));
    }
    if (m.tick !== this.swipeAt) return [];
    // Vise le côté libre : le point de la largeur le plus loin des deux adversaires.
    const opponents = m.players.filter((p) => p.team !== me.team);
    let bestX = court.width / 2;
    let bestGap = -1;
    for (const x of [1.5, 3, 5, 7, 8.5]) {
      const gap = Math.min(...opponents.map((o) => Math.abs(o.pos.x - x)));
      if (gap > bestGap) {
        bestGap = gap;
        bestX = x;
      }
    }
    const aim = Math.atan2(bestX - me.pos.x, court.length - 4 - me.pos.y);
    return [{ tick: m.tick, intent: { kind: 'drive', power: this.power, aim, swipeSpeed: 0, curvature: 0 } }];
  }
}

export interface BotMatchResult {
  match: Match;
  inputs: MatchInput[];
  events: MatchEvent[];
}

export function playBotMatch(seed: number, level: AiLevel, sigmaMs: number, tuning: Tuning, court: CourtGeometry, maxSeconds: number): BotMatchResult {
  const m = createMatch(seed, level, court, tuning.match.gamesToWin);
  const bot = new Bot(seed + 1000, sigmaMs);
  const inputs: MatchInput[] = [];
  const all: MatchEvent[] = [];
  const events: MatchEvent[] = [];
  while (m.phase !== 'over' && m.tick < maxSeconds / FIXED_DT) {
    const now = bot.inputs(m, court);
    inputs.push(...now);
    events.length = 0;
    tickMatch(m, now, tuning, court, events);
    for (const e of events) if (e.type !== 'contact') all.push(e);
  }
  return { match: m, inputs, events: all };
}
