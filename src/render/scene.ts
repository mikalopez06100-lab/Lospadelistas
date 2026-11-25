import { FIXED_DT, type CourtGeometry, type Tuning, type ViewParams } from '../core/constants';
import { clamp, horizontalSpeed, lengthV3, lerp, type Vec3 } from '../core/math/vec3';
import { netHeightAt } from '../core/physics/court';
import { predict, type Prediction } from '../core/physics/predict';
import { createBall, type BallState, type ContactEvent } from '../core/physics/step';
import type { ShotIntent } from '../core/shot/swipeToShot';
import { drawNearGlass } from './courtLayer';
import { groundCircle, line3 } from './draw';
import type { Fx } from './fx';
import { drawPlayer, type PlayerPose } from './player';
import type { Projection, ScreenPoint } from './projection';

export interface ShotPreview {
  intent: ShotIntent;
  origin: Vec3;
  vel: Vec3;
}

export interface ScenePlayer extends PlayerPose {
  /** Anneau au sol : la balle est frappable maintenant. */
  hittable: boolean;
  /** Point de frappe prévu (affiché en debug). */
  target: Vec3 | null;
}

export interface SceneInput {
  ball: BallState | null;
  prevPos: Vec3;
  lastContact: ContactEvent | null;
  tick: number;
  /** Fraction du pas fixe écoulée depuis le dernier tick (interpolation d'affichage). */
  alpha: number;
  tuning: Tuning;
  court: CourtGeometry;
  players: ScenePlayer[];
  debug: boolean;
  preview: ShotPreview | null;
  fps: number;
  /** Lignes supplémentaires du panneau debug. */
  debugLines: string[];
  /** Dernières positions de la balle, de la plus ancienne à la plus récente (traînée). */
  trail: readonly Vec3[];
  /** Ralenti « Rebote » : traînée et balle en surbrillance. */
  glow: boolean;
  /** Point de chute prévu de la balle dans ton camp (repère de placement), ou null. */
  landing: Vec3 | null;
}

const tmp: ScreenPoint = { x: 0, y: 0 };
const drawPos: Vec3 = { x: 0, y: 0, z: 0 };

export function drawScene(
  ctx: CanvasRenderingContext2D,
  proj: Projection,
  courtLayer: HTMLCanvasElement,
  fx: Fx,
  s: SceneInput,
  widthCss: number,
  heightCss: number,
): void {
  const { court, tuning, ball } = s;
  const view = tuning.view;
  ctx.drawImage(courtLayer, 0, 0, widthCss, heightCss);

  if (ball) {
    drawPos.x = lerp(s.prevPos.x, ball.pos.x, s.alpha);
    drawPos.y = lerp(s.prevPos.y, ball.pos.y, s.alpha);
    drawPos.z = lerp(s.prevPos.z, ball.pos.z, s.alpha);
  }
  const dtPhys = FIXED_DT * tuning.physics.timeScale;
  const prediction =
    s.debug && ball && (ball.status === 'flying' || ball.status === 'rolling')
      ? predict(ball, tuning.physics, court, dtPhys, 4, 3)
      : null;
  const previewPrediction =
    s.debug && s.preview ? predict(createBall(s.preview.origin, s.preview.vel), tuning.physics, court, dtPhys, 4, 3) : null;

  if (prediction) drawPrediction(ctx, proj, prediction, 'rgba(255, 235, 80, 0.85)');
  if (previewPrediction) drawPrediction(ctx, proj, previewPrediction, 'rgba(255, 140, 60, 0.9)');
  if (s.landing) {
    const pulse = 0.6 + 0.4 * Math.sin(s.tick * 0.25);
    ctx.strokeStyle = `rgba(228, 242, 58, ${0.85 * pulse})`;
    ctx.lineWidth = 2;
    groundCircle(ctx, proj, s.landing.x, s.landing.y, 0.45);
    ctx.stroke();
    ctx.fillStyle = 'rgba(228, 242, 58, 0.25)';
    groundCircle(ctx, proj, s.landing.x, s.landing.y, 0.18);
    ctx.fill();
  }
  if (ball) drawTrail(ctx, proj, s.trail, view, s.glow);
  for (const pl of s.players) {
    if (pl.hittable) drawHitRing(ctx, proj, pl, s.tick);
    if (s.debug && pl.target) drawTargetMark(ctx, proj, pl.target);
  }

  // Ordre de dessin : du fond vers l'avant, le filet entre les deux camps.
  const items: { y: number; draw: () => void }[] = s.players.map((pl) => ({
    y: pl.y,
    draw: () => drawPlayer(ctx, proj, pl),
  }));
  if (ball) items.push({ y: drawPos.y, draw: () => drawBall(ctx, proj, view, drawPos, s.glow) });
  items.sort((a, b) => b.y - a.y);
  for (const it of items) if (it.y > court.netY) it.draw();
  drawNet(ctx, proj, court);
  for (const it of items) if (it.y <= court.netY) it.draw();
  drawNearGlass(ctx, proj, court);
  fx.draw(ctx, proj, court);

  if (s.debug) drawDebugText(ctx, s, prediction, heightCss);
}

