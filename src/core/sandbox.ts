import { FIXED_DT, type CourtGeometry, type Tuning } from './constants';
import { copyV3, v3, type Vec3 } from './math/vec3';
import { createBall, stepBall, type BallState, type ContactEvent } from './physics/step';

/**
 * Phase 0 — bac à sable : une balle, des vitres, aucune règle.
 * État pur, sans DOM : le rendu ne fait que le lire.
 */
export interface Sandbox {
  tick: number;
  ball: BallState | null;
  /** Position au tick précédent, pour interpoler l'affichage entre deux pas. */
  prevPos: Vec3;
  lastLaunch: { origin: Vec3; vel: Vec3 } | null;
  lastContact: ContactEvent | null;
  /** Ticks écoulés depuis que la balle est arrêtée ou sortie. */
  idleTicks: number;
}

export function createSandbox(): Sandbox {
  return { tick: 0, ball: null, prevPos: v3(), lastLaunch: null, lastContact: null, idleTicks: 0 };
}

export function launchBall(sb: Sandbox, origin: Vec3, vel: Vec3): void {
  sb.ball = createBall(origin, vel);
  copyV3(sb.prevPos, origin);
  sb.lastLaunch = { origin: { ...origin }, vel: { ...vel } };
  sb.lastContact = null;
  sb.idleTicks = 0;
}

export function relaunch(sb: Sandbox): boolean {
  if (!sb.lastLaunch) return false;
  launchBall(sb, sb.lastLaunch.origin, sb.lastLaunch.vel);
  return true;
}

/** Un tick de simulation (FIXED_DT de temps réel). Les impacts du tick sont ajoutés à `events`. */
export function tickSandbox(sb: Sandbox, tuning: Tuning, court: CourtGeometry, events: ContactEvent[]): void {
  sb.tick++;
  const ball = sb.ball;
  if (!ball) return;
  copyV3(sb.prevPos, ball.pos);
  const before = events.length;
  stepBall(ball, FIXED_DT * tuning.physics.timeScale, tuning.physics, court, events);
  if (events.length > before) sb.lastContact = events[events.length - 1];
  if (ball.status === 'stopped' || ball.status === 'out') sb.idleTicks++;
}
