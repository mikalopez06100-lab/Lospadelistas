import { FIXED_DT, type CourtGeometry, type Tuning } from '../core/constants';
import { lerp, type Vec3 } from '../core/math/vec3';
import { predict } from '../core/physics/predict';
import { createBall, type BallState, type ContactEvent } from '../core/physics/step';
import type { Box } from '../core/rules/rally';
import { ACCENTS, GLYPHS } from './font';

/**
 * Rendu « PÁDEL 86 » : tout est dessiné dans un canvas logique de 180×320 px (vue de dessus,
 * 1 m = 12 px), puis agrandi à l'échelle entière maximale, sans lissage. La simulation n'est
 * pas touchée : seule la projection change. Mise en page reprise de tools/padel86/screens.py.
 */

/** Palette stricte du kit (16 couleurs). */
export const PAL = {
  K: '#0b1622', // nuit
  N: '#1d2b53', // bleu nuit
  B: '#2a5bd7', // bleu pista
  C: '#29e0ff', // cyan néon
  P: '#ff3d8b', // rose pop
  M: '#8f3bd9', // violet
  Y: '#ffd23f', // jaune balle
  O: '#ff8a1f', // orange sunset
  R: '#e8323c', // rouge
  G: '#3ec46d', // vert
  W: '#fff4e0', // crème
  L: '#8a94a6', // acier
} as const;
export type Ink = keyof typeof PAL;

export const LW = 180;
export const LH = 320;
const CX0 = 30;
const CY0 = 50;
const PPM = 12;
/** Pixels de décalage vers le haut par mètre de hauteur (la balle « décolle » de son ombre). */
const HPM = 6;

const SPRITE_COLS = ['idle', 'run1', 'run2', 'swing', 'low', 'back'] as const;
const SPRITE_ROWS = ['lola', 'nico', 'gunther', 'brigitte', 'paco', 'pepa', 'toro', 'reina'] as const;
export type SpritePose = (typeof SPRITE_COLS)[number];
export type SpriteName = (typeof SPRITE_ROWS)[number];

export interface ScenePlayer {
  x: number;
  y: number;
  sprite: SpriteName;
  pose: SpritePose;
  /** Anneau vert : la balle est frappable maintenant. */
  hittable: boolean;
  /** Repère au-dessus de la tête : c'est toi (mode classique). */
  marker: boolean;
  /** Point de frappe prévu (affiché en debug). */
  target: Vec3 | null;
}

export interface Hud {
  us: string;
  them: string;
  games: [number, number];
  points: [string, string];
  /** Équipe au service (0 = nous). */
  serving: 0 | 1;
  seconds: number;
  badge: string;
}

export type Bottom =
  | { kind: 'hint'; text: string }
  | { kind: 'thumbs'; left: string; right: string; leftIsAi: boolean; style: number }
  | null;

export interface Banner {
  text: string;
  sub: string;
  ink: Ink;
}

export interface Scene {
  ball: BallState | null;
  prevPos: Vec3;
  /** Fraction du pas fixe écoulée depuis le dernier tick (interpolation d'affichage). */
  alpha: number;
  tick: number;
  tuning: Tuning;
  court: CourtGeometry;
  players: ScenePlayer[];
  debug: boolean;
  /** Aperçu du coup pendant le geste (debug). */
  preview: { origin: Vec3; vel: Vec3 } | null;
  trail: readonly Vec3[];
  /** Ralenti « Rebote » : balle et cadre en surbrillance. */
  glow: boolean;
  landing: Vec3 | null;
  serveAim: { box: Box; origin: Vec3; vel: Vec3; active: boolean } | null;
  hud: Hud | null;
  bottom: Bottom;
  banner: Banner | null;
  /** Sticks actifs, en px CSS de l'écran. */
  sticks: readonly { x0: number; y0: number; x: number; y: number }[];
  stickRadius: number;
  /** Secousse d'écran en px logiques. */
  shake: number;
}

interface Fx {
  ev: ContactEvent;
  age: number;
}

const sx = (x: number) => Math.round(CX0 + x * PPM);
const sy = (y: number, court: CourtGeometry) => Math.round(CY0 + (court.length - y) * PPM);

