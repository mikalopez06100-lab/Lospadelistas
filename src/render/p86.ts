import { FIXED_DT, type CourtGeometry, type Tuning } from '../core/constants';
import { lerp, type Vec3 } from '../core/math/vec3';
import { netHeightAt } from '../core/physics/court';
import { predict } from '../core/physics/predict';
import { createBall, type BallState, type ContactEvent } from '../core/physics/step';
import type { Box } from '../core/rules/rally';
import { ACCENTS, GLYPHS } from './font';

/**
 * Rendu « PÁDEL 86 » : pixel art en perspective, plein écran.
 *
 * - La grille de pixels logiques s'adapte à l'écran : on choisit le plus grand zoom ENTIER qui
 *   laisse au moins 180 pixels logiques de large, puis la grille couvre tout l'écran. Pixels
 *   carrés et nets, aucune bande.
 * - Le terrain est vu de derrière ta paire, en perspective (comme sur l'affiche), mais tracé
 *   sans lissage : remplissages ligne par ligne et traits de Bresenham, palette stricte.
 * - La simulation n'est pas touchée : seule la projection change.
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

/** Largeur logique minimale : celle des maquettes du kit. */
const MIN_LW = 180;
/** Hauteur logique minimale, pour les écrans larges (tablette, ordinateur). */
const MIN_LH = 300;
/** Rapport largeur du fond / largeur du premier plan : force de la perspective. */
const FAR_RATIO = 0.7;
/** Tes joueurs, au premier plan, sont dessinés deux fois plus gros (comme sur l'affiche). */
const NEAR_SPRITE_SCALE = 2;
const HUD_H = 44;
const BOTTOM_H = 26;

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
  /** Jeux gagnés, ou null quand le match se joue en un seul jeu (seuls les points comptent). */
  games: [number, number] | null;
  points: [string, string];
  /** Équipe au service (0 = nous). */
  serving: 0 | 1;
  seconds: number;
  badge: string;
}

export type Bottom =
  | { kind: 'hint'; text: string }
  | { kind: 'thumbs'; left: string; right: string; leftIsAi: boolean; rightIsAi: boolean; style: number }
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

