import type { Projection, ScreenPoint } from './projection';

const tmp: ScreenPoint = { x: 0, y: 0 };

/** Polygone défini par des points 3D (x, y, z) projetés. */
export function pathPoly(ctx: CanvasRenderingContext2D, proj: Projection, pts: readonly (readonly [number, number, number])[]): void {
  ctx.beginPath();
  pts.forEach(([x, y, z], i) => {
    proj.toScreen(x, y, z, tmp);
    if (i === 0) ctx.moveTo(tmp.x, tmp.y);
    else ctx.lineTo(tmp.x, tmp.y);
  });
  ctx.closePath();
}

export function line3(
  ctx: CanvasRenderingContext2D,
  proj: Projection,
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number,
): void {
  proj.toScreen(x1, y1, z1, tmp);
  ctx.moveTo(tmp.x, tmp.y);
  proj.toScreen(x2, y2, z2, tmp);
  ctx.lineTo(tmp.x, tmp.y);
}

/** Cercle posé au sol (plan z = 0), rayon en mètres, aplati par la perspective. */
export function groundCircle(ctx: CanvasRenderingContext2D, proj: Projection, x: number, y: number, radius: number): void {
  proj.toScreen(x, y, 0, tmp);
  ctx.beginPath();
  ctx.ellipse(tmp.x, tmp.y, Math.max(0.5, radius * proj.pxPerMeter(y)), Math.max(0.5, radius * proj.depthPxPerMeter(y)), 0, 0, Math.PI * 2);
}
