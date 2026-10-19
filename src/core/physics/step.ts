import type { CourtGeometry, Material, PhysicsParams } from '../constants';
import type { Vec3 } from '../math/vec3';
import { backWallSurface, isInsideEnclosure, netHeightAt, sideWallSurface } from './court';

/**
 * Physique de la balle : 2D + hauteur.
 *
 * À l'intérieur d'un pas, la seule accélération est la gravité (la traînée est appliquée
 * au début du pas). La trajectoire y est donc exacte : linéaire en x/y, parabolique en z.
 * Toutes les surfaces sont des plans alignés sur les axes, donc l'instant d'impact se calcule
 * analytiquement : pas d'effet tunnel quelle que soit la vitesse, et les coins (deux vitres
 * dans le même pas) sont traités en enchaînant les impacts.
 */

export type BallStatus = 'flying' | 'rolling' | 'stopped' | 'out';
export type Surface = 'ground' | 'glass' | 'fence' | 'net';
export type Plane = 'ground' | 'left' | 'right' | 'backNear' | 'backFar' | 'net';

export interface BallState {
  pos: Vec3;
  vel: Vec3;
  status: BallStatus;
}

export interface ContactEvent {
  surface: Surface;
  plane: Plane;
  /** Position au moment de l'impact. */
  pos: Vec3;
  /** Vitesse d'arrivée perpendiculaire à la surface (m/s) — sert à doser son et effets. */
  normalSpeed: number;
  /** Instant de l'impact à l'intérieur du pas (s, temps physique). */
  t: number;
}

const MAX_CONTACTS_PER_STEP = 8;
/** Tolérance pour une balle posée pile sur un plan (erreurs d'arrondi). */
const TOUCH_EPS = 1e-6;

export function createBall(pos: Vec3, vel: Vec3): BallState {
  return { pos: { ...pos }, vel: { ...vel }, status: 'flying' };
}

export function cloneBall(b: BallState): BallState {
  return { pos: { ...b.pos }, vel: { ...b.vel }, status: b.status };
}

/** Temps avant que le bas de la balle (hauteur h au-dessus du sol) touche le sol, en chute parabolique. */
function timeToGround(h: number, vz: number, g: number): number {
  const hh = h > 0 ? h : 0;
  return (vz + Math.sqrt(vz * vz + 2 * g * hh)) / g;
}

function zAt(z: number, vz: number, g: number, t: number): number {
  return z + vz * t - 0.5 * g * t * t;
}

