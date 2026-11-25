import { describe, expect, it } from 'vitest';
import { COURT, DEFAULT_PHYSICS } from '../src/core/constants';
import { createBall, stepBall, type BallState, type ContactEvent, type Surface } from '../src/core/physics/step';
import { canHit, createRally, onBallStatus, onContact, onHit, startServe, type RallyState } from '../src/core/rules/rally';

function ev(surface: Surface, y: number): ContactEvent {
  return { surface, plane: surface === 'ground' ? 'ground' : 'backFar', pos: { x: 5, y, z: 0 }, normalSpeed: 5, t: 0 };
}

function rallyAfterHitBy(side: 0 | 1): RallyState {
  const r = createRally();
  onHit(r, side);
  return r;
}

describe('règles de l’échange', () => {
  it('double rebond chez le receveur : point pour le frappeur', () => {
    const r = rallyAfterHitBy(0);
    onContact(r, ev('ground', 15), COURT);
    expect(r.result).toBeNull();
    onContact(r, ev('ground', 17), COURT);
    expect(r.result).toEqual({ winner: 0, reason: 'double-rebond' });
  });

  it('vitre adverse touchée directement : faute du frappeur', () => {
    const r = rallyAfterHitBy(0);
    onContact(r, ev('glass', 20), COURT);
    expect(r.result).toEqual({ winner: 1, reason: 'vitre-directe' });
  });

  it('vitre adverse après un rebond : la balle reste en jeu', () => {
    const r = rallyAfterHitBy(0);
    onContact(r, ev('ground', 17), COURT);
    onContact(r, ev('glass', 20), COURT);
    expect(r.result).toBeNull();
  });

  it('le frappeur peut jouer contre sa propre vitre', () => {
    const r = rallyAfterHitBy(0);
    onContact(r, ev('glass', 0), COURT);
    onContact(r, ev('ground', 14), COURT);
    expect(r.result).toBeNull();
  });

  it('balle dans le filet qui retombe chez le frappeur : faute « filet »', () => {
    const r = rallyAfterHitBy(1);
    onContact(r, { ...ev('net', 10), pos: { x: 5, y: 10.03, z: 0.5 } }, COURT);
    onContact(r, ev('ground', 11), COURT);
    expect(r.result).toEqual({ winner: 0, reason: 'filet' });
  });

  it('sortie avant rebond : faute ; sortie après rebond : point', () => {
    const out: BallState = { pos: { x: 12, y: 15, z: 1 }, vel: { x: 0, y: 0, z: 0 }, status: 'out' };
    const a = rallyAfterHitBy(0);
    onBallStatus(a, out);
    expect(a.result).toEqual({ winner: 1, reason: 'dehors' });
    const b = rallyAfterHitBy(0);
    onContact(b, ev('ground', 15), COURT);
    onBallStatus(b, out);
    expect(b.result).toEqual({ winner: 0, reason: 'sortie-apres-rebond' });
  });

  it('une frappe remet le compteur de rebonds à zéro', () => {
    const r = rallyAfterHitBy(0);
    onContact(r, ev('ground', 15), COURT);
    onHit(r, 1);
    onContact(r, ev('ground', 5), COURT);
    expect(r.result).toBeNull();
  });

  it('on ne frappe que dans son camp, et pas deux fois de suite', () => {
    const r = rallyAfterHitBy(0);
    expect(canHit(r, 1, 15, COURT)).toBe(true);
    expect(canHit(r, 1, 5, COURT)).toBe(false);
    expect(canHit(r, 0, 5, COURT)).toBe(false);
  });

  it('avec la vraie physique : un coup long qui finit dans la vitre de fond adverse est une faute', () => {
    const r = rallyAfterHitBy(0);
    const ball = createBall({ x: 5, y: 2, z: 1.5 }, { x: 0, y: 35, z: 2 });
    const events: ContactEvent[] = [];
    for (let i = 0; i < 240 && !r.result; i++) {
      events.length = 0;
      stepBall(ball, 1 / 120, DEFAULT_PHYSICS, COURT, events);
      for (const e of events) onContact(r, e, COURT);
      onBallStatus(r, ball);
    }
    expect(r.result?.reason).toBe('vitre-directe');
  });
});

describe('service', () => {
  // Service du camp 0 vers le carré de droite du camp 1 (vu depuis le camp 1 : x < 5).
  const box = { xMin: 0, xMax: 5, yMin: 10, yMax: 16.95 };
  const at = (surface: Surface, x: number, y: number): ContactEvent => ({
    surface,
    plane: surface === 'ground' ? 'ground' : surface === 'net' ? 'net' : 'backFar',
    pos: { x, y, z: 0 },
    normalSpeed: 5,
    t: 0,
  });
  const served = () => {
    const r = createRally();
    startServe(r, 0, box, 2);
    return r;
  };

  it('rebond dans le carré en diagonale : bon', () => {
    const r = served();
    onContact(r, at('ground', 3, 14), COURT);
    expect(r.result).toBeNull();
  });

  it('rebond hors du carré : faute de service', () => {
    const wrongSide = served();
    onContact(wrongSide, at('ground', 7, 14), COURT);
    expect(wrongSide.result).toEqual({ winner: 1, reason: 'faute-service' });
    const tooLong = served();
    onContact(tooLong, at('ground', 3, 18), COURT);
    expect(tooLong.result?.reason).toBe('faute-service');
  });

  it('filet puis carré : let ; filet puis hors carré : faute', () => {
    const a = served();
    onContact(a, { ...at('net', 3, 10.03), plane: 'net' }, COURT);
    onContact(a, at('ground', 3, 12), COURT);
    expect(a.result?.reason).toBe('let');
    const b = served();
    onContact(b, at('net', 3, 9.97), COURT);
    onContact(b, at('ground', 3, 9), COURT);
    expect(b.result?.reason).toBe('faute-service');
  });

  it('après le rebond : vitre permise, grillage interdit', () => {
    const glass = served();
    onContact(glass, at('ground', 3, 15), COURT);
    onContact(glass, at('glass', 0, 18), COURT);
    expect(glass.result).toBeNull();
    const fence = served();
    onContact(fence, at('ground', 3, 15), COURT);
    onContact(fence, { ...at('fence', 0, 13), plane: 'left' }, COURT);
    expect(fence.result).toEqual({ winner: 1, reason: 'faute-service' });
  });

  it('seul le receveur peut jouer le service, et pas de volée au retour', () => {
    const r = served();
    expect(canHit(r, 1, 14, COURT, 2)).toBe(false);
    onContact(r, at('ground', 3, 14), COURT);
    expect(canHit(r, 1, 15, COURT, 2)).toBe(true);
    expect(canHit(r, 1, 15, COURT, 3)).toBe(false);
    onHit(r, 1);
    expect(r.serve).toBeNull();
    expect(canHit(r, 0, 5, COURT, 0)).toBe(true);
    expect(canHit(r, 0, 5, COURT, 1)).toBe(true);
  });

  it('service non repris : double rebond, point pour le serveur', () => {
    const r = served();
    onContact(r, at('ground', 3, 14), COURT);
    onContact(r, at('ground', 3, 17), COURT);
    expect(r.result).toEqual({ winner: 0, reason: 'double-rebond' });
  });
});
