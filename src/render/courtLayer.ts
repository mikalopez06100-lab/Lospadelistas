import type { CourtGeometry } from '../core/constants';
import { line3, pathPoly } from './draw';
import type { Projection } from './projection';

export const COLORS = {
  background: '#0b1622',
  floor: '#1f5fa8',
  floorFar: '#1b5698',
  lines: 'rgba(255,255,255,0.9)',
  glassFill: 'rgba(170, 220, 255, 0.10)',
  glassEdge: 'rgba(205, 238, 255, 0.55)',
  fence: 'rgba(200, 210, 220, 0.16)',
  post: '#2b3440',
};

/**
 * Tout ce qui ne bouge pas est dessiné une fois dans un canvas hors écran,
 * puis copié à chaque image : c'est le poste le plus coûteux économisé.
 */
export function renderCourtLayer(
  proj: Projection,
  court: CourtGeometry,
  widthCss: number,
  heightCss: number,
  dpr: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(widthCss * dpr);
  canvas.height = Math.round(heightCss * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const { width: W, length: L, netY } = court;
  const hg = court.backGlassHeight;
  const hs = court.sideGlassHeight;
  const hf = court.fenceHeight;
  const sd = court.sideGlassDepth;

  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, widthCss, heightCss);

  // Sol.
  ctx.fillStyle = COLORS.floorFar;
  pathPoly(ctx, proj, [[0, netY, 0], [W, netY, 0], [W, L, 0], [0, L, 0]]);
  ctx.fill();
  ctx.fillStyle = COLORS.floor;
  pathPoly(ctx, proj, [[0, 0, 0], [W, 0, 0], [W, netY, 0], [0, netY, 0]]);
  ctx.fill();

  // Lignes : service et ligne centrale de service.
  const s1 = netY - court.serviceLineFromNet;
  const s2 = netY + court.serviceLineFromNet;
  ctx.strokeStyle = COLORS.lines;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  line3(ctx, proj, 0, s1, 0, W, s1, 0);
  line3(ctx, proj, 0, s2, 0, W, s2, 0);
  line3(ctx, proj, W / 2, s1, 0, W / 2, s2, 0);
  line3(ctx, proj, 0, 0, 0, W, 0, 0);
  line3(ctx, proj, 0, L, 0, W, L, 0);
  line3(ctx, proj, 0, 0, 0, 0, L, 0);
  line3(ctx, proj, W, 0, 0, W, L, 0);
  ctx.stroke();

  // Grillage latéral (entre les vitres latérales).
  ctx.strokeStyle = COLORS.fence;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const x of [0, W]) {
    for (let y = sd; y <= L - sd + 1e-6; y += 0.5) line3(ctx, proj, x, y, 0, x, y, hf);
    for (let z = 0; z <= hf + 1e-6; z += 0.5) line3(ctx, proj, x, sd, z, x, L - sd, z);
  }
  ctx.stroke();

  // Vitres latérales (4 m depuis chaque fond) et vitre de fond adverse.
  const glassPanes: (readonly [number, number, number])[][] = [
    [[0, L - sd, 0], [0, L, 0], [0, L, hs], [0, L - sd, hs]],
    [[W, L - sd, 0], [W, L, 0], [W, L, hs], [W, L - sd, hs]],
    [[0, L, 0], [W, L, 0], [W, L, hg], [0, L, hg]],
    [[0, 0, 0], [0, sd, 0], [0, sd, hs], [0, 0, hs]],
    [[W, 0, 0], [W, sd, 0], [W, sd, hs], [W, 0, hs]],
  ];
  for (const pane of glassPanes) drawGlass(ctx, proj, pane);
  // Montants : un tous les 2 m sur le fond adverse.
  ctx.strokeStyle = COLORS.glassEdge;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 2; x < W; x += 2) line3(ctx, proj, x, L, 0, x, L, hg);
  ctx.stroke();

  return canvas;
}

function drawGlass(ctx: CanvasRenderingContext2D, proj: Projection, pts: readonly (readonly [number, number, number])[]): void {
  ctx.fillStyle = COLORS.glassFill;
  pathPoly(ctx, proj, pts);
  ctx.fill();
  ctx.strokeStyle = COLORS.glassEdge;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/** Vitre de fond côté joueur : dessinée par-dessus la scène, très discrète pour ne rien masquer. */
export function drawNearGlass(ctx: CanvasRenderingContext2D, proj: Projection, court: CourtGeometry): void {
  ctx.strokeStyle = 'rgba(205, 238, 255, 0.35)';
  ctx.lineWidth = 1.5;
  pathPoly(ctx, proj, [[0, 0, 0], [court.width, 0, 0], [court.width, 0, court.backGlassHeight], [0, 0, court.backGlassHeight]]);
  ctx.stroke();
}
