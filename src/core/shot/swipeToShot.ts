import { FIXED_DT, type CourtGeometry, type PhysicsParams, type ShotParams } from '../constants';
import { clamp, DEG, lerp, type Vec3 } from '../math/vec3';
import { netHeightAt } from '../physics/court';
import { createBall, stepBall, type ContactEvent } from '../physics/step';

/** Un point du geste : coordonnées écran en px CSS, temps en ms. */
export interface SwipeSample {
  x: number;
  y: number;
  t: number;
}

export interface Swipe {
  points: SwipeSample[];
  /** Hauteur de la zone de jeu en px CSS, pour rendre le geste indépendant de l'écran. */
  viewportHeight: number;
}

/**
 * 'drop'  = amortie : courte et lente.
 * 'smash' = frappe au-dessus de la tête, tendue vers le bas ; demande une balle haute.
 */
export type ShotKind = 'drive' | 'lob' | 'drop' | 'smash';

export interface ShotIntent {
  kind: ShotKind;
  /** Puissance 0–1 à l'intérieur du type de coup. */
  power: number;
  /** Angle latéral (rad) : 0 = droit devant, positif = vers la droite. */
  aim: number;
  /** Mesures brutes du geste, affichées en debug pour le tuning. */
  swipeSpeed: number;
  curvature: number;
}

/**
 * Traduit un geste en intention de coup. null = pas un coup (trop court).
 * Un geste vers le bas n'est un coup (smash) que si `allowDown` est vrai (mode Duo).
 */
export function analyzeSwipe(swipe: Swipe, s: ShotParams, allowDown = false): ShotIntent | null {
  const pts = swipe.points;
  if (pts.length < 2) return null;
  const h = swipe.viewportHeight;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len / h < s.minSwipeLength) return null;
  if (dy >= 0 && !allowDown) return null;

  // Vitesse de lâcher (fin du geste : la sensation de « fouetter ») ou vitesse moyenne,
  // la plus grande des deux : un pouce qui ralentit en fin de geste ne perd pas sa puissance.
  let j = pts.length - 2;
  while (j > 0 && b.t - pts[j].t < s.releaseWindowMs) j--;
  const ref = pts[j];
  const release = (Math.hypot(b.x - ref.x, b.y - ref.y) / h) * (1000 / Math.max(8, b.t - ref.t));
  const average = (len / h) * (1000 / Math.max(8, b.t - a.t));
  const swipeSpeed = Math.max(release, average);
  const raw = clamp((swipeSpeed - s.minSwipeSpeed) / (s.maxSwipeSpeed - s.minSwipeSpeed), 0, 1);

  const curvature = pathCurvature(pts, dx, dy, len);
  const maxAim = s.maxAimDeg * DEG;
  const aim = clamp(Math.atan2(dx, Math.abs(dy)) * s.aimGain, -maxAim, maxAim);
  if (dy >= 0) return { kind: 'smash', power: raw, aim, swipeSpeed, curvature };

  let kind: ShotKind;
  let power: number;
  if (s.lobMode === 'speed') {
    if (raw < s.lobThreshold) {
      kind = 'lob';
      power = s.lobThreshold > 0 ? raw / s.lobThreshold : 0;
    } else {
      kind = 'drive';
      power = s.lobThreshold < 1 ? (raw - s.lobThreshold) / (1 - s.lobThreshold) : 1;
    }
  } else {
    kind = curvature >= s.hookCurvature ? 'lob' : 'drive';
    power = raw;
  }
  return { kind, power, aim, swipeSpeed, curvature };
}

/** Écart maximal du tracé à sa corde, rapporté à la longueur de la corde. */
function pathCurvature(pts: SwipeSample[], dx: number, dy: number, len: number): number {
  const a = pts[0];
  let max = 0;
  for (const p of pts) {
    const d = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
    if (d > max) max = d;
  }
  return max / len;
}

/**
 * Vitesse initiale de la balle pour une intention de coup frappée depuis `origin`.
 * `forward` = +1 pour frapper vers le fond adverse (y croissant, joueur du bas),
 * −1 pour le camp d'en face : on calcule dans le terrain retourné, qui est symétrique.
 */
