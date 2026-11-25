import './style.css';
import { mountTuningPanel, loadTuning, saveTuning } from './app/tuningPanel';
import { COURT, FIXED_DT, type AiLevel } from './core/constants';
import { clamp } from './core/math/vec3';
import type { ContactEvent } from './core/physics/step';
import { createMatch, HUMAN_ID, isHittable, tickMatch, type Match, type MatchEvent, type MatchInput } from './core/play/match';
import type { Recording } from './core/play/replay';
import { REASON_FR } from './core/rules/rally';
import { pointsLabel } from './core/rules/score';
import { createSandbox, launchBall, relaunch, tickSandbox } from './core/sandbox';
import { analyzeSwipe, shotVelocity, type Swipe } from './core/shot/swipeToShot';
import { attachSwipe } from './input/touch';
import { renderCourtLayer } from './render/courtLayer';
import { Fx } from './render/fx';
import { Projection } from './render/projection';
import { drawScene, type SceneInput, type ScenePlayer, type ShotPreview } from './render/scene';

/**
 * Deux modes :
 *  - « Match » (phase 2) : double avec un partenaire IA contre deux IA, service, point en or ;
 *  - « Bac à sable » (phase 0) : on lance la balle et on regarde les rebonds, pour régler la physique.
 */

type Mode = 'rally' | 'sandbox';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;
const panel = document.getElementById('panel')!;
const hint = document.getElementById('hint')!;
const scoreEl = document.getElementById('score')!;
const feedbackEl = document.getElementById('feedback')!;
const overEl = document.getElementById('over')!;
const overText = document.getElementById('over-text')!;
const btnAgain = document.getElementById('btn-again') as HTMLButtonElement;
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

let game: Match;
/** Entrées du match en cours : avec la graine, de quoi le rejouer à l'identique. */
let recording: Recording;
const pendingInputs: MatchInput[] = [];

function newGame(): void {
  const seed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
  game = createMatch(seed, aiLevel, court, tuning.match.gamesToWin);
  recording = { version: 2, seed, aiLevel, tuning: structuredClone(tuning), inputs: [], ticks: 0 };
  pendingInputs.length = 0;
  overEl.classList.add('hidden');
  updateScore();
}

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
    const human = game.players[HUMAN_ID];
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
    if (mode === 'sandbox') {
      hint.classList.add('hidden');
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
  btnMode.textContent = mode === 'rally' ? 'Match' : 'Bac à sable';
  btnLevel.textContent = `IA : ${aiLevel}`;
  btnLevel.classList.toggle('hidden', mode !== 'rally');
  btnReplay.classList.toggle('hidden', mode !== 'sandbox');
  scoreEl.classList.toggle('hidden', mode !== 'rally');
  btnDebug.classList.toggle('active', debug);
  btnLob.textContent = tuning.shot.lobMode === 'speed' ? 'Lob : lent' : 'Lob : crochet';
  overEl.classList.toggle('hidden', mode !== 'rally' || game.phase !== 'over');
  refreshHint();
}

/** Consigne du moment : servir, ou frapper quand l'anneau s'allume. */
let lastHint = '';
function refreshHint(): void {
  let text = '';
  if (mode === 'sandbox') text = sandbox.ball ? '' : 'Swipe vers le haut depuis le bas de l’écran';
  else if (game.phase === 'serve' && game.serverId === HUMAN_ID) text = `À toi de servir${game.serveNumber === 2 ? ' (2e balle)' : ''} : swipe vers le haut`;
  else if (game.score.games[0] + game.score.games[1] === 0 && game.score.points[0] + game.score.points[1] === 0 && game.phase !== 'over')
    text = 'Quand l’anneau vert s’allume sous toi, swipe vers le haut';
  if (text === lastHint) return;
  lastHint = text;
  hint.textContent = text;
  hint.classList.toggle('hidden', !text);
}

btnMode.addEventListener('click', () => {
  mode = mode === 'rally' ? 'sandbox' : 'rally';
  writeString('rebote.mode', mode);
  if (mode === 'rally') newGame();
  refreshButtons();
});
btnAgain.addEventListener('click', () => {
  newGame();
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
  if (path === '*' || path.startsWith('match.')) newGame();
  refreshButtons();
});
newGame();
refreshButtons();

