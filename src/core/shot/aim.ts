import type { CourtGeometry, PhysicsParams, ShotParams } from '../constants';
import { FIXED_DT } from '../constants';
import type { Vec2, Vec3 } from '../math/vec3';
import { predict } from '../physics/predict';
import { createBall } from '../physics/step';
import { shotVelocity, type ShotKind } from './swipeToShot';

/**
 * Coup visé (utilisé par l'IA) : cherche la puissance qui fait rebondir la balle au plus
 * près de la profondeur visée, avec le même modèle de frappe que le joueur.
 * L'IA n'a donc aucun coup « magique » : elle est limitée par les mêmes vitesses.
 */
export function aimAt(
  origin: Vec3,
  target: Vec2,
  kind: ShotKind,
  forward: 1 | -1,
  s: ShotParams,
  p: PhysicsParams,
  court: CourtGeometry,
): Vec3 {
  const depth = Math.abs(target.y - origin.y);
  const aim = Math.atan2(target.x - origin.x, depth);
  const dt = FIXED_DT * p.timeScale;
  const make = (power: number) => shotVelocity({ kind, power, aim, swipeSpeed: 0, curvature: 0 }, origin, s, p, court, forward);
  /** Profondeur parcourue jusqu'au premier contact ; filet = trop court, vitre directe = trop long. */
  const reach = (vel: Vec3): number => {
    const pred = predict(createBall(origin, vel), p, court, dt, 4, 4);
    const c = pred.contacts[0];
    if (!c) return Infinity;
    if (c.surface === 'net') return -Infinity;
    if (c.surface !== 'ground') return Infinity;
    return (c.pos.y - origin.y) * forward;
  };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (reach(make(mid)) < depth) lo = mid;
    else hi = mid;
  }
  return make((lo + hi) / 2);
}
