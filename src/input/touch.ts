import type { Swipe, SwipeSample } from '../core/shot/swipeToShot';

export interface SwipeHandlers {
  /** Geste en cours (pour l'aperçu de trajectoire en debug). */
  onMove?: (swipe: Swipe) => void;
  onEnd: (swipe: Swipe) => void;
  onCancel?: () => void;
}

/**
 * Swipe à un doigt, via Pointer Events. Le geste n'est accepté que s'il commence
 * dans la moitié basse de l'écran (zone du pouce).
 */
export function attachSwipe(el: HTMLElement, handlers: SwipeHandlers): () => void {
  let pointerId: number | null = null;
  let points: SwipeSample[] = [];

  const toSwipe = (): Swipe => ({ points, viewportHeight: el.clientHeight });
  const sample = (e: PointerEvent): SwipeSample => {
    const rect = el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, t: e.timeStamp };
  };

  const down = (e: PointerEvent) => {
    if (pointerId !== null) return;
    const s = sample(e);
    if (s.y < el.clientHeight * 0.5) return;
    pointerId = e.pointerId;
    points = [s];
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    // Les événements regroupés donnent un tracé plus fin sur les écrans 120 Hz.
    const coalesced = e.getCoalescedEvents?.() ?? [];
    for (const c of coalesced.length ? coalesced : [e]) points.push(sample(c));
    handlers.onMove?.(toSwipe());
    e.preventDefault();
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    points.push(sample(e));
    pointerId = null;
    handlers.onEnd(toSwipe());
    points = [];
  };
  const cancel = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    points = [];
    handlers.onCancel?.();
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
  };
}
