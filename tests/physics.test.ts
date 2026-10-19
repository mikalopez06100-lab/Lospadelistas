import { describe, expect, it } from 'vitest';
import { COURT, DEFAULT_PHYSICS, type PhysicsParams } from '../src/core/constants';
import { predict } from '../src/core/physics/predict';
import { createBall, stepBall, type BallState, type ContactEvent } from '../src/core/physics/step';

const noDrag: PhysicsParams = { ...DEFAULT_PHYSICS, airDrag: 0 };
const r = DEFAULT_PHYSICS.ballRadius;

function run(ball: BallState, p: PhysicsParams, dt: number, maxSteps: number, untilEvents = 1) {
  const events: ContactEvent[] = [];
  let steps = 0;
  let firstEventTime = NaN;
  while (steps < maxSteps && events.length < untilEvents) {
    const before = events.length;
    stepBall(ball, dt, p, COURT, events);
    if (before === 0 && events.length > 0) firstEventTime = steps * dt + events[0].t;
    steps++;
  }
  return { events, firstEventTime };
}

describe('sol', () => {
  it('chute libre : impact au temps exact, quel que soit le pas', () => {
    const h = 2;
    const expected = Math.sqrt((2 * (h - r)) / noDrag.gravity);
    for (const dt of [1 / 120, 0.05, 0.3]) {
      const ball = createBall({ x: 5, y: 5, z: h }, { x: 0, y: 0, z: 0 });
      const { firstEventTime, events } = run(ball, noDrag, dt, 1000);
      expect(events[0].surface).toBe('ground');
      expect(firstEventTime).toBeCloseTo(expected, 9);
    }
  });

  it('rebond : vitesse verticale × restitution', () => {
    const ball = createBall({ x: 5, y: 5, z: 2 }, { x: 0, y: 0, z: 0 });
    const { events } = run(ball, noDrag, 1 / 120, 1000);
    const vIn = events[0].normalSpeed;
    expect(vIn).toBeCloseTo(Math.sqrt(2 * noDrag.gravity * (2 - r)), 6);
    // Vitesse juste après l'impact, reconstituée en remontant le temps écoulé dans le pas.
    const elapsed = 1 / 120 - events[0].t;
    expect(ball.vel.z + noDrag.gravity * elapsed).toBeCloseTo(vIn * noDrag.ground.restitution, 6);
  });

  it('finit par rouler puis s’arrêter', () => {
    const ball = createBall({ x: 5, y: 5, z: 2 }, { x: 1, y: 1, z: 0 });
    for (let i = 0; i < 120 * 30 && ball.status !== 'stopped'; i++) stepBall(ball, 1 / 120, DEFAULT_PHYSICS, COURT);
    expect(ball.status).toBe('stopped');
    expect(ball.pos.z).toBeCloseTo(r, 9);
  });

  it('l’énergie n’augmente jamais à un rebond', () => {
    const ball = createBall({ x: 2, y: 3, z: 1 }, { x: 7, y: 22, z: 4 });
    const events: ContactEvent[] = [];
    let prevEnergy = energy(ball, noDrag);
    for (let i = 0; i < 120 * 5; i++) {
      stepBall(ball, 1 / 120, noDrag, COURT, events);
      const e = energy(ball, noDrag);
      expect(e).toBeLessThanOrEqual(prevEnergy + 1e-9);
      prevEnergy = e;
    }
    expect(events.length).toBeGreaterThan(2);
  });
});

function energy(b: BallState, p: PhysicsParams) {
  return 0.5 * (b.vel.x ** 2 + b.vel.y ** 2 + b.vel.z ** 2) + p.gravity * (b.pos.z - r);
}

