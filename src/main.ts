import './style.css';
import { mountTuningPanel, loadTuning, saveTuning } from './app/tuningPanel';
import { COURT, FIXED_DT } from './core/constants';
import { clamp } from './core/math/vec3';
import type { ContactEvent } from './core/physics/step';
import { createSandbox, launchBall, relaunch, tickSandbox } from './core/sandbox';
import { analyzeSwipe, shotVelocity, type Swipe } from './core/shot/swipeToShot';
import { attachSwipe } from './input/touch';
import { renderCourtLayer } from './render/courtLayer';
import { Fx } from './render/fx';
import { Projection } from './render/projection';
import { drawScene, type ShotPreview } from './render/scene';

/** Phase 0 — bac à sable physique : on lance la balle au swipe et on regarde les rebonds. */

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;
const panel = document.getElementById('panel')!;
const hint = document.getElementById('hint')!;
const btnDebug = document.getElementById('btn-debug') as HTMLButtonElement;
const btnLob = document.getElementById('btn-lob') as HTMLButtonElement;
const btnReplay = document.getElementById('btn-replay') as HTMLButtonElement;
const btnSettings = document.getElementById('btn-settings') as HTMLButtonElement;

const court = COURT;
const tuning = loadTuning();
const sandbox = createSandbox();
const fx = new Fx();
let proj = new Projection(tuning.view, court);
let courtLayer: HTMLCanvasElement;
let widthCss = 0;
let heightCss = 0;
let debug = readFlag('rebote.debug', true);
let preview: ShotPreview | null = null;
let playerX = court.width / 2;

function resize(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  widthCss = canvas.clientWidth;
  heightCss = canvas.clientHeight;
  canvas.width = Math.round(widthCss * dpr);
  canvas.height = Math.round(heightCss * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  proj = new Projection(tuning.view, court);
  proj.fit(widthCss, heightCss, { top: 56, bottom: Math.max(120, heightCss * 0.15), side: 16 });
  courtLayer = renderCourtLayer(proj, court, widthCss, heightCss, dpr);
}

function shotFromSwipe(swipe: Swipe): ShotPreview | null {
  const intent = analyzeSwipe(swipe, tuning.shot);
  if (!intent) return null;
  playerX = clamp(proj.courtXAt(swipe.points[0].x, tuning.shot.playerDepth), 0.6, court.width - 0.6);
  const origin = { x: playerX, y: tuning.shot.playerDepth, z: tuning.shot.contactHeight };
  return { intent, origin, vel: shotVelocity(intent, origin, tuning.shot, tuning.physics, court) };
}

attachSwipe(canvas, {
  onMove: (swipe) => {
    if (debug) preview = shotFromSwipe(swipe);
  },
  onEnd: (swipe) => {
    const shot = shotFromSwipe(swipe);
    preview = null;
    if (!shot) return;
    launchBall(sandbox, shot.origin, shot.vel);
    hint.classList.add('hidden');
  },
  onCancel: () => {
    preview = null;
  },
});

function refreshButtons(): void {
  btnDebug.classList.toggle('active', debug);
  btnLob.textContent = tuning.shot.lobMode === 'speed' ? 'Lob : lent' : 'Lob : crochet';
}

btnDebug.addEventListener('click', () => {
  debug = !debug;
  writeFlag('rebote.debug', debug);
  refreshButtons();
});
btnLob.addEventListener('click', () => {
  tuning.shot.lobMode = tuning.shot.lobMode === 'speed' ? 'hook' : 'speed';
  saveTuning(tuning);
  refreshButtons();
});
btnReplay.addEventListener('click', () => relaunch(sandbox));
btnSettings.addEventListener('click', () => panel.classList.toggle('hidden'));
mountTuningPanel(panel, tuning, (path) => {
  if (path === '*' || path.startsWith('view.')) resize();
  refreshButtons();
});
refreshButtons();

// Boucle : simulation à pas fixe (120 Hz), rendu à la fréquence de l'écran avec interpolation.
const events: ContactEvent[] = [];
let acc = 0;
let last = performance.now();
let fps = 60;

function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (dt > 0) fps += (1 / dt - fps) * 0.05;
  acc += dt;
  events.length = 0;
  while (acc >= FIXED_DT) {
    tickSandbox(sandbox, tuning, court, events);
    acc -= FIXED_DT;
  }
  for (const e of events) fx.add(e);
  fx.update(dt);
  // Une balle sortie disparaît après une seconde.
  if (sandbox.ball?.status === 'out' && sandbox.idleTicks > 120) sandbox.ball = null;

  drawScene(
    ctx,
    proj,
    courtLayer,
    fx,
    { sandbox, alpha: acc / FIXED_DT, tuning, court, playerX, debug, preview, fps },
    widthCss,
    heightCss,
  );
  requestAnimationFrame(frame);
}

document.addEventListener('visibilitychange', () => {
  last = performance.now();
  acc = 0;
});
window.addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, v: boolean): void {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    // Ignoré : préférence non conservée.
  }
}