/** Traînée : la vitesse de la balle se lit d'un coup d'œil, même quand elle est petite au fond. */
function drawTrail(ctx: CanvasRenderingContext2D, proj: Projection, trail: readonly Vec3[], view: ViewParams, glow: boolean): void {
  const n = trail.length;
  for (let i = 0; i < n; i++) {
    const p = trail[i];
    const f = (i + 1) / (n + 1);
    proj.toScreen(p.x, p.y, p.z, tmp);
    const r = Math.max(1.5, view.ballVisualRadius * proj.pxPerMeter(p.y) * (1 + Math.max(0, p.z) * view.heightSizeGain)) * (0.35 + 0.6 * f);
    ctx.beginPath();
    ctx.arc(tmp.x, tmp.y, r, 0, Math.PI * 2);
    ctx.fillStyle = glow ? `rgba(255, 255, 255, ${0.55 * f})` : `rgba(228, 242, 58, ${0.3 * f})`;
    ctx.fill();
  }
}

function drawBall(ctx: CanvasRenderingContext2D, proj: Projection, view: ViewParams, pos: Vec3, glow = false): void {
  // Ombre : au sol, légèrement décalée par une lumière oblique, plus pâle quand la balle monte.
  const shadowAlpha = 0.5 * clamp(1 - pos.z / 8, 0.35, 1);
  ctx.fillStyle = `rgba(0, 0, 0, ${shadowAlpha})`;
  groundCircle(ctx, proj, pos.x + pos.z * view.shadowOffsetX, pos.y + pos.z * view.shadowOffsetY, view.ballVisualRadius * (1 + pos.z * 0.05));
  ctx.fill();

  proj.toScreen(pos.x, pos.y, pos.z, tmp);
  const r = Math.max(2.5, view.ballVisualRadius * proj.pxPerMeter(pos.y) * (1 + Math.max(0, pos.z) * view.heightSizeGain));
  if (glow) {
    ctx.beginPath();
    ctx.arc(tmp.x, tmp.y, r * 2.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(228, 242, 58, 0.3)';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(tmp.x, tmp.y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#e4f23a';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(40, 50, 0, 0.8)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(tmp.x - r * 0.3, tmp.y - r * 0.3, r * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.fill();
}

function drawNet(ctx: CanvasRenderingContext2D, proj: Projection, court: CourtGeometry): void {
  const y = court.netY;
  const W = court.width;
  ctx.beginPath();
  proj.toScreen(0, y, 0, tmp);
  ctx.moveTo(tmp.x, tmp.y);
  for (let i = 0; i <= 10; i++) {
    const x = (i / 10) * W;
    proj.toScreen(x, y, netHeightAt(court, x), tmp);
    ctx.lineTo(tmp.x, tmp.y);
  }
  proj.toScreen(W, y, 0, tmp);
  ctx.lineTo(tmp.x, tmp.y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(15, 20, 30, 0.45)';
  ctx.fill();
  ctx.beginPath();
  for (let i = 0; i <= 10; i++) {
    const x = (i / 10) * W;
    proj.toScreen(x, y, netHeightAt(court, x), tmp);
    if (i === 0) ctx.moveTo(tmp.x, tmp.y);
    else ctx.lineTo(tmp.x, tmp.y);
  }
  ctx.strokeStyle = '#f2f2f2';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.beginPath();
  line3(ctx, proj, 0, y, 0, 0, y, court.netHeightPost + 0.05);
  line3(ctx, proj, W, y, 0, W, y, court.netHeightPost + 0.05);
  ctx.strokeStyle = '#2b3440';
  ctx.lineWidth = 4;
  ctx.stroke();
}

function drawHitRing(ctx: CanvasRenderingContext2D, proj: Projection, pl: ScenePlayer, tick: number): void {
  const pulse = 0.75 + 0.25 * Math.sin(tick * 0.4);
  ctx.strokeStyle = `rgba(120, 255, 150, ${0.9 * pulse})`;
  ctx.lineWidth = 3;
  groundCircle(ctx, proj, pl.x, pl.y, 0.9);
  ctx.stroke();
}

function drawTargetMark(ctx: CanvasRenderingContext2D, proj: Projection, p: Vec3): void {
  proj.toScreen(p.x, p.y, p.z, tmp);
  ctx.strokeStyle = 'rgba(120, 255, 150, 0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(tmp.x, tmp.y, 7, 0, Math.PI * 2);
  ctx.stroke();
}

function drawPrediction(ctx: CanvasRenderingContext2D, proj: Projection, pred: Prediction, color: string): void {
  const pts = pred.points;
  // Trace au sol : aide à lire la hauteur.
  ctx.beginPath();
  pts.forEach((p, i) => {
    proj.toScreen(p.x, p.y, 0, tmp);
    if (i === 0) ctx.moveTo(tmp.x, tmp.y);
    else ctx.lineTo(tmp.x, tmp.y);
  });
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  pts.forEach((p, i) => {
    proj.toScreen(p.x, p.y, p.z, tmp);
    if (i === 0) ctx.moveTo(tmp.x, tmp.y);
    else ctx.lineTo(tmp.x, tmp.y);
  });
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([]);

  for (const c of pred.contacts) {
    proj.toScreen(c.pos.x, c.pos.y, c.pos.z, tmp);
    ctx.beginPath();
    if (c.surface === 'ground') ctx.arc(tmp.x, tmp.y, 4, 0, Math.PI * 2);
    else {
      ctx.moveTo(tmp.x - 5, tmp.y - 5);
      ctx.lineTo(tmp.x + 5, tmp.y + 5);
      ctx.moveTo(tmp.x + 5, tmp.y - 5);
      ctx.lineTo(tmp.x - 5, tmp.y + 5);
    }
    ctx.strokeStyle = c.surface === 'glass' ? '#7fe3ff' : c.surface === 'ground' ? '#ffffff' : '#ffb15c';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

const SURFACE_FR = { ground: 'sol', glass: 'vitre', fence: 'grillage', net: 'filet' } as const;
const STATUS_FR = { flying: 'en vol', rolling: 'roule', stopped: 'arrêtée', out: 'sortie' } as const;

/** En bas de l'écran : le haut doit rester dégagé, c'est là que la balle tape la vitre adverse. */
function drawDebugText(ctx: CanvasRenderingContext2D, s: SceneInput, pred: Prediction | null, heightCss: number): void {
  const lines: string[] = [`${s.fps.toFixed(0)} fps · tick ${s.tick}`, ...s.debugLines];
  const b = s.ball;
  if (b) {
    lines.push(
      `v ${(lengthV3(b.vel) * 3.6).toFixed(0)} km/h · vh ${horizontalSpeed(b.vel).toFixed(1)} · vz ${b.vel.z.toFixed(1)} m/s`,
      `z ${b.pos.z.toFixed(2)} m · y ${b.pos.y.toFixed(1)} · ${STATUS_FR[b.status]}`,
    );
  }
  const c = s.lastContact;
  if (c) lines.push(`dernier impact : ${SURFACE_FR[c.surface]} à ${(c.normalSpeed * 3.6).toFixed(0)} km/h`);
  if (pred) lines.push(`prévu : ${pred.contacts.slice(0, 4).map((e) => SURFACE_FR[e.surface]).join(' → ') || '—'}`);
  const p = s.preview;
  if (p) {
    const elev = (Math.atan2(p.vel.z, horizontalSpeed(p.vel)) * 180) / Math.PI;
    lines.push(
      `swipe : ${p.intent.kind === 'lob' ? 'LOB' : 'TENDU'} · puissance ${(p.intent.power * 100).toFixed(0)} %`,
      `vitesse geste ${p.intent.swipeSpeed.toFixed(2)} · courbure ${p.intent.curvature.toFixed(2)}`,
      `départ ${(lengthV3(p.vel) * 3.6).toFixed(0)} km/h · ${elev.toFixed(1)}° · visée ${((p.intent.aim * 180) / Math.PI).toFixed(0)}°`,
    );
  }
  ctx.font = '11px ui-monospace, Menlo, monospace';
  const x = 10;
  const lh = 14;
  let y = heightCss - 10 - (lines.length - 1) * lh;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 12;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(x - 6, y - 12, w, lines.length * lh + 6);
  ctx.fillStyle = '#e8f0f8';
  for (const l of lines) {
    ctx.fillText(l, x, y);
    y += lh;
  }
}