export function shotVelocity(
  intent: ShotIntent,
  origin: Vec3,
  s: ShotParams,
  p: PhysicsParams,
  court: CourtGeometry,
  forward: 1 | -1 = 1,
): Vec3 {
  if (forward === -1) {
    const v = shotVelocity(intent, { x: origin.x, y: court.length - origin.y, z: origin.z }, s, p, court, 1);
    return { x: v.x, y: -v.y, z: v.z };
  }
  let speed: number;
  let elev: number;
  if (intent.kind === 'lob') {
    speed = lerp(s.lobMinSpeed, s.lobMaxSpeed, intent.power);
    elev = s.lobElevationDeg * DEG;
  } else if (intent.kind === 'drop') {
    speed = lerp(s.dropMinSpeed, s.dropMaxSpeed, intent.power);
    elev = Math.max(s.dropElevationDeg * DEG, solveDriveElevation(origin, speed, intent.aim, s, p, court));
  } else if (intent.kind === 'smash') {
    // Le smash le plus plongeant qui passe encore le filet : plus on est près et haut, plus il tue.
    speed = lerp(s.smashMinSpeed, s.smashMaxSpeed, intent.power);
    elev = solveElevation(origin, speed, intent.aim, -s.smashMaxDownDeg * DEG, 10 * DEG, s.smashNetClearance, p, court);
  } else {
    speed = lerp(s.driveMinSpeed, s.driveMaxSpeed, intent.power);
    elev = solveDriveElevation(origin, speed, intent.aim, s, p, court);
  }
  return directionVelocity(speed, elev, intent.aim);
}

function directionVelocity(speed: number, elev: number, aim: number): Vec3 {
  const horiz = speed * Math.cos(elev);
  return { x: horiz * Math.sin(aim), y: horiz * Math.cos(aim), z: speed * Math.sin(elev) };
}

/**
 * Aide au tir : plus petit angle de départ qui fait passer le filet avec la marge voulue,
 * calculé avec la vraie physique (dichotomie). Le joueur choisit direction et puissance,
 * le jeu lui évite le filet bête — mais une balle trop puissante peut toujours sortir.
 */
export function solveDriveElevation(
  origin: Vec3,
  speed: number,
  aim: number,
  s: ShotParams,
  p: PhysicsParams,
  court: CourtGeometry,
): number {
  return solveElevation(origin, speed, aim, s.driveMinElevationDeg * DEG, s.driveMaxElevationDeg * DEG, s.netClearance, p, court);
}

/** Plus petit angle de départ entre `lo` et `hi` (radians) qui passe le filet avec la marge `clearance`. */
export function solveElevation(
  origin: Vec3,
  speed: number,
  aim: number,
  lo: number,
  hi: number,
  clearance: number,
  p: PhysicsParams,
  court: CourtGeometry,
): number {
  if (origin.y >= court.netY) return lo;
  if (clearsNet(origin, directionVelocity(speed, lo, aim), clearance, p, court)) return lo;
  if (!clearsNet(origin, directionVelocity(speed, hi, aim), clearance, p, court)) return hi;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (clearsNet(origin, directionVelocity(speed, mid, aim), clearance, p, court)) hi = mid;
    else lo = mid;
  }
  return hi;
}

function clearsNet(origin: Vec3, vel: Vec3, clearance: number, p: PhysicsParams, court: CourtGeometry): boolean {
  // Terrain sans filet : on veut la hauteur de passage, pas le rebond dans le filet.
  const netless: CourtGeometry = { ...court, netHeightCenter: -10, netHeightPost: -10 };
  const ball = createBall(origin, vel);
  const dt = FIXED_DT * p.timeScale;
  const maxSteps = Math.ceil(3 / dt);
  const events: ContactEvent[] = [];
  let prevY = ball.pos.y;
  let prevZ = ball.pos.z;
  let prevX = ball.pos.x;
  for (let i = 0; i < maxSteps; i++) {
    stepBall(ball, dt, p, netless, events);
    if (events.length > 0 || ball.status !== 'flying') return false;
    if (ball.pos.y >= court.netY) {
      const f = (court.netY - prevY) / (ball.pos.y - prevY);
      const z = prevZ + (ball.pos.z - prevZ) * f;
      const x = prevX + (ball.pos.x - prevX) * f;
      return z - p.ballRadius >= netHeightAt(court, x) + clearance;
    }
    prevY = ball.pos.y;
    prevZ = ball.pos.z;
    prevX = ball.pos.x;
  }
  return false;
}
