/**
 * Jouabilité après la vitre de fond : pour des balles adverses qui rebondissent à différentes
 * profondeurs, mesure ce qu'il reste à jouer une fois la vitre touchée (temps disponible,
 * hauteur, distance de la vitre). Sert à régler les rebonds. Lancer : npm run sim
 */
import { it } from 'vitest';
import { AI_LEVELS, COURT, FIXED_DT, createDefaultTuning } from '../src/core/constants';
import { createBall, stepBall, type ContactEvent } from '../src/core/physics/step';
import { aimAt } from '../src/core/shot/aim';

it('jouabilité après la vitre', () => {
  const t = createDefaultTuning();
  const dt = FIXED_DT * t.physics.timeScale;
  console.log(`vitre : sol ${t.physics.ground.restitution}/${t.physics.ground.tangentialKeep} · vitre ${t.physics.glass.restitution}/${t.physics.glass.tangentialKeep}`);
  for (const level of ['facile', 'moyen', 'fort'] as const)
  for (const depth of [1.5, 2.5, 3.5, 4.5, 6]) {
    const origin = { x: 5, y: 17, z: 1 };
    const shot = { ...t.shot, netClearance: t.shot.netClearance + AI_LEVELS[level].loft };
    const ball = createBall(origin, aimAt(origin, { x: 5, y: depth }, 'drive', -1, shot, t.physics, COURT));
    const ev: ContactEvent[] = [];
    let glassAt = -1;
    let maxZ = 0;
    let playable = 0;
    let endY = 0;
    let bounces = 0;
    for (let i = 0; i < 1200; i++) {
      ev.length = 0;
      stepBall(ball, dt, t.physics, COURT, ev);
      for (const e of ev) {
        if (e.surface === 'ground') bounces++;
        if (e.surface === 'glass' && glassAt < 0 && bounces === 1) glassAt = i;
      }
      if (bounces >= 2) {
        endY = ball.pos.y;
        break;
      }
      if (glassAt >= 0) {
        maxZ = Math.max(maxZ, ball.pos.z);
        if (ball.pos.z >= t.play.minContactZ + 0.15) playable++;
      }
    }
    console.log(
      glassAt < 0
        ? `vitre : ${level} · rebond à ${depth} m du fond → 2e rebond avant la vitre`
        : `vitre : ${level} · rebond à ${depth} m du fond → après la vitre : ${(playable * FIXED_DT).toFixed(2)} s jouables, hauteur max ${maxZ.toFixed(2)} m, 2e rebond à ${endY.toFixed(1)} m de la vitre`,
    );
  }
});
