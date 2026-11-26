import { FIXED_DT, type AiLevel, type CourtGeometry, type Tuning } from '../src/core/constants';
import { createMatch, HUMAN_ID, tickMatch, type ControlMode, type Match, type MatchEvent, type MatchInput, type MatchPlayer } from '../src/core/play/match';
import { createRng, gaussian, nextFloat, type Rng } from '../src/core/rng';
import type { ShotIntent } from '../src/core/shot/swipeToShot';

/**
 * Joueur-robot qui tient la place du joueur humain. Il connaît l'instant de frappe idéal mais
 * swipe avec une erreur de timing gaussienne (σ en ms). Il sert à tester et à équilibrer le jeu,
 * pas à jouer bien.
 *  - solo : il ne fait que frapper (coup tendu moyen vers le côté libre) ;
 *  - duo  : il dirige aussi les deux joueurs au stick, avec une tactique « fond » ou « filet »,
 *           smashe les balles hautes et lobe une équipe montée au filet.
 */
export class Bot {
  private rng: Rng;
  private plannedFor: (number | null)[] = [null, null];
  private swipeAt = [-1, -1];
  private lastStick = ['', ''];

  constructor(
    seed: number,
    private sigmaMs: number,
    private tactic: 'fond' | 'filet' = 'fond',
    private power = 0.5,
  ) {
    this.rng = createRng(seed);
  }

  inputs(m: Match, court: CourtGeometry, tuning?: Tuning): MatchInput[] {
    const out: MatchInput[] = [];
    for (const p of m.players) {
      if (!p.isHuman) continue;
      if (p.manual) this.steer(m, p, court, out);
      this.shoot(m, p, court, tuning, out);
    }
    return out;
  }

  private steer(m: Match, p: MatchPlayer, court: CourtGeometry, out: MatchInput[]): void {
    const homeY = this.tactic === 'filet' && m.rally.lastHitter === p.team ? court.netY - 3 : this.tactic === 'filet' ? p.pos.y : 3;
    const goal = p.target ? p.target.pos : { x: (p.zone.xMin + p.zone.xMax) / 2, y: homeY };
    const dx = goal.x - p.pos.x;
    const dy = goal.y - p.pos.y;
    const d = Math.hypot(dx, dy);
    // Stick quantifié : une entrée n'est émise que quand la commande change, comme un vrai pouce.
    const q = (v: number) => Math.round(v * 4) / 4;
    const stick = d < 0.12 || m.phase !== 'rally' ? null : { x: q(dx / d), y: q(dy / d) };
    const key = stick ? `${stick.x},${stick.y}` : '';
    if (key === this.lastStick[p.id]) return;
    this.lastStick[p.id] = key;
    out.push({ tick: m.tick, playerId: p.id, stick });
  }

  private shoot(m: Match, p: MatchPlayer, court: CourtGeometry, tuning: Tuning | undefined, out: MatchInput[]): void {
    if (m.phase === 'serve') {
      if (m.serverId === p.id && m.phaseTicks === 60) out.push({ tick: m.tick, playerId: p.id, intent: this.intent('drive', 0.5, 0) });
      return;
    }
    if (m.phase !== 'rally') {
      this.plannedFor[p.id] = null;
      return;
    }
    if (p.target && this.plannedFor[p.id] !== p.target.tick && m.rally.lastHitter !== p.team) {
      this.plannedFor[p.id] = p.target.tick;
      this.swipeAt[p.id] = p.target.tick + Math.round(gaussian(this.rng, this.sigmaMs) / (1000 * FIXED_DT));
    }
    if (m.tick !== this.swipeAt[p.id]) return;
    // Vise le côté libre : le point de la largeur le plus loin des deux adversaires.
    const opponents = m.players.filter((o) => o.team !== p.team);
    let bestX = court.width / 2;
    let bestGap = -1;
    for (const x of [1.5, 3, 5, 7, 8.5]) {
      const gap = Math.min(...opponents.map((o) => Math.abs(o.pos.x - x)));
      if (gap > bestGap) {
        bestGap = gap;
        bestX = x;
      }
    }
    const aim = Math.atan2(bestX - p.pos.x, court.length - 4 - p.pos.y);
    let kind: ShotIntent['kind'] = 'drive';
    if (m.ball && tuning) {
      const oppAtNet = opponents.every((o) => o.pos.y - court.netY < 4.5);
      if (m.ball.pos.z >= tuning.play.smashMinZ) kind = 'smash';
      else if (oppAtNet && nextFloat(this.rng) < 0.6) kind = 'lob';
    }
    out.push({ tick: m.tick, playerId: p.id, intent: this.intent(kind, kind === 'smash' ? 0.7 : this.power, aim) });
  }

  private intent(kind: ShotIntent['kind'], power: number, aim: number): ShotIntent {
    return { kind, power, aim, swipeSpeed: 0, curvature: 0 };
  }
}

export interface BotMatchResult {
  match: Match;
  inputs: MatchInput[];
  events: MatchEvent[];
}

export function playBotMatch(
  seed: number,
  level: AiLevel,
  sigmaMs: number,
  tuning: Tuning,
  court: CourtGeometry,
  maxSeconds: number,
  mode: ControlMode = 'solo',
  tactic: 'fond' | 'filet' = 'fond',
): BotMatchResult {
  const m = createMatch(seed, level, court, tuning.match.gamesToWin, mode);
  const bot = new Bot(seed + 1000, sigmaMs, tactic);
  const inputs: MatchInput[] = [];
  const all: MatchEvent[] = [];
  const events: MatchEvent[] = [];
  while (m.phase !== 'over' && m.tick < maxSeconds / FIXED_DT) {
    const now = bot.inputs(m, court, tuning);
    inputs.push(...now);
    events.length = 0;
    tickMatch(m, now, tuning, court, events);
    for (const e of events) if (e.type !== 'contact') all.push(e);
  }
  return { match: m, inputs, events: all };
}

export { HUMAN_ID };