export class P86View {
  private buf = document.createElement('canvas');
  private bg = document.createElement('canvas');
  private b: CanvasRenderingContext2D;
  private out: CanvasRenderingContext2D;
  private sheet = new Image();
  private sheetReady = false;
  private textCache = new Map<string, HTMLCanvasElement>();
  private fx: Fx[] = [];
  private scale = 1;
  private offX = 0;
  private offY = 0;
  private dpr = 1;

  constructor(
    private canvas: HTMLCanvasElement,
    private court: CourtGeometry,
  ) {
    this.buf.width = LW;
    this.buf.height = LH;
    this.b = this.buf.getContext('2d')!;
    this.out = canvas.getContext('2d', { alpha: false })!;
    this.sheet.onload = () => (this.sheetReady = true);
    this.sheet.src = './padel86/padel86-sprites-1x.png';
    this.paintBackground();
  }

  /** Échelle entière maximale (en pixels physiques) qui tient à l'écran, centrée. */
  resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const w = Math.round(this.canvas.clientWidth * this.dpr);
    const h = Math.round(this.canvas.clientHeight * this.dpr);
    this.canvas.width = w;
    this.canvas.height = h;
    this.scale = Math.max(1, Math.floor(Math.min(w / LW, h / LH)));
    this.offX = Math.floor((w - LW * this.scale) / 2);
    this.offY = Math.floor((h - LH * this.scale) / 2);
  }

  /** Abscisse terrain (m) sous une abscisse écran (px CSS). */
  courtXAt(cssX: number): number {
    return ((cssX * this.dpr - this.offX) / this.scale - CX0) / PPM;
  }

  private toLogical(cssX: number, cssY: number): [number, number] {
    return [(cssX * this.dpr - this.offX) / this.scale, (cssY * this.dpr - this.offY) / this.scale];
  }

  addContact(ev: ContactEvent): void {
    this.fx.push({ ev, age: 0 });
    if (this.fx.length > 24) this.fx.shift();
  }

  update(dt: number): void {
    for (const f of this.fx) f.age += dt;
    this.fx = this.fx.filter((f) => f.age < 0.45);
  }

  // ——— Fond fixe : terrain, vitres, grillage, filet ———

  private paintBackground(): void {
    this.bg.width = LW;
    this.bg.height = LH;
    const g = this.bg.getContext('2d')!;
    const cw = this.court.width * PPM;
    const ch = this.court.length * PPM;
    const R = (ink: Ink, x: number, y: number, w: number, h: number) => {
      g.fillStyle = PAL[ink];
      g.fillRect(x, y, w, h);
    };
    R('N', 0, 0, LW, LH);
    // Trame de fond.
    g.fillStyle = PAL.K;
    for (let y = 0; y < LH; y++) for (let x = y % 2; x < LW; x += 2) if (((x >> 1) + (y >> 1)) % 3 === 0) g.fillRect(x, y, 1, 1);
    R('L', CX0 - 4, CY0 - 4, cw + 8, ch + 8); // cadre métal
    R('C', CX0 - 3, CY0 - 3, cw + 6, ch + 6); // vitres
    R('B', CX0, CY0, cw, ch); // piste
    // Grillage sur les côtés, entre les vitres latérales.
    const glass = Math.round(this.court.sideGlassDepth * PPM);
    for (let y = CY0 + glass; y < CY0 + ch - glass; y++) {
      g.fillStyle = (y >> 1) % 2 ? PAL.L : PAL.K;
      for (const x of [CX0 - 3, CX0 - 2, CX0 + cw + 1, CX0 + cw + 2]) g.fillRect(x, y, 1, 1);
    }
    // Lignes de service et ligne centrale.
    const service = Math.round((this.court.length / 2 - this.court.serviceLineFromNet) * PPM);
    R('W', CX0, CY0 + service, cw, 1);
    R('W', CX0, CY0 + ch - service - 1, cw, 1);
    R('W', CX0 + cw / 2, CY0 + service, 1, ch - 2 * service);
    // Filet.
    const ny = CY0 + ch / 2;
    R('K', CX0 - 6, ny - 1, cw + 12, 3);
    g.fillStyle = PAL.W;
    for (let x = CX0 - 6; x < CX0 + cw + 6; x += 2) g.fillRect(x, ny, 1, 1);
    // Reflets sur les vitres.
    R('W', CX0 + 10, CY0 - 3, 6, 1);
    R('W', CX0 + 80, CY0 + ch + 2, 6, 1);
  }

  // ——— Texte en police bitmap 5×7 ———

  private textCanvas(text: string, ink: Ink, scale: number, outline: Ink | null): HTMLCanvasElement {
    const key = `${ink}${scale}${outline ?? '-'}${text}`;
    let c = this.textCache.get(key);
    if (c) return c;
    if (this.textCache.size > 400) this.textCache.clear();
    const pad = outline ? 1 : 0;
    c = document.createElement('canvas');
    c.width = Math.max(1, text.length * 6 * scale - scale + 2 * pad);
    c.height = (7 + 3) * scale + 2 * pad; // 3 lignes au-dessus pour les accents
    const g = c.getContext('2d')!;
    const plot = (color: string, dx: number, dy: number) => {
      g.fillStyle = color;
      let cx = pad + dx;
      for (const raw of text) {
        const up = raw.toUpperCase();
        const base = ACCENTS[up] ?? up;
        const glyph = GLYPHS[base] ?? GLYPHS['?'];
        for (let i = 0; i < 35; i++) if (glyph[i] === '#') g.fillRect(cx + (i % 5) * scale, pad + dy + (3 + Math.floor(i / 5)) * scale, scale, scale);
        if (ACCENTS[up] && up !== 'Ñ' && up !== 'Ç') {
          // Accent aigu ou grave : deux pixels en diagonale au-dessus de la lettre.
          const grave = up === 'À' || up === 'È';
          g.fillRect(cx + (grave ? 1 : 3) * scale, pad + dy, scale, scale);
          g.fillRect(cx + 2 * scale, pad + dy + scale, scale, scale);
        }
        cx += 6 * scale;
      }
    };
    if (outline) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]]) plot(PAL[outline], dx, dy);
    plot(PAL[ink], 0, 0);
    this.textCache.set(key, c);
    return c;
  }

  /** Dessine un texte ; (x, y) = coin haut-gauche des lettres. `align` : 0 gauche, 0.5 centré, 1 droite. */
  private text(text: string, x: number, y: number, ink: Ink, scale = 1, outline: Ink | null = null, align = 0): void {
    const c = this.textCanvas(text, ink, scale, outline);
    const pad = outline ? 1 : 0;
    this.b.drawImage(c, Math.round(x - align * (c.width - 2 * pad)) - pad, y - 3 * scale - pad);
  }

  private rect(ink: Ink, x: number, y: number, w: number, h: number): void {
    this.b.fillStyle = PAL[ink];
    this.b.fillRect(Math.round(x), Math.round(y), w, h);
  }

  private frame(ink: Ink, x: number, y: number, w: number, h: number): void {
    this.rect(ink, x, y, w, 1);
    this.rect(ink, x, y + h - 1, w, 1);
    this.rect(ink, x, y, 1, h);
    this.rect(ink, x + w - 1, y, 1, h);
  }

  /** Ellipse en pixels (contour), centrée. */
  private ring(ink: Ink, cx: number, cy: number, rx: number, ry: number): void {
    this.b.fillStyle = PAL[ink];
    const n = Math.max(12, Math.round(rx * 5));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.b.fillRect(Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry), 1, 1);
    }
  }

  /** Trajectoire en pointillés, de point en point (2 px allumés, 2 éteints). */
  private dotted(ink: Ink, pts: readonly Vec3[], stopY: number | null, forward: number): void {
    this.b.fillStyle = PAL[ink];
    let n = 0;
    let px = NaN;
    let py = NaN;
    for (const p of pts) {
      const x = sx(p.x);
      const y = sy(p.y, this.court) - Math.round(p.z * HPM);
      if (!Number.isNaN(px)) {
        const steps = Math.max(Math.abs(x - px), Math.abs(y - py));
        for (let i = 1; i <= steps; i++) {
          if (n++ % 4 < 2) this.b.fillRect(Math.round(px + ((x - px) * i) / steps), Math.round(py + ((y - py) * i) / steps), 1, 1);
        }
      }
      px = x;
      py = y;
      if (stopY !== null && (p.y - stopY) * forward >= 0) break;
    }
  }

  // ——— Image ———

  draw(s: Scene): void {
    const b = this.b;
    b.imageSmoothingEnabled = false;
    b.drawImage(this.bg, 0, 0);
    const court = s.court;
    const dtPhys = FIXED_DT * s.tuning.physics.timeScale;

    if (s.serveAim) this.drawServeAim(s, dtPhys);
    if (s.debug) {
      if (s.ball && (s.ball.status === 'flying' || s.ball.status === 'rolling')) this.dotted('Y', predict(s.ball, s.tuning.physics, court, dtPhys, 4, 3).points, null, 1);
      if (s.preview) this.dotted('O', predict(createBall(s.preview.origin, s.preview.vel), s.tuning.physics, court, dtPhys, 4, 3).points, null, 1);
      for (const p of s.players) if (p.target) this.ring('G', sx(p.target.x), sy(p.target.y, court) - Math.round(p.target.z * HPM), 3, 3);
    }
    if (s.landing && Math.floor(s.tick / 8) % 2 === 0) {
      this.ring('Y', sx(s.landing.x), sy(s.landing.y, court), 5, 3);
      this.rect('Y', sx(s.landing.x), sy(s.landing.y, court), 1, 1);
    }
    for (const p of s.players) if (p.hittable && Math.floor(s.tick / 6) % 2 === 0) this.ring('G', sx(p.x), sy(p.y, court) - 1, 10, 5);

    // Balle interpolée, puis tout ce qui a un « pied » au sol, du fond vers l'avant.
    const ball = s.ball;
    const bp = ball
      ? { x: lerp(s.prevPos.x, ball.pos.x, s.alpha), y: lerp(s.prevPos.y, ball.pos.y, s.alpha), z: lerp(s.prevPos.z, ball.pos.z, s.alpha) }
      : null;
    if (bp) this.drawBallShadow(bp, court);
    const items: { y: number; draw: () => void }[] = s.players.map((p) => ({ y: p.y, draw: () => this.drawPlayer(p, court) }));
    if (bp) items.push({ y: bp.y, draw: () => this.drawBall(bp, s, court) });
    items.sort((a, c) => c.y - a.y);
    for (const it of items) it.draw();

    this.drawFx(court);
    if (s.glow && Math.floor(s.tick / 4) % 2 === 0) this.frame('Y', CX0 - 4, CY0 - 4, court.width * PPM + 8, court.length * PPM + 8);
    for (const t of s.sticks) this.drawStick(t, s.stickRadius);
    if (s.hud) this.drawHud(s.hud);
    this.drawBottom(s.bottom);
    if (s.banner) this.drawBanner(s.banner);

    // Sortie : agrandissement entier, sans lissage, bandes « nuit » autour.
    const o = this.out;
    o.imageSmoothingEnabled = false;
    o.fillStyle = PAL.K;
    o.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const shake = s.shake > 0 ? (Math.floor(s.tick / 2) % 2 ? 1 : -1) * s.shake * this.scale : 0;
    o.drawImage(this.buf, this.offX + shake, this.offY - shake, LW * this.scale, LH * this.scale);
  }

  private drawServeAim(s: Scene, dtPhys: number): void {
    const { box, origin, vel, active } = s.serveAim!;
    const x0 = sx(box.xMin);
    const x1 = sx(box.xMax);
    const y0 = sy(box.yMax, s.court);
    const y1 = sy(box.yMin, s.court);
    // Carré visé : trame jaune.
    this.b.fillStyle = PAL.Y;
    for (let y = y0 + 2; y < y1; y += 2) for (let x = x0 + 2 + (y % 4); x < x1; x += 4) this.b.fillRect(x, y, 1, 1);
    const pred = predict(createBall(origin, vel), s.tuning.physics, s.court, dtPhys, 3, 2);
    const first = pred.contacts[0];
    const good = !!first && first.surface === 'ground' && first.pos.x >= box.xMin && first.pos.x <= box.xMax && first.pos.y >= box.yMin && first.pos.y <= box.yMax;
    const ink: Ink = good ? 'W' : 'R';
    if (active || Math.floor(s.tick / 10) % 2 === 0) this.dotted(ink, pred.points, first ? first.pos.y : null, Math.sign(vel.y) || 1);
    if (first) this.ring(ink, sx(first.pos.x), sy(first.pos.y, s.court), 4, 2);
  }

  private drawPlayer(p: ScenePlayer, court: CourtGeometry): void {
    const x = sx(p.x);
    const y = sy(p.y, court);
    // Ombre tramée (damier 1 px).
    this.b.fillStyle = PAL.K;
    for (let yy = y - 2; yy <= y; yy++) for (let xx = x - 5; xx < x + 5; xx++) if ((xx + yy) % 2 === 0) this.b.fillRect(xx, yy, 1, 1);
    if (this.sheetReady) {
      const col = SPRITE_COLS.indexOf(p.pose);
      const row = SPRITE_ROWS.indexOf(p.sprite);
      this.b.drawImage(this.sheet, col * 16, row * 24, 16, 24, x - 8, y - 23, 16, 24);
    } else {
      this.rect('P', x - 3, y - 14, 6, 14);
    }
    if (p.marker) {
      this.rect('Y', x - 2, y - 28, 5, 1);
      this.rect('Y', x - 1, y - 27, 3, 1);
      this.rect('Y', x, y - 26, 1, 1);
    }
  }

  private drawBallShadow(p: Vec3, court: CourtGeometry): void {
    const x = sx(p.x);
    const y = sy(p.y, court);
    this.rect('K', x - 1, y - 1, 3, 2);
    this.rect('K', x - 2, y, 1, 1);
    this.rect('K', x + 2, y, 1, 1);
  }

  private drawBall(p: Vec3, s: Scene, court: CourtGeometry): void {
    // Traînée rose / orange, comme sur la maquette.
    const n = s.trail.length;
    for (let i = 0; i < n - 1; i += 2) {
      const t = s.trail[i];
      const tx = sx(t.x);
      const ty = sy(t.y, court) - Math.round(t.z * HPM);
      this.rect('P', tx, ty, 1, 1);
      this.rect('O', tx + 1, ty, 1, 1);
    }
    const x = sx(p.x);
    const y = sy(p.y, court) - Math.round(Math.max(0, p.z) * HPM);
    // 4 px au sol, 6 px quand elle est haute : la taille aide à lire la hauteur.
    const big = p.z > 1.6;
    if (s.glow) {
      this.rect('W', x - (big ? 4 : 3), y - (big ? 5 : 4), big ? 8 : 6, big ? 8 : 6);
    }
    if (big) {
      this.rect('Y', x - 2, y - 4, 4, 6);
      this.rect('Y', x - 3, y - 3, 6, 4);
    } else {
      this.rect('Y', x - 1, y - 3, 2, 4);
      this.rect('Y', x - 2, y - 2, 4, 2);
    }
    this.rect('W', x - 1, y - (big ? 3 : 2), 1, 1);
  }

  private drawFx(court: CourtGeometry): void {
    const cw = court.width * PPM;
    const ch = court.length * PPM;
    for (const f of this.fx) {
      const { pos, surface, plane } = f.ev;
      const x = sx(pos.x);
      const y = sy(pos.y, court);
      if (surface === 'glass') {
        // Flash blanc sur le segment de vitre touché, puis « VITRE ! » qui monte et s'efface.
        if (f.age < 0.07) {
          if (plane === 'left' || plane === 'right') this.rect('W', plane === 'left' ? CX0 - 3 : CX0 + cw, y - 8, 3, 16);
          else this.rect('W', x - 8, plane === 'backFar' ? CY0 - 3 : CY0 + ch, 16, 3);
        }
        if (f.age < 0.4) {
          const tx = Math.min(LW - 20, Math.max(20, x));
          const ty = Math.min(CY0 + ch - 14, Math.max(CY0 + 6, y - 6)) - Math.round(f.age * 20);
          this.text('VITRE !', tx, ty, 'Y', 1, 'K', 0.5);
        }
      } else if (f.age < 0.18) {
        const r = 1 + Math.round(f.age * 25);
        const ink: Ink = surface === 'ground' ? 'W' : surface === 'fence' ? 'L' : 'W';
        this.rect(ink, x - r, y, 1, 1);
        this.rect(ink, x + r, y, 1, 1);
        this.rect(ink, x, y - Math.ceil(r / 2), 1, 1);
      }
    }
  }

  private drawStick(t: { x0: number; y0: number; x: number; y: number }, radiusCss: number): void {
    const [cx, cy] = this.toLogical(t.x0, t.y0);
    const [kx, ky] = this.toLogical(t.x, t.y);
    const r = Math.round((radiusCss * this.dpr) / this.scale);
    let dx = kx - cx;
    let dy = ky - cy;
    const n = Math.hypot(dx, dy);
    if (n > r) {
      dx = (dx / n) * r;
      dy = (dy / n) * r;
    }
    this.frame('C', Math.round(cx) - r, Math.round(cy) - r, 2 * r + 1, 2 * r + 1);
    this.rect('K', Math.round(cx + dx) - 3, Math.round(cy + dy) - 3, 7, 7);
    this.rect('W', Math.round(cx + dx) - 2, Math.round(cy + dy) - 2, 5, 5);
  }

  /** Boîte du kit : ombre décalée de 2 px, bordure 1 px, fond. */
  private box(x0: number, y0: number, x1: number, y1: number, fill: Ink, border: Ink, shadow: Ink): void {
    this.rect(shadow, x0 + 2, y0 + 2, x1 - x0 + 1, y1 - y0 + 1);
    this.rect(border, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    this.rect(fill, x0 + 1, y0 + 1, x1 - x0 - 1, y1 - y0 - 1);
  }

  private drawHud(h: Hud): void {
    this.box(4, 4, 175, 38, 'K', 'C', 'M');
    this.text(h.us, 12, 12, 'P');
    this.text(h.them, 12, 25, 'L');
    this.rect('N', 12, 20, 60, 1);
    // Pastille jaune devant l'équipe qui sert.
    this.rect('Y', 7, h.serving === 0 ? 14 : 27, 3, 3);
    const cols: [string, string][] = [
      [String(h.games[0]), String(h.games[1])],
      [h.points[0], h.points[1]],
    ];
    cols.forEach(([a, c], i) => {
      const x = 92 + i * 30;
      this.rect('N', x, 8, 25, 27);
      this.text(a, x + 12, 12, 'Y', 1, null, 0.5);
      this.text(c, x + 12, 25, 'W', 1, null, 0.5);
    });
    const m = Math.floor(h.seconds / 60);
    const sec = String(Math.floor(h.seconds % 60)).padStart(2, '0');
    this.text(`${Math.min(m, 9)}:${sec}`, 173, 12, 'W', 1, null, 1);
    this.rect('P', 149, 23, 25, 11);
    this.text(h.badge, 161, 25, 'W', 1, null, 0.5);
  }

  private drawBottom(bottom: Bottom): void {
    if (!bottom) return;
    if (bottom.kind === 'hint') {
      const lines = wrap(bottom.text, 29).slice(0, 2);
      lines.forEach((l, i) => this.text(l, LW / 2, (lines.length === 1 ? 304 : 299) + i * 10, 'W', 1, 'K', 0.5));
      return;
    }
    const cell = (x: number, label: string, dim: boolean) => {
      this.frame(dim ? 'L' : 'C', x, 298, 56, 18);
      this.text(label, x + 28, 304, dim ? 'L' : 'C', 1, null, 0.5);
    };
    cell(8, bottom.left, bottom.leftIsAi);
    cell(116, bottom.right, false);
    this.text('STYLE', LW / 2, 299, 'C', 1, null, 0.5);
    this.text(String(bottom.style), LW / 2, 308, 'Y', 1, null, 0.5);
  }

  private drawBanner(n: Banner): void {
    const big = n.text.length <= 14;
    const y = CY0 + (this.court.length * PPM) / 2 - (big ? 22 : 16);
    this.text(n.text, LW / 2, y, n.ink, big ? 2 : 1, 'K', 0.5);
    if (n.sub) this.text(n.sub, LW / 2, y + (big ? 20 : 12), 'Y', 1, 'K', 0.5);
  }
}

/** Coupe un texte en lignes d'au plus `max` caractères, sans couper les mots. */
export function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
