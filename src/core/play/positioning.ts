import type { CourtGeometry, PhysicsParams, PlayParams } from '../constants';
import type { Vec2, Vec3 } from '../math/vec3';
import { cloneBall, stepBall, type BallState, type ContactEvent } from '../physics/step';
import { canHit, cloneRally, onBallStatus, onContact, type RallyState, type Side } from '../rules/rally';

/** Moment où la balle sera jouable : volée, après le rebond, ou après rebond + vitre. */
export type WindowKind = 'volley' | 'bounce' | 'glass';

export interface ContactWindow {
  /** Nombre de pas de simulation avant ce moment. */
  steps: number;
  pos: Vec3;
  kind: WindowKind;
}

/**
 * Parcourt le futur de la balle (même physique, mêmes règles) et liste les instants où le
 * joueur de `side` pourrait la frapper. S'arrête dès que le point serait terminé.
 */
export function findWindows(
  ball: BallState,
  rally: RallyState,
  side: Side,
  playerId: number,
  p: PhysicsParams,
  play: PlayParams,
  court: CourtGeometry,
  dt: number,
  maxSteps: number,
  maxZ = play.maxContactZ,
): ContactWindow[] {
  const b = cloneBall(ball);
  const r = cloneRally(rally);
  const events: ContactEvent[] = [];
  const out: ContactWindow[] = [];
  let glassSinceBounce = false;
  for (let i = 1; i <= maxSteps; i++) {
    events.length = 0;
    stepBall(b, dt, p, court, events);
    for (const e of events) {
      const before = r.receiverBounces;
      onContact(r, e, court);
      if (r.receiverBounces > before) glassSinceBounce = false;
      else if ((e.surface === 'glass' || e.surface === 'fence') && r.receiverBounces > 0) glassSinceBounce = true;
    }
    onBallStatus(r, b);
    if (r.result) break;
    // Un échantillon tous les 2 pas suffit (≈ 1 cm à 1 m/s près de la frappe) et divise le coût.
    if (i % 2 !== 0) continue;
    if (!canHit(r, side, b.pos.y, court, playerId)) continue;
    if (b.pos.z < play.minContactZ || b.pos.z > maxZ) continue;
    out.push({
      steps: i,
      pos: { ...b.pos },
      kind: r.receiverBounces === 0 ? 'volley' : glassSinceBounce ? 'glass' : 'bounce',
    });
  }
  return out;
}

export interface WindowChoice {
  window: ContactWindow;
  /** false = aucun instant atteignable à temps : c'est le « moins pire ». */
  reachable: boolean;
  /** Marge de temps (s) : positive = en avance, négative = en retard. */
  slack: number;
}

/**
 * Choisit l'instant de frappe : atteignable à temps, hauteur proche de l'idéal, et après le
 * rebond de préférence (la volée est pénalisée). Si rien n'est atteignable, prend le moins
 * inaccessible : le joueur fait de son mieux, il ne reste pas planté.
 */
export function chooseWindow(
  windows: ContactWindow[],
  from: Vec2,
  moveSpeed: number,
  dt: number,
  play: PlayParams,
  volleyPenalty = play.volleyPenalty,
): WindowChoice | null {
  let best: ContactWindow | null = null;
  let bestCost = Infinity;
  let bestSlack = 0;
  let fallback: ContactWindow | null = null;
  let fallbackLate = Infinity;
  for (const w of windows) {
    const travel = Math.max(0, Math.hypot(w.pos.x - from.x, w.pos.y - from.y) - play.reach * 0.4) / moveSpeed;
    const available = w.steps * dt;
    const late = travel - available;
    if (late > 0) {
      if (late < fallbackLate) {
        fallbackLate = late;
        fallback = w;
      }
      continue;
    }
    const cost = Math.abs(w.pos.z - play.idealContactZ) + (w.kind === 'volley' ? volleyPenalty : 0) + 0.05 * available;
    if (cost < bestCost) {
      bestCost = cost;
      best = w;
      bestSlack = -late;
    }
  }
  if (best) return { window: best, reachable: true, slack: bestSlack };
  return fallback ? { window: fallback, reachable: false, slack: -fallbackLate } : null;
}