export class P86View {
  private buf = document.createElement('canvas');
  private bg = document.createElement('canvas');
  private b: CanvasRenderingContext2D;
  private out: CanvasRenderingContext2D;
  private sheet = new Image();
  private sheetReady = false;
  private textCache = new Map<string, HTMLCanvasElement>();
  private fx: Fx[] = [];
  /** Taille de la grille logique (px) et zoom entier vers les pixels physiques. */
  private lw = MIN_LW;
  private lh = 320;
  private zoom = 1;
  private dpr = 1;
  // Caméra : derrière le fond de ta paire, à (W/2, −camD, camH), regard horizontal.
  private camD = 1;
  private camH = 1;
  private k = 1;
  private cx = 0;
  private oy = 0;
  /** Marges réservées en haut (boutons, encoche) et en bas (barre d'accueil), en px logiques. */
  private top = 0;
  private bottomInset = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private court: CourtGeometry,
  ) {
    this.b = this.buf.getContext('2d')!;
    this.out = canvas.getContext('2d', { alpha: false })!;
    this.sheet.onload = () => (this.sheetReady = true);
    this.sheet.src = './padel86/padel86-sprites-1x.png';
  }

  /**
   * Recalcule la grille logique, la caméra et le fond pour la taille actuelle de l'écran.
   * `topCss` / `bottomCss` : hauteur à laisser libre en haut et en bas (px CSS).
   */
  resize(topCss = 0, bottomCss = 0): void {
    this.dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * this.dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * this.dpr));
    this.canvas.width = w;
    this.canvas.height = h;
    this.zoom = Math.max(1, Math.floor(Math.min(w / MIN_LW, h / MIN_LH)));
    this.lw = Math.ceil(w / this.zoom);
    this.lh = Math.ceil(h / this.zoom);
    this.buf.width = this.lw;
    this.buf.height = this.lh;
    this.top = Math.ceil((topCss * this.dpr) / this.zoom);
    this.bottomInset = Math.ceil((bottomCss * this.dpr) / this.zoom);
    this.fitCamera();
    this.paintBackground();
  }

  /**
   * Cadre le terrain entre le HUD et la barre du bas. La perspective (FAR_RATIO) est fixe ;
   * la hauteur de caméra s'ajuste pour remplir la hauteur disponible : écran haut = vue plus
   * plongeante, écran large = vue plus rasante.
   */
  private fitCamera(): void {
    const { width: W, length: L, backGlassHeight: G } = this.court;
    this.camD = (FAR_RATIO * L) / (1 - FAR_RATIO);
    const D = this.camD;
    const availH = this.lh - this.top - HUD_H - BOTTOM_H - this.bottomInset - 8;
    let k = (Math.min(this.lw - 10, 260) * D) / W;
    // Hauteur à l'écran = vitre du fond + profondeur du sol.
    const depthPx = (camH: number, kk: number) => (kk * camH * L) / (D * (D + L));
    let camH = ((availH - (k * G) / (D + L)) * D * (D + L)) / (k * L);
    const MIN_H = 30;
    const MAX_H = 95;
    if (camH < MIN_H) {
      // Écran trop peu haut pour cette largeur : on réduit le terrain.
      camH = MIN_H;
      k = availH / (G / (D + L) + (MIN_H * L) / (D * (D + L)));
    } else if (camH > MAX_H) {
      camH = MAX_H;
    }
    this.k = k;
    this.camH = camH;
    this.cx = Math.floor(this.lw / 2);
    const used = (k * G) / (D + L) + depthPx(camH, k);
    const bottom = this.lh - BOTTOM_H - this.bottomInset - 4 - Math.floor(Math.max(0, availH - used) / 2);
    this.oy = bottom - (k * camH) / D;
  }

  private px(x: number, y: number): number {
    return Math.round(this.cx + ((x - this.court.width / 2) * this.k) / (y + this.camD));
  }

  private py(y: number, z: number): number {
    return Math.round(this.oy + (this.k * (this.camH - z)) / (y + this.camD));
  }

  /** Pixels logiques par mètre à la profondeur y. */
  private ppm(y: number): number {
    return this.k / (y + this.camD);
  }

  /** Abscisse terrain (m) sous une abscisse écran (px CSS), à la profondeur `y`. */
  courtXAt(cssX: number, y: number): number {
    const lx = (cssX * this.dpr) / this.zoom;
    return this.court.width / 2 + ((lx - this.cx) * (y + this.camD)) / this.k;
  }

  addContact(ev: ContactEvent): void {
    this.fx.push({ ev, age: 0 });
    if (this.fx.length > 24) this.fx.shift();
  }

  update(dt: number): void {
    for (const f of this.fx) f.age += dt;
    this.fx = this.fx.filter((f) => f.age < 0.45);
  }

  // ——— Primitives pixel (aucun lissage) ———

  private rect(ink: Ink, x: number, y: number, w: number, h: number, g = this.b): void {
    g.fillStyle = PAL[ink];
    g.fillRect(Math.round(x), Math.round(y), w, h);
  }

  private frame(ink: Ink, x: number, y: number, w: number, h: number): void {
    this.rect(ink, x, y, w, 1);
    this.rect(ink, x, y + h - 1, w, 1);
    this.rect(ink, x, y, 1, h);
    this.rect(ink, x + w - 1, y, 1, h);
  }

  /** Trait de Bresenham. `dash` > 0 : pointillés de cette longueur. */
  private line(ink: Ink, x0: number, y0: number, x1: number, y1: number, g = this.b, dash = 0): void {
    g.fillStyle = PAL[ink];
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const stepX = x0 < x1 ? 1 : -1;
    const stepY = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 4000; n++) {
      if (!dash || Math.floor(n / dash) % 2 === 0) g.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += stepX;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += stepY;
      }
    }
  }

  /** Trait entre deux points du terrain (mètres). */
  private line3(ink: Ink, a: [number, number, number], c: [number, number, number], g = this.b, dash = 0): void {
    this.line(ink, this.px(a[0], a[1]), this.py(a[1], a[2]), this.px(c[0], c[1]), this.py(c[1], c[2]), g, dash);
  }

  /** Ellipse posée au sol (contour), aplatie par la perspective. */
  private groundRing(ink: Ink, x: number, y: number, radius: number): void {
    const rx = Math.max(2, radius * this.ppm(y));
    const ry = Math.max(1, rx * 0.42);
    const cx = this.px(x, y);
    const cy = this.py(y, 0);
    this.b.fillStyle = PAL[ink];
    const n = Math.max(12, Math.round(rx * 5));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.b.fillRect(Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry), 1, 1);
    }
  }

  /** Trajectoire en pointillés (2 px allumés, 2 éteints). */
  private dotted(ink: Ink, pts: readonly Vec3[], stopY: number | null, forward: number): void {
    this.b.fillStyle = PAL[ink];
    let n = 0;
    let lx = NaN;
    let ly = NaN;
    for (const p of pts) {
      const x = this.px(p.x, p.y);
      const y = this.py(p.y, Math.max(0, p.z));
      if (!Number.isNaN(lx)) {
        const steps = Math.max(Math.abs(x - lx), Math.abs(y - ly));
        for (let i = 1; i <= steps; i++) {
          if (n++ % 4 < 2) this.b.fillRect(Math.round(lx + ((x - lx) * i) / steps), Math.round(ly + ((y - ly) * i) / steps), 1, 1);
        }
      }
      lx = x;
      ly = y;
      if (stopY !== null && (p.y - stopY) * forward >= 0) break;
    }
  }

  // ——— Fond fixe : trame, sol, lignes, vitres du fond et des côtés ———

  private paintBackground(): void {
    const { width: W, length: L, backGlassHeight: G, sideGlassDepth: S, sideGlassHeight: SH, fenceHeight: FH } = this.court;
    this.bg.width = this.lw;
    this.bg.height = this.lh;
    const g = this.bg.getContext('2d')!;
    this.rect('N', 0, 0, this.lw, this.lh, g);
    g.fillStyle = PAL.K;
    for (let y = 0; y < this.lh; y++) for (let x = y % 2; x < this.lw; x += 2) if (((x >> 1) + (y >> 1)) % 3 === 0) g.fillRect(x, y, 1, 1);

    // Sol : une rangée de pixels à la fois, entre les deux bords du trapèze.
    const yTop = this.py(L, 0);
    const yBot = this.py(0, 0);
    for (let sy = yTop; sy <= yBot; sy++) {
      const depth = (this.k * this.camH) / (sy - this.oy) - this.camD;
      const x0 = this.px(0, depth);
      const x1 = this.px(W, depth);
      this.rect('B', x0, sy, x1 - x0 + 1, 1, g);
    }

    // Parois latérales : vitre sur 4 m à chaque bout, grillage au milieu.
    for (const x of [0, W]) {
      for (const [ya, yb] of [[0, S], [L - S, L]] as const) {
        this.line3('C', [x, ya, SH], [x, yb, SH], g);
        this.line3('C', [x, ya, 0], [x, ya, SH], g);
        this.line3('C', [x, yb, 0], [x, yb, SH], g);
      }
      this.line3('L', [x, S, FH], [x, L - S, FH], g, 2);
      for (let y = S + 2; y < L - S; y += 2) this.line3('L', [x, y, 0], [x, y, FH], g, 2);
      this.line3('C', [x, 0, 0], [x, L, 0], g);
    }

    // Vitre du fond : panneau sombre, cadre cyan, montants tous les 2 m, reflets.
    const gx0 = this.px(0, L);
    const gx1 = this.px(W, L);
    const gy0 = this.py(L, G);
    this.rect('K', gx0, gy0, gx1 - gx0 + 1, yTop - gy0, g);
    g.fillStyle = PAL.N;
    for (let y = gy0 + 1; y < yTop; y++) for (let x = gx0 + 1 + (y % 2); x < gx1; x += 2) g.fillRect(x, y, 1, 1);
    g.fillStyle = PAL.C;
    g.fillRect(gx0, gy0, gx1 - gx0 + 1, 1);
    g.fillRect(gx0, gy0, 1, yTop - gy0 + 1);
    g.fillRect(gx1, gy0, 1, yTop - gy0 + 1);
    for (let x = 2; x < W; x += 2) this.line3('L', [x, L, 0], [x, L, G], g);
    this.rect('W', gx0 + 6, gy0 + 3, 5, 1, g);
    this.rect('W', gx0 + 8, gy0 + 5, 3, 1, g);

    // Lignes : fonds, côtés, service, ligne centrale.
    const service = L / 2 - this.court.serviceLineFromNet;
    this.line3('W', [0, L, 0], [W, L, 0], g);
    this.line3('W', [0, 0, 0], [W, 0, 0], g);
    this.line3('W', [0, service, 0], [W, service, 0], g);
    this.line3('W', [0, L - service, 0], [W, L - service, 0], g);
    this.line3('W', [W / 2, service, 0], [W / 2, L - service, 0], g);
  }

  /** Filet : bande sombre, bord supérieur blanc en pointillés, poteaux. */
  private drawNet(): void {
    const { width: W, netY } = this.court;
    const x0 = this.px(0, netY) - 2;
    const x1 = this.px(W, netY) + 2;
    const yBase = this.py(netY, 0);
    const yTop = this.py(netY, netHeightAt(this.court, W / 2));
    this.b.fillStyle = PAL.K;
    for (let y = yTop; y <= yBase; y++) for (let x = x0 + ((y + 1) % 2); x <= x1; x += 2) this.b.fillRect(x, y, 1, 1);
    this.rect('K', x0, yTop - 1, x1 - x0 + 1, 3);
    this.b.fillStyle = PAL.W;
    for (let x = x0; x <= x1; x += 2) this.b.fillRect(x, yTop, 1, 1);
    this.rect('L', x0 - 1, yTop - 2, 2, yBase - yTop + 3);
    this.rect('L', x1, yTop - 2, 2, yBase - yTop + 3);
  }

  /** Vitre de fond côté joueur : simple cadre en pointillés, pour ne rien masquer. */
  private drawNearGlass(): void {
    const { width: W, backGlassHeight: G } = this.court;
    this.line3('C', [0, 0, G], [W, 0, G], this.b, 3);
    this.line3('C', [0, 0, 0], [0, 0, G], this.b, 3);
    this.line3('C', [W, 0, 0], [W, 0, G], this.b, 3);
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
    this.b.drawImage(c, Math.round(x - align * (c.width - 2 * pad)) - pad, Math.round(y) - 3 * scale - pad);
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
      for (const p of s.players) if (p.target) this.frame('G', this.px(p.target.x, p.target.y) - 2, this.py(p.target.y, p.target.z) - 2, 5, 5);
    }
    if (s.landing && Math.floor(s.tick / 8) % 2 === 0) {
      this.groundRing('Y', s.landing.x, s.landing.y, 0.5);
      this.rect('Y', this.px(s.landing.x, s.landing.y), this.py(s.landing.y, 0), 1, 1);
    }
    for (const p of s.players) if (p.hittable && Math.floor(s.tick / 6) % 2 === 0) this.groundRing('G', p.x, p.y, 0.9);

    // Balle interpolée, puis tout ce qui a un « pied » au sol, du fond vers l'avant ; le filet
    // s'intercale entre les deux camps.
    const ball = s.ball;
    const bp = ball
      ? { x: lerp(s.prevPos.x, ball.pos.x, s.alpha), y: lerp(s.prevPos.y, ball.pos.y, s.alpha), z: lerp(s.prevPos.z, ball.pos.z, s.alpha) }
      : null;
    if (bp) this.drawBallShadow(bp);
    const items: { y: number; draw: () => void }[] = s.players.map((p) => ({ y: p.y, draw: () => this.drawPlayer(p) }));
    if (bp) items.push({ y: bp.y, draw: () => this.drawBall(bp, s) });
    items.sort((a, c) => c.y - a.y);
    for (const it of items) if (it.y > court.netY) it.draw();
    this.drawNet();
    for (const it of items) if (it.y <= court.netY) it.draw();
    this.drawNearGlass();

    this.drawFx();
    if (s.glow && Math.floor(s.tick / 4) % 2 === 0) this.frame('Y', 0, this.top + HUD_H - 2, this.lw, this.lh - this.top - HUD_H - BOTTOM_H - this.bottomInset + 2);
    for (const t of s.sticks) this.drawStick(t, s.stickRadius);
    if (s.hud) this.drawHud(s.hud);
    this.drawBottom(s.bottom);
    if (s.banner) this.drawBanner(s.banner);

    // Sortie : zoom entier, sans lissage, sur tout l'écran.
    const o = this.out;
    o.imageSmoothingEnabled = false;
    const shake = s.shake > 0 ? (Math.floor(s.tick / 2) % 2 ? 1 : -1) * s.shake * this.zoom : 0;
    if (shake) {
      o.fillStyle = PAL.K;
      o.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    o.drawImage(this.buf, shake, -shake, this.lw * this.zoom, this.lh * this.zoom);
  }

  private drawServeAim(s: Scene, dtPhys: number): void {
    const { box, origin, vel, active } = s.serveAim!;
    // Carré visé : semis de points jaunes, posé sur le sol en perspective.
    this.b.fillStyle = PAL.Y;
    let row = 0;
    for (let y = box.yMin + 0.3; y < box.yMax; y += 0.45, row++) {
      for (let x = box.xMin + 0.25 + (row % 2) * 0.3; x < box.xMax; x += 0.6) this.b.fillRect(this.px(x, y), this.py(y, 0), 1, 1);
    }
    const pred = predict(createBall(origin, vel), s.tuning.physics, s.court, dtPhys, 3, 2);
    const first = pred.contacts[0];
    const good = !!first && first.surface === 'ground' && first.pos.x >= box.xMin && first.pos.x <= box.xMax && first.pos.y >= box.yMin && first.pos.y <= box.yMax;
    const ink: Ink = good ? 'W' : 'R';
    if (active || Math.floor(s.tick / 10) % 2 === 0) this.dotted(ink, pred.points, first ? first.pos.y : null, Math.sign(vel.y) || 1);
    if (first) this.groundRing(ink, first.pos.x, first.pos.y, 0.4);
  }

  private drawPlayer(p: ScenePlayer): void {
    const x = this.px(p.x, p.y);
    const y = this.py(p.y, 0);
    const scale = p.y < this.court.netY ? NEAR_SPRITE_SCALE : 1;
    // Ombre tramée (damier) sous les pieds.
    this.b.fillStyle = PAL.K;
    const hw = 5 * scale;
    for (let yy = y - scale; yy <= y + scale; yy++) for (let xx = x - hw; xx < x + hw; xx++) if ((xx + yy) % 2 === 0) this.b.fillRect(xx, yy, 1, 1);
    if (this.sheetReady) {
      const col = SPRITE_COLS.indexOf(p.pose);
      const row = SPRITE_ROWS.indexOf(p.sprite);
      this.b.drawImage(this.sheet, col * 16, row * 24, 16, 24, x - 8 * scale, y - 23 * scale, 16 * scale, 24 * scale);
    } else {
      this.rect('P', x - 3 * scale, y - 14 * scale, 6 * scale, 14 * scale);
    }
    if (p.marker) {
      const top = y - 24 * scale - 5;
      this.rect('Y', x - 3, top, 7, 2);
      this.rect('Y', x - 2, top + 2, 5, 1);
      this.rect('Y', x - 1, top + 3, 3, 1);
      this.rect('Y', x, top + 4, 1, 1);
    }
  }

  private drawBallShadow(p: Vec3): void {
    const x = this.px(p.x, p.y);
    const y = this.py(p.y, 0);
    const big = this.ppm(p.y) > 13;
    this.rect('K', x - (big ? 2 : 1), y - 1, big ? 5 : 3, 2);
    this.rect('K', x - (big ? 3 : 2), y, 1, 1);
    this.rect('K', x + (big ? 3 : 2), y, 1, 1);
  }

  private drawBall(p: Vec3, s: Scene): void {
    // Traînée rose / orange, comme sur l'affiche.
    const n = s.trail.length;
    for (let i = 0; i < n - 1; i += 2) {
      const t = s.trail[i];
      const tx = this.px(t.x, t.y);
      const ty = this.py(t.y, Math.max(0, t.z));
      this.rect('P', tx, ty, 1, 1);
      this.rect('O', tx + 1, ty, 1, 1);
    }
    const x = this.px(p.x, p.y);
    const y = this.py(p.y, Math.max(0, p.z));
    // Plus grosse quand elle est proche de la caméra : au premier plan, ou en hauteur.
    const size = this.ppm(p.y) * (1 + Math.max(0, p.z) * 0.1);
    const d = size > 17 ? 8 : size > 13 ? 6 : 4;
    const h = d / 2;
    if (s.glow) this.rect('W', x - h - 1, y - h - 1, d + 2, d + 2);
    this.rect('Y', x - h + 1, y - h, d - 2, d);
    this.rect('Y', x - h, y - h + 1, d, d - 2);
    this.rect('W', x - h + 1, y - h + 1, d > 4 ? 2 : 1, 1);
  }

  private drawFx(): void {
    for (const f of this.fx) {
      const { pos, surface } = f.ev;
      const x = this.px(pos.x, pos.y);
      const y = this.py(pos.y, Math.max(0, pos.z));
      if (surface === 'glass') {
        // Éclat blanc à l'impact, puis « VITRE ! » qui monte et s'efface.
        if (f.age < 0.07) {
          this.rect('W', x - 6, y - 1, 13, 3);
          this.rect('W', x - 1, y - 6, 3, 13);
          this.rect('W', x - 3, y - 3, 7, 7);
        }
        if (f.age < 0.4) {
          const tx = Math.min(this.lw - 22, Math.max(22, x));
          this.text('VITRE !', tx, Math.max(this.top + HUD_H + 4, y - 14 - Math.round(f.age * 20)), 'Y', 1, 'K', 0.5);
        }
      } else if (f.age < 0.18) {
        const r = 1 + Math.round(f.age * 25);
        const ink: Ink = surface === 'fence' ? 'L' : 'W';
        this.rect(ink, x - r, y, 1, 1);
        this.rect(ink, x + r, y, 1, 1);
        this.rect(ink, x, y - Math.ceil(r / 2), 1, 1);
      }
    }
  }

  private drawStick(t: { x0: number; y0: number; x: number; y: number }, radiusCss: number): void {
    const f = this.dpr / this.zoom;
    const cx = t.x0 * f;
    const cy = t.y0 * f;
    const r = Math.round(radiusCss * f);
    let dx = t.x * f - cx;
    let dy = t.y * f - cy;
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

  /** HUD de la maquette (172 px de large), centré en haut de l'écran. */
  private drawHud(h: Hud): void {
    const ox = Math.floor((this.lw - MIN_LW) / 2);
    const t = this.top;
    this.box(ox + 4, t + 4, ox + 175, t + 38, 'K', 'C', 'M');
    this.text(h.us, ox + 12, t + 12, 'P');
    this.text(h.them, ox + 12, t + 25, 'L');
    this.rect('N', ox + 12, t + 20, 60, 1);
    // Pastille jaune devant l'équipe qui sert.
    this.rect('Y', ox + 7, t + (h.serving === 0 ? 14 : 27), 3, 3);
    if (h.games) {
      const cols: [string, string][] = [
        [String(h.games[0]), String(h.games[1])],
        [h.points[0], h.points[1]],
      ];
      cols.forEach(([a, c], i) => {
        const x = ox + 92 + i * 30;
        this.rect('N', x, t + 8, 25, 27);
        this.text(a, x + 12, t + 12, 'Y', 1, null, 0.5);
        this.text(c, x + 12, t + 25, 'W', 1, null, 0.5);
      });
    } else {
      // Match en un jeu : une seule case, pour les points (0, 15, 30, 40, AV).
      this.rect('N', ox + 92, t + 8, 55, 27);
      this.text(h.points[0], ox + 119, t + 12, 'Y', 1, null, 0.5);
      this.text(h.points[1], ox + 119, t + 25, 'W', 1, null, 0.5);
    }
    const m = Math.floor(h.seconds / 60);
    const sec = String(Math.floor(h.seconds % 60)).padStart(2, '0');
    this.text(`${Math.min(m, 9)}:${sec}`, ox + 173, t + 12, 'W', 1, null, 1);
    this.rect('P', ox + 149, t + 23, 25, 11);
    this.text(h.badge, ox + 161, t + 25, 'W', 1, null, 0.5);
  }

  private drawBottom(bottom: Bottom): void {
    if (!bottom) return;
    const top = this.lh - BOTTOM_H - this.bottomInset + 2;
    const mid = this.lw / 2;
    if (bottom.kind === 'hint') {
      const lines = wrap(bottom.text, Math.floor((this.lw - 6) / 6)).slice(0, 2);
      lines.forEach((l, i) => this.text(l, mid, top + (lines.length === 1 ? 7 : 2) + i * 10, 'W', 1, 'K', 0.5));
      return;
    }
    const cell = (x: number, label: string, dim: boolean) => {
      this.rect('K', x, top, 56, 18);
      this.frame(dim ? 'L' : 'C', x, top, 56, 18);
      this.text(label, x + 28, top + 6, dim ? 'L' : 'C', 1, null, 0.5);
    };
    cell(6, bottom.left, bottom.leftIsAi);
    cell(this.lw - 62, bottom.right, bottom.rightIsAi);
    this.text('STYLE', mid, top + 1, 'C', 1, 'K', 0.5);
    this.text(String(bottom.style), mid, top + 10, 'Y', 1, 'K', 0.5);
  }

  private drawBanner(n: Banner): void {
    const big = n.text.length * 12 <= this.lw - 8;
    const y = this.py(this.court.netY, 0) - (big ? 34 : 26);
    this.text(n.text, this.lw / 2, y, n.ink, big ? 2 : 1, 'K', 0.5);
    if (n.sub) this.text(n.sub, this.lw / 2, y + (big ? 20 : 12), 'Y', 1, 'K', 0.5);
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