const NAMES = ['toi', 'ton partenaire', 'adversaire gauche', 'adversaire droit'];

function updateScore(): void {
  const s = game.score;
  const serving = game.servingTeam === 0 ? (game.serverId === HUMAN_ID ? 'tu sers' : 'ton partenaire sert') : 'ils servent';
  scoreEl.innerHTML =
    `<span class="me">Nous ${s.games[0]}</span> · <span class="ai">Eux ${s.games[1]}</span>` +
    `<small>${pointsLabel(s)} · ${serving} · jeux pour gagner : ${s.gamesToWin}</small>`;
}

let feedbackTimer = 0;
function showFeedback(text: string, kind: 'good' | 'bad' | 'info', ms = 900): void {
  feedbackEl.textContent = text;
  feedbackEl.className = `show ${kind}`;
  clearTimeout(feedbackTimer);
  feedbackTimer = window.setTimeout(() => (feedbackEl.className = ''), ms);
}

const TIMING_FR = { parfait: 'Parfait !', juste: 'Bien', tot: 'Trop tôt', tard: 'Trop tard' } as const;

function onGameEvent(e: MatchEvent): void {
  if (e.type === 'contact') fx.add(e.contact);
  else if (e.type === 'hit' && e.playerId === HUMAN_ID) {
    showFeedback(TIMING_FR[e.timing], e.timing === 'parfait' ? 'good' : e.timing === 'juste' ? 'info' : 'bad', 700);
  } else if (e.type === 'fault') {
    showFeedback(e.double ? 'Double faute' : 'Faute · 2e balle', 'bad', 1200);
  } else if (e.type === 'let') {
    showFeedback('Let · on rejoue', 'info', 1000);
  } else if (e.type === 'serve') {
    updateScore();
  } else if (e.type === 'point') {
    const ours = e.result.winner === 0;
    const what = e.match ? (ours ? 'Match gagné !' : 'Match perdu') : e.game ? (ours ? 'Jeu pour nous' : 'Jeu pour eux') : ours ? 'Point pour nous' : 'Point pour eux';
    showFeedback(`${what} · ${REASON_FR[e.result.reason]}`, ours ? 'good' : 'bad', e.game ? 2200 : 1600);
    updateScore();
    if (e.match) {
      overText.textContent = `${ours ? 'Victoire' : 'Défaite'} ${game.score.games[0]} – ${game.score.games[1]} · plus long échange : ${game.bestRally} coups`;
      setTimeout(() => refreshButtons(), 1800);
    }
  }
}

// Boucle : simulation à pas fixe (120 Hz), rendu à la fréquence de l'écran avec interpolation.
const contacts: ContactEvent[] = [];
const gameEvents: MatchEvent[] = [];
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
      tickMatch(game, pendingInputs, tuning, court, gameEvents);
      // Les entrées sont horodatées au tick où elles ont été reçues ; une fois ce tick passé, on les oublie.
      while (pendingInputs.length && pendingInputs[0].tick < game.tick) pendingInputs.shift();
      recording.ticks = game.tick;
      for (const e of gameEvents) onGameEvent(e);
    }
    acc -= FIXED_DT;
  }
  fx.update(dt);
  if (sandbox.ball?.status === 'out' && sandbox.idleTicks > 120) sandbox.ball = null;
  refreshHint();

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
  const COLORS = ['#ff6b4a', '#ffb199', '#4ad0ff', '#2a8fc0'];
  const players: ScenePlayer[] = game.players.map((pl) => ({
    x: pl.pos.x,
    y: pl.pos.y,
    color: COLORS[pl.id],
    hittable: pl.isHuman && isHittable(game, pl, tuning, court),
    target: pl.target?.pos ?? null,
  }));
  const human = game.players[HUMAN_ID];
  const assigned = game.assigned.map((id) => (id === null ? '—' : NAMES[id])).join(' / ');
  return {
    ...common,
    ball: game.ball,
    prevPos: game.prevPos,
    lastContact: game.lastContact,
    tick: game.tick,
    players,
    debugLines: [
      `phase ${game.phase} · IA ${game.aiLevel} · graine ${game.seed}`,
      `balle pour : ${assigned} · ${game.shots} coups`,
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
