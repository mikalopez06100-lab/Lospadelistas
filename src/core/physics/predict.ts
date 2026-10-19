import type { CourtGeometry, PhysicsParams } from '../constants';
import type { Vec3 } from '../math/vec3';
import { cloneBall, stepBall, type BallState, type BallStatus, type ContactEvent } from './step';

export interface Prediction {
  points: Vec3[];
  contacts: ContactEvent[];
  endStatus: BallStatus;
}

/**
 * Simule le futur de la balle avec exactement la même fonction que le jeu.
 * Utilisé par le mode debug ; servira aussi au placement automatique et à l'IA.
 */
export function predict(
  ball: BallState,
  p: PhysicsParams,
  court: CourtGeometry,
  dt: number,
  maxTime: number,
  sampleEvery = 2,
): Prediction {
  const b = cloneBall(ball);
  const points: Vec3[] = [{ ...b.pos }];
  const contacts: ContactEvent[] = [];
  const steps = Math.ceil(maxTime / dt);
  for (let i = 1; i <= steps; i++) {
    stepBall(b, dt, p, court, contacts);
    if (i % sampleEvery === 0) points.push({ ...b.pos });
    if (b.status === 'stopped' || b.status === 'out') {
      points.push({ ...b.pos });
      break;
    }
  }
  return { points, contacts, endStatus: b.status };
}