/** Avance la balle de dt (temps physique). Les impacts sont ajoutés à `events` s'il est fourni. */
export function stepBall(
  ball: BallState,
  dt: number,
  p: PhysicsParams,
  court: CourtGeometry,
  events?: ContactEvent[],
): void {
  if (ball.status === 'stopped' || ball.status === 'out') return;
  const { pos, vel } = ball;
  const r = p.ballRadius;
  const W = court.width;
  const L = court.length;

  if (ball.status === 'rolling') {
    const k = Math.max(0, 1 - p.rollFriction * dt);
    vel.x *= k;
    vel.y *= k;
    vel.z = 0;
    pos.z = r;
  } else {
    const k = Math.max(0, 1 - p.airDrag * dt);
    vel.x *= k;
    vel.y *= k;
    vel.z *= k;
  }
  let g = ball.status === 'rolling' ? 0 : p.gravity;

  let remaining = dt;
  for (let i = 0; i < MAX_CONTACTS_PER_STEP && remaining > 0; i++) {
    let tHit = remaining;
    let plane: Plane | null = null;
    let surface: Surface | null = null;

    if (g > 0) {
      const t = timeToGround(pos.z - r, vel.z, g);
      if (t <= tHit) {
        tHit = t;
        plane = 'ground';
        surface = 'ground';
      }
    }

    // Parois latérales (x = 0 et x = W).
    if (vel.x < 0) {
      const d = pos.x - r;
      if (d >= -TOUCH_EPS) {
        const t = Math.max(0, d) / -vel.x;
        if (t <= tHit) {
          const s = sideWallSurface(court, pos.y + vel.y * t, zAt(pos.z, vel.z, g, t));
          if (s) {
            tHit = t;
            plane = 'left';
            surface = s;
          }
        }
      }
    } else if (vel.x > 0) {
      const d = W - r - pos.x;
      if (d >= -TOUCH_EPS) {
        const t = Math.max(0, d) / vel.x;
        if (t <= tHit) {
          const s = sideWallSurface(court, pos.y + vel.y * t, zAt(pos.z, vel.z, g, t));
          if (s) {
            tHit = t;
            plane = 'right';
            surface = s;
          }
        }
      }
    }

    // Fonds (y = 0 et y = L) et filet (y = netY).
    if (vel.y < 0) {
      const d = pos.y - r;
      if (d >= -TOUCH_EPS) {
        const t = Math.max(0, d) / -vel.y;
        if (t <= tHit) {
          const s = backWallSurface(court, pos.x + vel.x * t, zAt(pos.z, vel.z, g, t));
          if (s) {
            tHit = t;
            plane = 'backNear';
            surface = s;
          }
        }
      }
      const dn = pos.y - (court.netY + r);
      if (dn >= -TOUCH_EPS) {
        const t = Math.max(0, dn) / -vel.y;
        if (t <= tHit && hitsNet(court, pos.x + vel.x * t, zAt(pos.z, vel.z, g, t) - r)) {
          tHit = t;
          plane = 'net';
          surface = 'net';
        }
      }
    } else if (vel.y > 0) {
      const d = L - r - pos.y;
      if (d >= -TOUCH_EPS) {
        const t = Math.max(0, d) / vel.y;
        if (t <= tHit) {
          const s = backWallSurface(court, pos.x + vel.x * t, zAt(pos.z, vel.z, g, t));
          if (s) {
            tHit = t;
            plane = 'backFar';
            surface = s;
          }
        }
      }
      const dn = court.netY - r - pos.y;
      if (dn >= -TOUCH_EPS) {
        const t = Math.max(0, dn) / vel.y;
        if (t <= tHit && hitsNet(court, pos.x + vel.x * t, zAt(pos.z, vel.z, g, t) - r)) {
          tHit = t;
          plane = 'net';
          surface = 'net';
        }
      }
    }

    pos.x += vel.x * tHit;
    pos.y += vel.y * tHit;
    pos.z = zAt(pos.z, vel.z, g, tHit);
    vel.z -= g * tHit;
    remaining -= tHit;

    if (!plane || !surface) break;
    const m: Material = p[surface];
    let normalSpeed: number;
    switch (plane) {
      case 'ground':
        normalSpeed = -vel.z;
        pos.z = r;
        vel.z = -vel.z * m.restitution;
        vel.x *= m.tangentialKeep;
        vel.y *= m.tangentialKeep;
        if (vel.z < p.rollThreshold) {
          vel.z = 0;
          ball.status = 'rolling';
        }
        break;
      case 'left':
      case 'right':
        normalSpeed = Math.abs(vel.x);
        pos.x = plane === 'left' ? r : W - r;
        vel.x = -vel.x * m.restitution;
        vel.y *= m.tangentialKeep;
        vel.z *= m.tangentialKeep;
        break;
      case 'backNear':
      case 'backFar':
      case 'net':
        normalSpeed = Math.abs(vel.y);
        if (plane === 'backNear') pos.y = r;
        else if (plane === 'backFar') pos.y = L - r;
        else pos.y = vel.y > 0 ? court.netY - r : court.netY + r;
        vel.y = -vel.y * m.restitution;
        vel.x *= m.tangentialKeep;
        vel.z *= m.tangentialKeep;
        break;
    }
    events?.push({ surface, plane, pos: { ...pos }, normalSpeed, t: dt - remaining });
    // Une balle qui roule n'est plus soumise à la gravité pour le reste du pas.
    if (ball.status === 'rolling') g = 0;
  }

  if (!isInsideEnclosure(court, pos.x, pos.y)) {
    ball.status = 'out';
  } else if (ball.status === 'rolling' && Math.hypot(vel.x, vel.y) < p.stopSpeed) {
    vel.x = 0;
    vel.y = 0;
    ball.status = 'stopped';
  }
}

function hitsNet(court: CourtGeometry, x: number, bottomZ: number): boolean {
  return x >= 0 && x <= court.width && bottomZ < netHeightAt(court, x);
}