describe('vitres', () => {
  const flat: PhysicsParams = { ...noDrag, gravity: 0 };

  it('vitre de fond : réflexion avec perte d’énergie', () => {
    const ball = createBall({ x: 5, y: 15, z: 1.5 }, { x: 3, y: 20, z: 0 });
    const { events } = run(ball, flat, 1 / 120, 1000);
    expect(events[0]).toMatchObject({ surface: 'glass', plane: 'backFar' });
    expect(ball.vel.y).toBeCloseTo(-20 * flat.glass.restitution, 9);
    expect(ball.vel.x).toBeCloseTo(3 * flat.glass.tangentialKeep, 9);
    expect(ball.pos.y).toBeLessThan(COURT.length);
  });

  it('au-dessus de la vitre, la balle sort', () => {
    const ball = createBall({ x: 5, y: 15, z: 3.5 }, { x: 0, y: 20, z: 0 });
    const { events } = run(ball, flat, 1 / 120, 100);
    expect(events).toHaveLength(0);
    expect(ball.status).toBe('out');
  });

  it('pas d’effet tunnel, même à 200 m/s avec un pas énorme', () => {
    const ball = createBall({ x: 5, y: 15, z: 1.5 }, { x: 0, y: 200, z: 0 });
    stepBall(ball, 0.1, flat, COURT);
    expect(ball.status).toBe('flying');
    expect(ball.vel.y).toBeLessThan(0);
    expect(ball.pos.y).toBeGreaterThan(0);
    expect(ball.pos.y).toBeLessThan(COURT.length);
  });

  it('coin : deux vitres dans le même pas', () => {
    const ball = createBall({ x: 9, y: 19, z: 1.5 }, { x: 10, y: 10, z: 0 });
    const events: ContactEvent[] = [];
    stepBall(ball, 0.5, flat, COURT, events);
    expect(events.map((e) => e.plane).sort()).toEqual(['backFar', 'right']);
    expect(ball.vel.x).toBeLessThan(0);
    expect(ball.vel.y).toBeLessThan(0);
  });

  it('latéral : vitre sur les 4 premiers mètres, grillage plus mou ensuite', () => {
    const glassHit = createBall({ x: 5, y: 2, z: 1 }, { x: -10, y: 0, z: 0 });
    const fenceHit = createBall({ x: 5, y: 8, z: 1 }, { x: -10, y: 0, z: 0 });
    const a = run(glassHit, flat, 1 / 120, 100).events[0];
    const b = run(fenceHit, flat, 1 / 120, 100).events[0];
    expect(a.surface).toBe('glass');
    expect(b.surface).toBe('fence');
    expect(Math.abs(fenceHit.vel.x)).toBeLessThan(Math.abs(glassHit.vel.x));
  });
});

describe('filet', () => {
  it('une balle basse est arrêtée et reste du côté du frappeur', () => {
    const ball = createBall({ x: 5, y: 7, z: 0.5 }, { x: 0, y: 15, z: 0 });
    const { events } = run(ball, { ...noDrag, gravity: 0 }, 1 / 120, 200);
    expect(events[0].surface).toBe('net');
    expect(ball.pos.y).toBeLessThan(COURT.netY);
    expect(ball.vel.y).toBeLessThan(0);
  });

  it('une balle haute passe', () => {
    const ball = createBall({ x: 5, y: 7, z: 1.5 }, { x: 0, y: 15, z: 0 });
    stepBall(ball, 0.5, { ...noDrag, gravity: 0 }, COURT);
    expect(ball.pos.y).toBeGreaterThan(COURT.netY);
  });
});

describe('prédiction', () => {
  it('est identique au pas-à-pas du jeu (même physique, déterministe)', () => {
    const start = createBall({ x: 3, y: 1.5, z: 1 }, { x: 2, y: 18, z: 3 });
    const dt = 1 / 120;
    const pred = predict(start, DEFAULT_PHYSICS, COURT, dt, 3, 1);
    const ball = createBall(start.pos, start.vel);
    for (let i = 1; i < pred.points.length && ball.status !== 'stopped' && ball.status !== 'out'; i++) {
      stepBall(ball, dt, DEFAULT_PHYSICS, COURT);
      expect(ball.pos).toEqual(pred.points[i]);
    }
    expect(start.pos).toEqual({ x: 3, y: 1.5, z: 1 });
  });
});
