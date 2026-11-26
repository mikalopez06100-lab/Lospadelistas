/**
 * Par 3 / par 4 : pour un smash parfait frappé à différents endroits, dit où finit la balle
 * selon qu'il est ordinaire ou parfait (voir shot.smashFlat et shot.smashKick*). Sert à régler la rareté. Lancer : npm run sim
 */
import { it } from 'vitest';
import { COURT, FIXED_DT, createDefaultTuning } from '../src/core/constants';
import { createBall, stepBall, type ContactEvent } from '../src/core/physics/step';
import { shotVelocity } from '../src/core/shot/swipeToShot';

it('où finit un smash parfait', () => {
  const t = createDefaultTuning();
  const dt = FIXED_DT * t.physics.timeScale;
  for (const perfect of [false, true]) {
    const tally: Record<string, number> = {};
    for (const y of [5.5, 7, 8.5]) for (const z of [1.9, 2.2, 2.6]) for (const x of [2.5, 5, 7.5]) for (const aimDeg of [-35, -18, 0, 18, 35]) for (const power of [0.3, 0.6, 0.9]) {
      const from = { x, y, z };
      const ball = createBall(from, shotVelocity({ kind: 'smash', power, aim: (aimDeg * Math.PI) / 180, swipeSpeed: 0, curvature: 0 }, from, t.shot, t.physics, COURT));
      const ev: ContactEvent[] = [];
      let bounced = false;
      let end = 'en jeu';
      for (let i = 0; i < 900 && end === 'en jeu'; i++) {
        ev.length = 0;
        stepBall(ball, dt, t.physics, COURT, ev);
        for (const e of ev) {
          if (e.surface === 'ground' && !bounced) {
            bounced = true;
            if (e.pos.y > COURT.netY) ball.vel.z *= perfect ? t.shot.smashKickMin + (t.shot.smashKickMax - t.shot.smashKickMin) * power : t.shot.smashFlat;
            else end = 'filet/court';
          } else if (e.surface === 'ground') end = 'double rebond';
          else if (!bounced) end = 'faute';
        }
        if (ball.status === 'out') end = !bounced ? 'faute' : ball.pos.y > COURT.length ? 'PAR 4' : 'PAR 3';
      }
      tally[end] = (tally[end] ?? 0) + 1;
    }
    const total = Object.values(tally).reduce((a, b) => a + b, 0);
    console.log(`par : smash ${perfect ? 'parfait' : 'ordinaire'} → ` + Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${((100 * v) / total).toFixed(0)} %`).join(' · '));
  }
});
