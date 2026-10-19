import { describe, expect, it } from 'vitest';
import { COURT, DEFAULT_PHYSICS, DEFAULT_SHOT, FIXED_DT, type ShotParams } from '../src/core/constants';
import { DEG } from '../src/core/math/vec3';
import { predict } from '../src/core/physics/predict';
import { createBall } from '../src/core/physics/step';
import { analyzeSwipe, shotVelocity, type SwipeSample } from '../src/core/shot/swipeToShot';

const H = 800;

/** Swipe rectiligne de (x0,y0) à (x1,y1) en `ms` millisecondes, échantillonné à 60 Hz. */
function line(x0: number, y0: number, x1: number, y1: number, ms: number, bend = 0): SwipeSample[] {
  const n = Math.max(2, Math.round(ms / 16));
  const pts: SwipeSample[] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    pts.push({ x: x0 + (x1 - x0) * f + bend * Math.sin(Math.PI * f), y: y0 + (y1 - y0) * f, t: ms * f });
  }
  return pts;
}

describe('analyse du swipe', () => {
  it('ignore les swipes vers le bas et les micro-gestes', () => {
    expect(analyzeSwipe({ points: line(200, 400, 200, 600, 150), viewportHeight: H }, DEFAULT_SHOT)).toBeNull();
    expect(analyzeSwipe({ points: line(200, 600, 200, 590, 50), viewportHeight: H }, DEFAULT_SHOT)).toBeNull();
  });

  it('mode vitesse : rapide = coup tendu, lent = lob', () => {
    const fast = analyzeSwipe({ points: line(200, 700, 200, 300, 120), viewportHeight: H }, DEFAULT_SHOT);
    const slow = analyzeSwipe({ points: line(200, 700, 200, 550, 700), viewportHeight: H }, DEFAULT_SHOT);
    expect(fast?.kind).toBe('drive');
    expect(slow?.kind).toBe('lob');
  });

  it('un pouce qui ralentit en fin de geste garde sa puissance', () => {
    // 300 px en 100 ms, puis 10 px pendant les 120 ms suivantes.
    const pts = [...line(200, 700, 200, 400, 100), ...line(200, 400, 200, 390, 120).slice(1).map((p) => ({ ...p, t: p.t + 100 }))];
    const intent = analyzeSwipe({ points: pts, viewportHeight: H }, DEFAULT_SHOT);
    expect(intent?.kind).toBe('drive');
  });

  it('mode crochet : droit = coup tendu, courbé = lob', () => {
    const s: ShotParams = { ...DEFAULT_SHOT, lobMode: 'hook' };
    const straight = analyzeSwipe({ points: line(200, 700, 200, 400, 150), viewportHeight: H }, s);
    const hooked = analyzeSwipe({ points: line(200, 700, 200, 400, 150, 80), viewportHeight: H }, s);
    expect(straight?.kind).toBe('drive');
    expect(hooked?.kind).toBe('lob');
  });

  it('direction : swipe vers la droite = coup vers la droite, borné', () => {
    const right = analyzeSwipe({ points: line(200, 700, 260, 400, 150), viewportHeight: H }, DEFAULT_SHOT);
    const extreme = analyzeSwipe({ points: line(200, 700, 700, 650, 150), viewportHeight: H }, DEFAULT_SHOT);
    expect(right!.aim).toBeGreaterThan(0);
    expect(Math.abs(extreme!.aim)).toBeCloseTo(DEFAULT_SHOT.maxAimDeg * DEG, 9);
  });
});

describe('vitesse de frappe', () => {
  const origin = { x: 5, y: DEFAULT_SHOT.playerDepth, z: DEFAULT_SHOT.contactHeight };

  it.each([0, 0.5, 1])('un coup tendu de puissance %s passe le filet', (power) => {
    const vel = shotVelocity({ kind: 'drive', power, aim: 0, swipeSpeed: 0, curvature: 0 }, origin, DEFAULT_SHOT, DEFAULT_PHYSICS, COURT);
    const pred = predict(createBall(origin, vel), DEFAULT_PHYSICS, COURT, FIXED_DT * DEFAULT_PHYSICS.timeScale, 4);
    expect(pred.contacts[0].surface).not.toBe('net');
    expect(pred.contacts[0].pos.y).toBeGreaterThan(COURT.netY);
  });

  it.each([0, 0.5, 1])('un lob de puissance %s retombe dans le camp adverse avant la vitre', (power) => {
    const vel = shotVelocity({ kind: 'lob', power, aim: 0, swipeSpeed: 0, curvature: 0 }, origin, DEFAULT_SHOT, DEFAULT_PHYSICS, COURT);
    const pred = predict(createBall(origin, vel), DEFAULT_PHYSICS, COURT, FIXED_DT * DEFAULT_PHYSICS.timeScale, 6);
    expect(pred.contacts[0].surface).toBe('ground');
    expect(pred.contacts[0].pos.y).toBeGreaterThan(COURT.netY);
    expect(pred.contacts[0].pos.y).toBeLessThan(COURT.length);
  });
});
