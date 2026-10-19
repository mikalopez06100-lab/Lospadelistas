import type { CourtGeometry, ViewParams } from '../core/constants';

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface Margins {
  top: number;
  bottom: number;
  side: number;
}

/**
 * Projection 2.5D : caméra derrière le fond du joueur, à (W/2, −camDistance, camHeight),
 * regard horizontal vers +y. Les verticales restent verticales à l'écran, le fond est
 * légèrement rétréci, et la hauteur d'un objet le fait monter à l'écran — l'ombre au sol,
 * elle, reste à sa place : c'est l'écart balle/ombre qui rend la hauteur lisible.
 * La projection est ensuite cadrée automatiquement pour remplir l'écran.
 */
export class Projection {
  scale = 1;
  offX = 0;
  offY = 0;

  constructor(
    private view: ViewParams,
    private court: CourtGeometry,
  ) {}

  /** Recalcule le cadrage pour une zone de jeu de `width` × `height` px CSS. */
  fit(width: number, height: number, m: Margins): void {
    const { width: W, length: L, backGlassHeight: hg } = this.court;
    const pts: [number, number, number][] = [
      [0, 0, 0],
      [W, 0, 0],
      [0, L, 0],
      [W, L, 0],
      [0, L, hg],
      [W, L, hg],
      [0, 0, hg],
      [W, 0, hg],
    ];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, y, z] of pts) {
      const nx = this.normX(x, y);
      const ny = this.normY(y, z);
      minX = Math.min(minX, nx);
      maxX = Math.max(maxX, nx);
      minY = Math.min(minY, ny);
      maxY = Math.max(maxY, ny);
    }
    const availW = Math.max(1, width - 2 * m.side);
    const availH = Math.max(1, height - m.top - m.bottom);
    this.scale = Math.min(availW / (maxX - minX), availH / (maxY - minY));
    this.offX = width / 2;
    this.offY = m.top + (availH - (maxY - minY) * this.scale) / 2 - minY * this.scale;
  }

  private normX(x: number, y: number): number {
    return (x - this.court.width / 2) / (y + this.view.camDistance);
  }

  private normY(y: number, z: number): number {
    return (this.view.camHeight - z) / (y + this.view.camDistance);
  }

  toScreen(x: number, y: number, z: number, out: ScreenPoint = { x: 0, y: 0 }): ScreenPoint {
    out.x = this.normX(x, y) * this.scale + this.offX;
    out.y = this.normY(y, z) * this.scale + this.offY;
    return out;
  }

  /** Pixels par mètre à la profondeur y (pour dimensionner balle, ombre, joueurs). */
  pxPerMeter(y: number): number {
    return this.scale / (y + this.view.camDistance);
  }

  /** Pixels par mètre de profondeur au sol à la profondeur y (raccourci de perspective). */
  depthPxPerMeter(y: number): number {
    const d = y + this.view.camDistance;
    return (this.scale * this.view.camHeight) / (d * d);
  }

  /** Abscisse terrain correspondant à l'abscisse écran `sx`, à la profondeur y. */
  courtXAt(sx: number, y: number): number {
    return this.court.width / 2 + ((sx - this.offX) / this.scale) * (y + this.view.camDistance);
  }
}
