import { AI_LEVELS, FIXED_DT, type AiLevel, type CourtGeometry, type Tuning } from '../constants';
import { clamp, copyV3, DEG, v3, type Vec2, type Vec3 } from '../math/vec3';
import { createBall, stepBall, type BallState, type ContactEvent } from '../physics/step';
import { canHit, createRally, onBallStatus, onContact, onHit, type PointResult, type RallyState, type Side } from '../rules/rally';
import { createRng, gaussian, nextFloat, range, type Rng } from '../rng';
import { aimAt } from '../shot/aim';
import { shotVelocity, type ShotIntent, type ShotKind } from '../shot/swipeToShot';
import { chooseWindow, findWindows, type ContactWindow } from './positioning';

/**
 * Phase 1 — échange 1 contre 1. Simulation pure et déterministe :
 * même graine + mêmes entrées horodatées (en ticks) = même partie. C'est la base des
 * « fantômes » : il suffira d'enregistrer la graine et les entrées.
 */

export interface PlayerState {
  side: Side;
  isHuman: boolean;
  pos: Vec2;
  home: Vec2;
  /** Instant de frappe visé (tick absolu) et point de contact prévu. */
  target: { tick: number; pos: Vec3; kind: ContactWindow['kind'] } | null;
  /** Tick à partir duquel recalculer la cible ; null = rien à recalculer. */
  retargetAt: number | null;
}

export type Phase = 'feed' | 'rally' | 'point';
export type Timing = 'parfait' | 'tot' | 'tard' | 'juste';

export interface GameInput {
  tick: number;
  intent: ShotIntent;
}

export type GameEvent =
  | { type: 'contact'; contact: ContactEvent }
  | { type: 'hit'; side: Side; kind: ShotKind; quality: number; timing: Timing; speed: number }
  | { type: 'point'; result: PointResult; shots: number };

export interface Game {
  tick: number;
  seed: number;
  rng: Rng;
  aiLevel: AiLevel;
  ball: BallState | null;
  prevPos: Vec3;
  rally: RallyState;
  players: [PlayerState, PlayerState];
  phase: Phase;
  phaseTicks: number;
  /** Swipe gardé en mémoire en attendant que la balle soit à portée. */
  pending: { intent: ShotIntent; expires: number } | null;
  score: [number, number];
  /** Frappes dans l'échange en cours (mise en jeu exclue). */
  shots: number;
  bestRally: number;
  lastPoint: PointResult | null;
  lastContact: ContactEvent | null;
}

const FEED_DELAY_TICKS = 90;
const POINT_PAUSE_TICKS = 170;
const PLAYER_BOUNDS = { xMin: 0.4, xMax: 9.6, back: 0.4, front: 0.8 };

export function createGame(seed: number, aiLevel: AiLevel, court: CourtGeometry): Game {
  const humanHome = { x: court.width / 2, y: 3 };
  const aiHome = { x: court.width / 2, y: court.length - 3 };
  return {
    tick: 0,
    seed,
    rng: createRng(seed),
    aiLevel,
    ball: null,
    prevPos: v3(),
    rally: createRally(),
    players: [
      { side: 0, isHuman: true, pos: { ...humanHome }, home: humanHome, target: null, retargetAt: null },
      { side: 1, isHuman: false, pos: { ...aiHome }, home: aiHome, target: null, retargetAt: null },
    ],
    phase: 'feed',
    phaseTicks: 0,
    pending: null,
    score: [0, 0],
    shots: 0,
    bestRally: 0,
    lastPoint: null,
    lastContact: null,
  };
}

/** La balle est-elle frappable maintenant par ce joueur ? */
export function isHittable(g: Game, pl: PlayerState, t: Tuning, court: CourtGeometry): boolean {
  const b = g.ball;
  if (!b || g.phase !== 'rally' || b.status === 'stopped' || b.status === 'out') return false;
  if (!canHit(g.rally, pl.side, b.pos.y, court)) return false;
  if (b.pos.z < t.play.minContactZ || b.pos.z > t.play.maxContactZ) return false;
  return Math.hypot(b.pos.x - pl.pos.x, b.pos.y - pl.pos.y) <= t.play.reach;
}

