import './style.css';
import { mountTuningPanel, loadTuning, saveTuning } from './app/tuningPanel';
import { COURT, FIXED_DT, type AiLevel } from './core/constants';
import { clamp } from './core/math/vec3';
import type { ContactEvent } from './core/physics/step';
import { createGame, isHittable, tickGame, type Game, type GameEvent, type GameInput } from './core/play/game';
import type { Recording } from './core/play/replay';
import { REASON_FR } from './core/rules/rally';
import { createSandbox, launchBall, relaunch, tickSandbox } from './core/sandbox';
import { analyzeSwipe, shotVelocity, type Swipe } from './core/shot/swipeToShot';
import { attachSwipe } from './input/touch';
import { renderCourtLayer } from './render/courtLayer';
import { Fx } from './render/fx';
import { Projection } from './render/projection';
import { drawScene, type SceneInput, type ScenePlayer, type ShotPreview } from './render/scene';

/**
 * Deux modes :
 *  - « Échange » (phase 1) : 1 contre 1 face à l'IA, placement automatique, frappe au swipe ;
 *  - « Bac à sable » (phase 0) : on lance la balle et on regarde les rebonds, pour régler la physique.
 */

type Mode = 'rally' | 'sandbox';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;
const panel = document.getElementById('panel')!;
const hint = document.getElementById('hint')!;
const scoreEl = document.getElementById('score')!;
const feedbackEl = document.getElementById('feedback')!;
const btnMode = document.getElementById('btn-mode') as HTMLButtonElement;
const btnLevel = document.getElementById('btn-level') as HTMLButtonElement;
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
let mode: Mode = readString('rebote.mode', 'rally') === 'sandbox' ? 'sandbox' : 'rally';
let aiLevel = readString('rebote.level', 'facile') as AiLevel;
if (!['facile', 'moyen', 'fort'].includes(aiLevel)) aiLevel = 'facile';
let debug = readString('rebote.debug', '0') === '1';
let preview: ShotPreview | null = null;
let sandboxPlayerX = court.width / 2;

let game: Game;
/** Entrées de la partie en cours : avec la graine, de quoi la rejouer à l'identique. */
let recording: Recording;
const pendingInputs: GameInput[] = [];

function newGame(): void {
  const seed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
  game = createGame(seed, aiLevel, court);
  recording = { version: 1, seed, aiLevel, tuning: structuredClone(tuning), inputs: [], ticks: 0 };
  pendingInputs.length = 0;
  updateScore();
}
newGame();

