import { clamp, lerp } from '../core/math/vec3';
import { groundCircle } from './draw';
import type { Projection, ScreenPoint } from './projection';

/**
 * Joueur dessiné en « squelette » : chaque articulation est un point 3D (en mètres, dans le
 * repère du terrain) projeté à l'écran. La perspective, la taille au fond du court et l'ordre
 * de dessin restent donc cohérents avec la balle, sans aucune image à charger.
 */
export interface PlayerPose {
  x: number;
  y: number;
  /** +1 = regarde vers le fond adverse (on le voit de dos), −1 = regarde vers nous. */
  facing: 1 | -1;
  shirt: string;
  /** Direction de déplacement (normalisée) et vitesse en m/s. */
  moveX: number;
  moveY: number;
  speed: number;
  /** Phase du cycle de course (radians), avancée avec la distance parcourue. */
  runPhase: number;
  /** Avancement du geste de frappe : 0 → 1 pendant le geste, null hors frappe. */
  swing: number | null;
  /** 0–1 : bras armé en arrière, quand la balle arrive. */
  prep: number;
  /** Petit balancement au repos (radians). */
  idlePhase: number;
  /** Repère au-dessus de la tête : c'est toi. */
  marker: boolean;
  /** Grossissement visuel (1 = taille réelle). */
  scale: number;
}

const SKIN = '#f1c7a5';
const SHORTS = '#18222f';
const HAIR = '#3a2a22';
const SHOE = '#f4f6f8';
const PALA = '#20252c';

/** Position de la main et de la tête de pala, relative au joueur : [latéral, avant, hauteur]. */
type ArmPose = readonly [number, number, number, number, number, number];
const READY: ArmPose = [0.34, 0.22, 1.02, 0.42, 0.42, 1.34];
const BACK: ArmPose = [0.52, -0.28, 0.98, 0.8, -0.56, 1.12];
const CONTACT: ArmPose = [0.55, 0.42, 1.0, 0.74, 0.8, 1.02];
const FOLLOW: ArmPose = [-0.08, 0.46, 1.48, -0.42, 0.56, 1.8];

function mix(a: ArmPose, b: ArmPose, t: number, out: number[]): void {
  for (let i = 0; i < 6; i++) out[i] = lerp(a[i], b[i], t);
}

const arm: number[] = [0, 0, 0, 0, 0, 0];
const a: ScreenPoint = { x: 0, y: 0 };
const b: ScreenPoint = { x: 0, y: 0 };

function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

export function drawPlayer(ctx: CanvasRenderingContext2D, proj: Projection, p: PlayerPose): void {
  const S = p.scale;
  const k = proj.pxPerMeter(p.y) * S;
  const f = p.facing;
  // Point du corps → écran : `lat` vers la droite du joueur, `fwd` vers l'avant, `z` en hauteur.
  const at = (lat: number, fwd: number, z: number, out: ScreenPoint) => proj.toScreen(p.x + lat * f * S, p.y + fwd * f * S, z * S, out);
  const limb = (color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, width * k);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };

  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
  groundCircle(ctx, proj, p.x, p.y, 0.36 * S);
  ctx.fill();
  ctx.lineCap = 'round';

  const running = clamp(p.speed / 2.5, 0, 1);
  const bob = running > 0 ? Math.abs(Math.sin(p.runPhase)) * 0.05 * running : Math.sin(p.idlePhase) * 0.012;
  // Jambes fléchies quand le joueur attend la balle ou arme son geste.
  const crouch = 0.05 + 0.07 * p.prep;
  const hipZ = 0.86 - crouch + bob;
  const shoulderZ = hipZ + 0.52;

  // Jambes : les pieds alternent le long de la direction de course.
  for (const side of [-1, 1]) {
    const stride = Math.sin(p.runPhase + (side > 0 ? 0 : Math.PI)) * running;
    const lift = Math.max(0, Math.cos(p.runPhase + (side > 0 ? 0 : Math.PI))) * 0.14 * running;
    const footX = p.x + (side * 0.13 * f + p.moveX * stride * 0.3) * S;
    const footY = p.y + p.moveY * stride * 0.3 * S;
    at(side * 0.1, 0, hipZ, a);
    proj.toScreen(footX, footY, (lift + 0.04) * S, b);
    limb(SKIN, 0.12);
    // Chaussure.
    ctx.fillStyle = SHOE;
    ctx.beginPath();
    ctx.arc(b.x, b.y, Math.max(1.2, 0.075 * k), 0, Math.PI * 2);
    ctx.fill();
  }
  // Short.
  at(0, 0, hipZ - 0.16, a);
  at(0, 0, hipZ + 0.02, b);
  limb(SHORTS, 0.34);

  // Bras libre, dessiné avant le buste pour passer derrière.
  const freeSwing = Math.sin(p.runPhase) * 0.18 * running;
  at(-0.22, 0, shoulderZ - 0.04, a);
  at(-0.34, 0.1 + freeSwing, shoulderZ - 0.42, b);
  limb(SKIN, 0.09);

  // Buste.
  at(0, 0, hipZ + 0.06, a);
  at(0, 0, shoulderZ, b);
  limb(p.shirt, 0.36);

  // Bras de frappe et pala.
  if (p.swing !== null) {
    const s = clamp(p.swing, 0, 1);
    if (s < 0.35) mix(BACK, CONTACT, ease(s / 0.35), arm);
    else if (s < 0.7) mix(CONTACT, FOLLOW, ease((s - 0.35) / 0.35), arm);
    else mix(FOLLOW, READY, ease((s - 0.7) / 0.3), arm);
  } else {
    mix(READY, BACK, ease(p.prep), arm);
  }
  at(0.2, 0, shoulderZ - 0.03, a);
  at(arm[0], arm[1], arm[2] - crouch, b);
  limb(SKIN, 0.09);
  a.x = b.x;
  a.y = b.y;
  at(arm[3], arm[4], arm[5] - crouch, b);
  limb(PALA, 0.045);
  ctx.beginPath();
  ctx.arc(b.x, b.y, Math.max(2, 0.135 * k), 0, Math.PI * 2);
  ctx.fillStyle = PALA;
  ctx.fill();
  ctx.lineWidth = Math.max(1, 0.03 * k);
  ctx.strokeStyle = p.shirt;
  ctx.stroke();

  // Tête : de dos on voit les cheveux, de face le visage sous une frange.
  at(0, 0, shoulderZ + 0.2, a);
  const headR = Math.max(2, 0.135 * k);
  ctx.beginPath();
  ctx.arc(a.x, a.y, headR, 0, Math.PI * 2);
  ctx.fillStyle = f === 1 ? HAIR : SKIN;
  ctx.fill();
  if (f === -1) {
    ctx.beginPath();
    ctx.arc(a.x, a.y, headR, Math.PI, Math.PI * 2);
    ctx.fillStyle = HAIR;
    ctx.fill();
  }

  if (p.marker) {
    const top = a.y - headR - 5;
    ctx.beginPath();
    ctx.moveTo(a.x, top);
    ctx.lineTo(a.x - 6, top - 9);
    ctx.lineTo(a.x + 6, top - 9);
    ctx.closePath();
    ctx.fillStyle = '#e4f23a';
    ctx.fill();
  }
  ctx.lineCap = 'butt';
}
