import type { CourtGeometry } from '../core/constants';
import { clamp } from '../core/math/vec3';
import type { ContactEvent } from '../core/physics/step';
import { groundCircle, pathPoly } from './draw';
import type { Projection, ScreenPoint } from './projection';

interface Effect {
  ev: ContactEvent;
  age: number;
  life: number;
  /** 0–1, selon la vitesse d'impact. */
  strength: number;
}

const tmp: ScreenPoint = { x: 0, y: 0 };
const RING_SEGMENTS = 20;

/**
 * Effets d'impact. La vitre a droit au plus beau : flash du panneau + onde dans le plan de la vitre.
 * C'est le rebond qu'on veut rendre satisfaisant.
 */
export class Fx {
  private items: Effect[] = [];

  add(ev: ContactEvent): void {
    const strength = clamp(ev.normalSpeed / 15, 0.15, 1);
    const life = ev.surface === 'glass' ? 0.45 : 0.3;
    this.items.push({ ev, age: 0, life, strength });
    if (this.items.length > 32) this.items.shift();
  }

  update(dtReal: number): void {
    for (const it of this.items) it.age += dtReal;
    this.items = this.items.filter((it) => it.age < it.life);
  }

  draw(ctx: CanvasRenderingContext2D, proj: Projection, court: CourtGeometry): void {
    for (const it of this.items) {
      const f = it.age / it.life;
      const a = (1 - f) * it.strength;
      const { pos, surface, plane } = it.ev;
      if (surface === 'glass') {
        ctx.fillStyle = `rgba(190, 240, 255, ${0.35 * a})`;
        pathPoly(ctx, proj, glassPanel(court, plane, pos.x, pos.y));
        ctx.fill();
        ctx.strokeStyle = `rgba(230, 250, 255, ${a})`;
        ctx.lineWidth = 2.5;
        wallRing(ctx, proj, plane, pos.x, pos.y, pos.z, 0.15 + f * 0.9 * (0.5 + it.strength));
        ctx.stroke();
      } else if (surface === 'ground') {
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.6 * a})`;
        ctx.lineWidth = 1.5;
        groundCircle(ctx, proj, pos.x, pos.y, 0.1 + f * 0.5);
        ctx.stroke();
      } else {
        ctx.strokeStyle = `rgba(255, 220, 150, ${0.7 * a})`;
        ctx.lineWidth = 2;
        wallRing(ctx, proj, plane, pos.x, pos.y, pos.z, 0.1 + f * 0.4);
        ctx.stroke();
      }
    }
  }
}

/** Panneau de 2 m (fond) ou bloc latéral contenant le point d'impact. */
function glassPanel(court: CourtGeometry, plane: ContactEvent['plane'], x: number, y: number): [number, number, number][] {
  if (plane === 'backFar' || plane === 'backNear') {
    const yy = plane === 'backFar' ? court.length : 0;
    const x0 = Math.min(court.width - 2, Math.floor(x / 2) * 2);
    const h = court.backGlassHeight;
    return [[x0, yy, 0], [x0 + 2, yy, 0], [x0 + 2, yy, h], [x0, yy, h]];
  }
  const xx = plane === 'left' ? 0 : court.width;
  const y0 = y < court.netY ? 0 : court.length - court.sideGlassDepth;
  const y1 = y0 + court.sideGlassDepth;
  const h = court.sideGlassHeight;
  return [[xx, y0, 0], [xx, y1, 0], [xx, y1, h], [xx, y0, h]];
}

/** Cercle dans le plan de la paroi touchée. */
function wallRing(ctx: CanvasRenderingContext2D, proj: Projection, plane: ContactEvent['plane'], x: number, y: number, z: number, radius: number): void {
  ctx.beginPath();
  for (let i = 0; i <= RING_SEGMENTS; i++) {
    const a = (i / RING_SEGMENTS) * Math.PI * 2;
    const u = Math.cos(a) * radius;
    const v = Math.max(-z, Math.sin(a) * radius);
    if (plane === 'left' || plane === 'right') proj.toScreen(x, y + u, z + v, tmp);
    else proj.toScreen(x + u, y, z + v, tmp);
    if (i === 0) ctx.moveTo(tmp.x, tmp.y);
    else ctx.lineTo(tmp.x, tmp.y);
  }
}
