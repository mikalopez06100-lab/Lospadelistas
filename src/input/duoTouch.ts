import type { Vec2 } from '../core/math/vec3';
import type { Swipe, SwipeSample } from '../core/shot/swipeToShot';

/**
 * Contrôle à deux pouces (mode Duo). Chaque moitié de l'écran dirige un joueur :
 *  - poser et glisser le pouce = stick flottant, le joueur se déplace ;
 *  - coup de pouce sec (geste court et bref) = frappe.
 * Un même doigt fait l'un ou l'autre : c'est la durée du geste qui tranche.
 */
export interface DuoOptions {
  /** Le jeu accepte-t-il les gestes en ce moment ? */
  enabled: () => boolean;
  /** Au-delà de cette durée (ms), le geste est un déplacement, plus une frappe. */
  flickMaxMs: number;
  /**
   * Le stick ne s'active que quand le pouce s'est posé depuis ce délai (ms) ET qu'il s'est
   * stabilisé : tant que le doigt file (frappe en cours), le joueur ne bouge pas.
   */
  stickDelayMs: number;
  /** Course du stick en px : au-delà, vitesse maximale. */
  radiusPx: number;
  onStick: (playerId: number, stick: Vec2 | null) => void;
  /** Doigt relevé. `quick` = geste assez bref pour être une frappe. */
  onRelease: (playerId: number, swipe: Swipe, quick: boolean) => void;
}

export interface DuoTouch {
  playerId: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  stickActive: boolean;
}

interface Tracked extends DuoTouch {
  t0: number;
  points: SwipeSample[];
  lastKey: string;
  /** Dernier mouvement du doigt et sa vitesse lissée (px/s), pour savoir s'il s'est stabilisé. */
  lastMoveT: number;
  speed: number;
}

/** Sous cette vitesse (px/s), le pouce est considéré comme posé : c'est un déplacement, pas une frappe. */
const SETTLED_SPEED = 140;

export function attachDuo(el: HTMLElement, o: DuoOptions): { touches: () => readonly DuoTouch[] } {
  const tracked = new Map<number, Tracked>();
  const list: Tracked[] = [];
  const sync = () => {
    list.length = 0;
    for (const t of tracked.values()) list.push(t);
  };
  // performance.now() partout : l'horodatage des événements n'a pas la même origine sur tous les navigateurs.
  const local = (e: PointerEvent): SwipeSample => {
    const rect = el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, t: performance.now() };
  };

  const updateStick = (t: Tracked, now: number) => {
    if (!t.stickActive) {
      const held = now - t.t0;
      const settled = now - t.lastMoveT > 60 || t.speed < SETTLED_SPEED;
      if (held < o.flickMaxMs && (held < o.stickDelayMs || !settled)) return;
      t.stickActive = true;
    }
    let sx = (t.x - t.x0) / o.radiusPx;
    let sy = -(t.y - t.y0) / o.radiusPx; // haut de l'écran = vers le filet adverse
    const n = Math.hypot(sx, sy);
    if (n > 1) {
      sx /= n;
      sy /= n;
    }
    // Zone morte, puis quantification : une entrée n'est émise que si la commande change vraiment,
    // ce qui garde l'enregistrement du match (fantômes) léger.
    const q = (v: number) => Math.round(v * 4) / 4;
    const stick = n < 0.2 ? null : { x: q(sx), y: q(sy) };
    const key = stick ? `${stick.x},${stick.y}` : '';
    if (key === t.lastKey) return;
    t.lastKey = key;
    o.onStick(t.playerId, stick);
  };

  el.addEventListener('pointerdown', (e) => {
    if (!o.enabled()) return;
    const s = local(e);
    // Un seul doigt par moitié d'écran : moitié gauche = joueur de gauche (1), droite = joueur de droite (0).
    const playerId = s.x < el.clientWidth / 2 ? 1 : 0;
    for (const t of tracked.values()) if (t.playerId === playerId) return;
    tracked.set(e.pointerId, { playerId, x0: s.x, y0: s.y, x: s.x, y: s.y, stickActive: false, t0: s.t, points: [s], lastKey: '', lastMoveT: s.t, speed: 0 });
    sync();
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  el.addEventListener('pointermove', (e) => {
    const t = tracked.get(e.pointerId);
    if (!t) return;
    const s = local(e);
    const dtMs = Math.max(1, s.t - t.lastMoveT);
    const v = (Math.hypot(s.x - t.x, s.y - t.y) / dtMs) * 1000;
    t.speed += (v - t.speed) * 0.5;
    t.lastMoveT = s.t;
    t.x = s.x;
    t.y = s.y;
    if (t.points.length < 64) t.points.push(s);
    updateStick(t, s.t);
    e.preventDefault();
  });

  const end = (e: PointerEvent, cancelled: boolean) => {
    const t = tracked.get(e.pointerId);
    if (!t) return;
    tracked.delete(e.pointerId);
    sync();
    const s = local(e);
    t.points.push(s);
    if (t.lastKey !== '') o.onStick(t.playerId, null);
    if (!cancelled) o.onRelease(t.playerId, { points: t.points, viewportHeight: el.clientHeight }, s.t - t.t0 <= o.flickMaxMs);
  };
  el.addEventListener('pointerup', (e) => end(e, false));
  el.addEventListener('pointercancel', (e) => end(e, true));

  return {
    touches: () => {
      // Un pouce qui a glissé puis s'est immobilisé n'émet plus d'événement : le stick est donc
      // aussi évalué ici, à chaque image, sinon le joueur ne partirait jamais.
      const now = performance.now();
      for (const t of list) updateStick(t, now);
      return list;
    },
  };
}