export function tickGame(g: Game, inputs: readonly GameInput[], t: Tuning, court: CourtGeometry, out: GameEvent[]): void {
  const dt = FIXED_DT * t.physics.timeScale;
  for (const input of inputs) {
    if (input.tick !== g.tick) continue;
    g.pending = { intent: input.intent, expires: g.tick + Math.round(t.play.swipeBufferMs / 1000 / FIXED_DT) };
  }
  if (g.pending && g.tick > g.pending.expires) g.pending = null;

  g.phaseTicks++;
  if (g.phase === 'feed' && g.phaseTicks >= FEED_DELAY_TICKS) feed(g, t, court);
  if (g.phase === 'point' && g.phaseTicks >= POINT_PAUSE_TICKS) resetPoint(g);

  const ball = g.ball;
  if (ball) {
    copyV3(g.prevPos, ball.pos);
    const contacts: ContactEvent[] = [];
    stepBall(ball, dt, t.physics, court, contacts);
    for (const c of contacts) {
      out.push({ type: 'contact', contact: c });
      g.lastContact = c;
      onContact(g.rally, c, court);
    }
    onBallStatus(g.rally, ball);
    if (contacts.length > 0) for (const pl of g.players) if (pl.retargetAt !== null || pl.target) pl.retargetAt = Math.max(pl.retargetAt ?? g.tick, g.tick);
    if (g.phase === 'rally' && g.rally.result) endPoint(g, out);
  }

  for (const pl of g.players) {
    if (pl.retargetAt !== null && g.tick >= pl.retargetAt) retarget(g, pl, t, court, dt);
    movePlayer(g, pl, t, dt, court);
  }

  const human = g.players[0];
  if (g.pending && isHittable(g, human, t, court)) hitHuman(g, human, g.pending.intent, t, court, out);
  const ai = g.players[1];
  if (isHittable(g, ai, t, court) && (!ai.target || g.tick >= ai.target.tick)) hitAi(g, ai, t, court, out);

  g.tick++;
}

function feed(g: Game, t: Tuning, court: CourtGeometry): void {
  const ai = g.players[1];
  const origin = { x: ai.pos.x, y: ai.pos.y, z: 1.0 };
  const target = { x: range(g.rng, 3, 7), y: range(g.rng, 2.5, 5) };
  g.ball = createBall(origin, aimAt(origin, target, 'drive', -1, t.shot, t.physics, court));
  copyV3(g.prevPos, origin);
  g.rally = createRally();
  onHit(g.rally, 1);
  g.phase = 'rally';
  g.phaseTicks = 0;
  g.shots = 0;
  g.players[0].retargetAt = g.tick;
  g.players[1].target = null;
  g.players[1].retargetAt = null;
}

function resetPoint(g: Game): void {
  g.ball = null;
  g.phase = 'feed';
  g.phaseTicks = 0;
  g.pending = null;
  for (const pl of g.players) {
    pl.target = null;
    pl.retargetAt = null;
  }
}

function endPoint(g: Game, out: GameEvent[]): void {
  const result = g.rally.result!;
  g.score[result.winner]++;
  g.bestRally = Math.max(g.bestRally, g.shots);
  g.lastPoint = result;
  g.phase = 'point';
  g.phaseTicks = 0;
  g.pending = null;
  for (const pl of g.players) {
    pl.target = null;
    pl.retargetAt = null;
  }
  out.push({ type: 'point', result, shots: g.shots });
}

function retarget(g: Game, pl: PlayerState, t: Tuning, court: CourtGeometry, dt: number): void {
  pl.retargetAt = null;
  pl.target = null;
  if (!g.ball || g.phase !== 'rally' || g.rally.lastHitter === pl.side) return;
  const speed = pl.isHuman ? t.play.moveSpeed : AI_LEVELS[g.aiLevel].moveSpeed;
  const windows = findWindows(g.ball, g.rally, pl.side, t.physics, t.play, court, dt, Math.ceil(4 / dt));
  const w = chooseWindow(windows, pl.pos, speed, dt, t.play);
  if (w) pl.target = { tick: g.tick + w.steps, pos: w.pos, kind: w.kind };
}

function movePlayer(g: Game, pl: PlayerState, t: Tuning, dt: number, court: CourtGeometry): void {
  const speed = pl.isHuman ? t.play.moveSpeed : AI_LEVELS[g.aiLevel].moveSpeed;
  const goal = pl.target ? pl.target.pos : g.rally.lastHitter === pl.side || g.phase !== 'rally' ? pl.home : null;
  if (!goal) return;
  const gx = clamp(goal.x, PLAYER_BOUNDS.xMin, PLAYER_BOUNDS.xMax);
  const gy =
    pl.side === 0
      ? clamp(goal.y, PLAYER_BOUNDS.back, court.netY - PLAYER_BOUNDS.front)
      : clamp(goal.y, court.netY + PLAYER_BOUNDS.front, court.length - PLAYER_BOUNDS.back);
  const dx = gx - pl.pos.x;
  const dy = gy - pl.pos.y;
  const d = Math.hypot(dx, dy);
  const step = speed * dt;
  if (d <= step) {
    pl.pos.x = gx;
    pl.pos.y = gy;
  } else {
    pl.pos.x += (dx / d) * step;
    pl.pos.y += (dy / d) * step;
  }
}