function resize(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  widthCss = canvas.clientWidth;
  heightCss = canvas.clientHeight;
  canvas.width = Math.round(widthCss * dpr);
  canvas.height = Math.round(heightCss * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  proj = new Projection(tuning.view, court);
  proj.fit(widthCss, heightCss, { top: 64, bottom: Math.max(120, heightCss * 0.15), side: 16 });
  courtLayer = renderCourtLayer(proj, court, widthCss, heightCss, dpr);
}

function previewFromSwipe(swipe: Swipe): ShotPreview | null {
  const intent = analyzeSwipe(swipe, tuning.shot);
  if (!intent) return null;
  let origin;
  if (mode === 'sandbox') {
    sandboxPlayerX = clamp(proj.courtXAt(swipe.points[0].x, tuning.shot.playerDepth), 0.6, court.width - 0.6);
    origin = { x: sandboxPlayerX, y: tuning.shot.playerDepth, z: tuning.shot.contactHeight };
  } else {
    const human = game.players[0];
    origin = human.target ? { ...human.target.pos } : { x: human.pos.x, y: human.pos.y, z: tuning.play.idealContactZ };
  }
  return { intent, origin, vel: shotVelocity(intent, origin, tuning.shot, tuning.physics, court) };
}

attachSwipe(canvas, {
  onMove: (swipe) => {
    if (debug) preview = previewFromSwipe(swipe);
  },
  onEnd: (swipe) => {
    preview = null;
    const intent = analyzeSwipe(swipe, tuning.shot);
    if (!intent) return;
    hint.classList.add('hidden');
    if (mode === 'sandbox') {
      const shot = previewFromSwipe(swipe)!;
      launchBall(sandbox, shot.origin, shot.vel);
    } else {
      const input = { tick: game.tick, intent };
      pendingInputs.push(input);
      recording.inputs.push(input);
    }
  },
  onCancel: () => {
    preview = null;
  },
});

const LEVELS: AiLevel[] = ['facile', 'moyen', 'fort'];

function refreshButtons(): void {
  btnMode.textContent = mode === 'rally' ? 'Échange' : 'Bac à sable';
  btnLevel.textContent = `IA : ${aiLevel}`;
  btnLevel.classList.toggle('hidden', mode !== 'rally');
  btnReplay.classList.toggle('hidden', mode !== 'sandbox');
  scoreEl.classList.toggle('hidden', mode !== 'rally');
  btnDebug.classList.toggle('active', debug);
  btnLob.textContent = tuning.shot.lobMode === 'speed' ? 'Lob : lent' : 'Lob : crochet';
  hint.textContent =
    mode === 'rally'
      ? 'Swipe vers le haut quand l’anneau vert apparaît sous ton joueur'
      : 'Swipe vers le haut depuis le bas de l’écran';
}

btnMode.addEventListener('click', () => {
  mode = mode === 'rally' ? 'sandbox' : 'rally';
  writeString('rebote.mode', mode);
  if (mode === 'rally') newGame();
  refreshButtons();
});
btnLevel.addEventListener('click', () => {
  aiLevel = LEVELS[(LEVELS.indexOf(aiLevel) + 1) % LEVELS.length];
  writeString('rebote.level', aiLevel);
  newGame();
  refreshButtons();
});
btnDebug.addEventListener('click', () => {
  debug = !debug;
  writeString('rebote.debug', debug ? '1' : '0');
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

function updateScore(): void {
  scoreEl.innerHTML =
    `<span class="me">Toi ${game.score[0]}</span> · <span class="ai">IA ${game.score[1]}</span>` +
    `<small>échange ${game.shots} · record ${game.bestRally}</small>`;
}

let feedbackTimer = 0;
function showFeedback(text: string, kind: 'good' | 'bad' | 'info', ms = 900): void {
  feedbackEl.textContent = text;
  feedbackEl.className = `show ${kind}`;
  clearTimeout(feedbackTimer);
  feedbackTimer = window.setTimeout(() => (feedbackEl.className = ''), ms);
}

const TIMING_FR = { parfait: 'Parfait !', juste: 'Bien', tot: 'Trop tôt', tard: 'Trop tard' } as const;

function onGameEvent(e: GameEvent): void {
  if (e.type === 'contact') fx.add(e.contact);
  else if (e.type === 'hit' && e.side === 0) {
    showFeedback(TIMING_FR[e.timing], e.timing === 'parfait' ? 'good' : e.timing === 'juste' ? 'info' : 'bad', 700);
    updateScore();
  } else if (e.type === 'hit') updateScore();
  else if (e.type === 'point') {
    const mine = e.result.winner === 0;
    showFeedback(`${mine ? 'Point pour toi' : 'Point IA'} · ${REASON_FR[e.result.reason]}`, mine ? 'good' : 'bad', 1800);
    updateScore();
  }
}

// Boucle : simulation à pas fixe (120 Hz), rendu à la fréquence de l'écran avec interpolation.
const contacts: ContactEvent[] = [];
const gameEvents: GameEvent[] = [];
let acc = 0;
let last = performance.now();
let fps = 60;

function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (dt > 0) fps += (1 / dt - fps) * 0.05;
  acc += dt;
  while (acc >= FIXED_DT) {
    if (mode === 'sandbox') {
      contacts.length = 0;
      tickSandbox(sandbox, tuning, court, contacts);
      for (const c of contacts) fx.add(c);
    } else {
      gameEvents.length = 0;
      tickGame(game, pendingInputs, tuning, court, gameEvents);
      // Les entrées sont horodatées au tick où elles ont été reçues ; une fois ce tick passé, on les oublie.
      while (pendingInputs.length && pendingInputs[0].tick < game.tick) pendingInputs.shift();
      recording.ticks = game.tick;
      for (const e of gameEvents) onGameEvent(e);
    }
    acc -= FIXED_DT;
  }
  fx.update(dt);
  if (sandbox.ball?.status === 'out' && sandbox.idleTicks > 120) sandbox.ball = null;

  drawScene(ctx, proj, courtLayer, fx, sceneInput(acc / FIXED_DT), widthCss, heightCss);
  requestAnimationFrame(frame);
}

function sceneInput(alpha: number): SceneInput {
  const common = { alpha, tuning, court, debug, preview, fps };
  if (mode === 'sandbox') {
    return {
      ...common,
      ball: sandbox.ball,
      prevPos: sandbox.prevPos,
      lastContact: sandbox.lastContact,
      tick: sandbox.tick,
      players: [{ x: sandboxPlayerX, y: tuning.shot.playerDepth - 0.35, color: '#ff6b4a', hittable: false, target: null }],
      debugLines: [],
    };
  }
  const players: ScenePlayer[] = game.players.map((pl) => ({
    x: pl.pos.x,
    y: pl.pos.y,
    color: pl.isHuman ? '#ff6b4a' : '#4ad0ff',
    hittable: pl.isHuman && isHittable(game, pl, tuning, court),
    target: pl.target?.pos ?? null,
  }));
  const human = game.players[0];
  return {
    ...common,
    ball: game.ball,
    prevPos: game.prevPos,
    lastContact: game.lastContact,
    tick: game.tick,
    players,
    debugLines: [
      `phase ${game.phase} · IA ${game.aiLevel} · graine ${game.seed}`,
      human.target ? `frappe prévue dans ${((human.target.tick - game.tick) * FIXED_DT).toFixed(2)} s (${human.target.kind})` : 'pas de frappe prévue',
    ],
  };
}

document.addEventListener('visibilitychange', () => {
  last = performance.now();
  acc = 0;
});
window.addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);

// Pour le debug depuis la console du navigateur : copy(JSON.stringify(rebote.recording())).
(window as unknown as { rebote: object }).rebote = { recording: () => recording, game: () => game };

function readString(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeString(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    // Ignoré : préférence non conservée.
  }
}