/** Qualité de frappe 0–1 : balle bien centrée sur le joueur et à bonne hauteur. */
function hitQuality(ball: BallState, pl: PlayerState, t: Tuning): number {
  const dxy = Math.hypot(ball.pos.x - pl.pos.x, ball.pos.y - pl.pos.y) / t.play.reach;
  const dz = Math.abs(ball.pos.z - t.play.idealContactZ) / 1.2;
  return clamp(1 - 0.6 * clamp(dxy, 0, 1) - 0.4 * clamp(dz, 0, 1), 0, 1);
}

function hitHuman(g: Game, pl: PlayerState, intent: ShotIntent, t: Tuning, court: CourtGeometry, out: GameEvent[]): void {
  const ball = g.ball!;
  const quality = hitQuality(ball, pl, t);
  const spread = 1 - quality;
  const maxAim = t.play.maxTimingAimErrorDeg * DEG;
  const aimErr = clamp(gaussian(g.rng, 0.5) * spread * maxAim, -maxAim, maxAim);
  const powerErr = gaussian(g.rng, 0.5) * spread * t.play.maxTimingPowerError;
  const actual: ShotIntent = { ...intent, aim: intent.aim + aimErr, power: clamp(intent.power + powerErr, 0, 1) };
  const vel = shotVelocity(actual, ball.pos, t.shot, t.physics, court, 1);
  let timing: Timing = quality >= 0.85 ? 'parfait' : 'juste';
  if (timing !== 'parfait' && pl.target) {
    if (g.tick < pl.target.tick - 4) timing = 'tot';
    else if (g.tick > pl.target.tick + 4) timing = 'tard';
  }
  launch(g, pl, vel, out, intent.kind, quality, timing);
}

function hitAi(g: Game, pl: PlayerState, t: Tuning, court: CourtGeometry, out: GameEvent[]): void {
  const ball = g.ball!;
  const ai = AI_LEVELS[g.aiLevel];
  const kind: ShotKind = nextFloat(g.rng) < ai.lobChance ? 'lob' : 'drive';
  const depth = range(g.rng, ai.minDepth, ai.maxDepth);
  const opponent = g.players[0];
  const baseX =
    nextFloat(g.rng) < ai.openCourtBias
      ? opponent.pos.x < court.width / 2
        ? range(g.rng, court.width - 3, court.width - 0.8)
        : range(g.rng, 0.8, 3)
      : range(g.rng, 1.5, court.width - 1.5);
  const target = {
    x: clamp(baseX + gaussian(g.rng, ai.aimError), 0.3, court.width - 0.3),
    y: court.netY - depth + gaussian(g.rng, ai.aimError),
  };
  const vel = aimAt(ball.pos, target, kind, -1, t.shot, t.physics, court);
  if (nextFloat(g.rng) < ai.errorChance) spoil(vel, g.rng);
  launch(g, pl, vel, out, kind, 1, 'juste');
}

/** Faute directe de l'IA : frappe trop forte (vitre sans rebond), dans le filet, ou trop croisée. */
function spoil(vel: Vec3, rng: Rng): void {
  const r = nextFloat(rng);
  if (r < 0.4) {
    vel.x *= 1.45;
    vel.y *= 1.45;
    vel.z = Math.abs(vel.z) * 1.45 + 1;
  } else if (r < 0.7) {
    vel.x *= 0.6;
    vel.y *= 0.6;
    vel.z = Math.min(vel.z, 0);
  } else {
    const a = (nextFloat(rng) < 0.5 ? -1 : 1) * 35 * DEG;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const x = vel.x * c - vel.y * sn;
    vel.y = vel.x * sn + vel.y * c;
    vel.x = x;
  }
}

function launch(g: Game, pl: PlayerState, vel: Vec3, out: GameEvent[], kind: ShotKind, quality: number, timing: Timing): void {
  const ball = g.ball!;
  g.ball = createBall(ball.pos, vel);
  onHit(g.rally, pl.side);
  g.shots++;
  g.pending = null;
  pl.target = null;
  pl.retargetAt = null;
  const other = g.players[pl.side === 0 ? 1 : 0];
  // L'IA réagit avec un temps de retard (temps réel) ; le placement du joueur humain est immédiat.
  const reactionTicks = other.isHuman ? 0 : Math.round(AI_LEVELS[g.aiLevel].reaction / FIXED_DT);
  other.retargetAt = g.tick + reactionTicks;
  other.target = null;
  out.push({ type: 'hit', side: pl.side, kind, quality, timing, speed: Math.hypot(vel.x, vel.y, vel.z) });
}
