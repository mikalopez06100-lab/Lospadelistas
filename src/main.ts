import './style.css';
import { mountTuningPanel, loadTuning, saveTuning } from './app/tuningPanel';
import { canVibrate, Sfx, vibrate } from './audio/sfx';
import { COURT, FIXED_DT, STYLE, type AiLevel } from './core/constants';
import { clamp, type Vec3 } from './core/math/vec3';
import type { ContactEvent } from './core/physics/step';
import { createMatch, HUMAN_ID, isHittable, tickMatch, type ControlMode, type Match, type MatchEvent, type MatchInput } from './core/play/match';
import { predict } from './core/physics/predict';
import type { Recording } from './core/play/replay';
import { REASON_FR } from './core/rules/rally';
import { pointsLabel } from './core/rules/score';
import { createSandbox, launchBall, relaunch, tickSandbox } from './core/sandbox';
import { analyzeSwipe, shotVelocity, type Swipe } from './core/shot/swipeToShot';
import { attachDuo } from './input/duoTouch';
import { attachSwipe } from './input/touch';
import { renderCourtLayer } from './render/courtLayer';
import { Fx } from './render/fx';
import { Projection } from './render/projection';
import { drawScene, type SceneInput, type ScenePlayer, type ShotPreview } from './render/scene';

/**
 * Trois écrans :
 *  - « home »    : accueil (choix du niveau et du format, options) ; la simulation est en pause ;
 *  - « match »   : double avec un partenaire IA contre deux IA ;
 *  - « sandbox » : bac à sable physique, pour régler les rebonds.
 */
type Screen = 'home' | 'match' | 'sandbox';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('game');
const ctx = canvas.getContext('2d', { alpha: false })!;
const panel = $('panel');
const hint = $('hint');
const scoreEl = $('score');
const feedbackEl = $('feedback');
const vignette = $('vignette');
const home = $('home');
const overEl = $('over');

const court = COURT;
const tuning = loadTuning();
const sandbox = createSandbox();
const fx = new Fx();
const sfx = new Sfx();
let proj = new Projection(tuning.view, court);
let courtLayer: HTMLCanvasElement;
let widthCss = 0;
let heightCss = 0;
let screen: Screen = 'home';
let aiLevel = readString('rebote.level', 'facile') as AiLevel;
if (!['facile', 'moyen', 'fort'].includes(aiLevel)) aiLevel = 'facile';
let debug = readString('rebote.debug', '0') === '1';
let haptics = readString('rebote.haptics', '1') === '1';
sfx.enabled = readString('rebote.sound', '1') === '1';
/** Duo = tu diriges tes deux joueurs à deux pouces ; solo = le mode classique à un pouce. */
let controlMode: ControlMode = readString('rebote.control', 'duo') === 'solo' ? 'solo' : 'duo';
let preview: ShotPreview | null = null;
let sandboxPlayerX = court.width / 2;

let game: Match;
/** Entrées du match en cours : avec la graine, de quoi le rejouer à l'identique. */
let recording: Recording;
const pendingInputs: MatchInput[] = [];
const trail: Vec3[] = [];
const TRAIL_LENGTH = 10;
/** Ralenti « Rebote » : jusqu'à cet instant (ms), la simulation tourne à SLOW_FACTOR. */
let slowUntil = 0;
const SLOW_FACTOR = 0.22;
const SLOW_MS = 1300;

function newGame(): void {
  const seed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
  game = createMatch(seed, aiLevel, court, tuning.match.gamesToWin, controlMode);
  recording = { version: 3, seed, aiLevel, mode: controlMode, tuning: structuredClone(tuning), inputs: [], ticks: 0 };
  landing = null;
  pendingInputs.length = 0;
  trail.length = 0;
  slowUntil = 0;
  resetAnims();
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

// ——— Entrées ———

function previewFromSwipe(swipe: Swipe): ShotPreview | null {
  const intent = analyzeSwipe(swipe, tuning.shot);
  if (!intent) return null;
  let origin;
  if (screen === 'sandbox') {
    sandboxPlayerX = clamp(proj.courtXAt(swipe.points[0].x, tuning.shot.playerDepth), 0.6, court.width - 0.6);
    origin = { x: sandboxPlayerX, y: tuning.shot.playerDepth, z: tuning.shot.contactHeight };
  } else {
    const human = game.players[HUMAN_ID];
    origin = human.target ? { ...human.target.pos } : { x: human.pos.x, y: human.pos.y, z: tuning.play.idealContactZ };
  }
  return { intent, origin, vel: shotVelocity(intent, origin, tuning.shot, tuning.physics, court) };
}

function isDuoPlaying(): boolean {
  return screen === 'match' && game.mode === 'duo';
}

function pushInput(input: MatchInput): void {
  pendingInputs.push(input);
  recording.inputs.push(input);
}

// Mode Duo : un pouce par joueur, sur tout l'écran.
const duo = attachDuo(canvas, {
  enabled: isDuoPlaying,
  flickMaxMs: 300,
  stickDelayMs: 110,
  radiusPx: 56,
  onStick: (playerId, stick) => {
    if (isDuoPlaying()) pushInput({ tick: game.tick, playerId, stick });
  },
  onFlick: (playerId, swipe) => {
    if (!isDuoPlaying()) return;
    const intent = analyzeSwipe(swipe, { ...tuning.shot, lobMode: 'speed' }, true);
    if (intent) pushInput({ tick: game.tick, playerId, intent });
  },
});

// Mode classique et bac à sable : un seul swipe, depuis la moitié basse de l'écran.
attachSwipe(canvas, {
  onMove: (swipe) => {
    if (debug && !isDuoPlaying()) preview = previewFromSwipe(swipe);
  },
  onEnd: (swipe) => {
    preview = null;
    if (isDuoPlaying()) return;
    const intent = analyzeSwipe(swipe, tuning.shot);
    if (!intent) return;
    if (screen === 'sandbox') {
      const shot = previewFromSwipe(swipe)!;
      launchBall(sandbox, shot.origin, shot.vel);
      sandboxAnim.swingTick = sandbox.tick;
      trail.length = 0;
      sfx.hit(intent.power);
    } else if (screen === 'match') {
      pushInput({ tick: game.tick, playerId: HUMAN_ID, intent });
    }
  },
  onCancel: () => {
    preview = null;
  },
});

// Le son ne peut démarrer qu'après un geste de l'utilisateur (règle des navigateurs, stricte sur iOS).
document.addEventListener('pointerdown', () => sfx.unlock(), { capture: true });

// ——— Écrans et boutons ———

function show(next: Screen): void {
  screen = next;
  if (next === 'sandbox') trail.length = 0;
  acc = 0;
  last = performance.now();
  refreshUi();
}

function matchInProgress(): boolean {
  return game.phase !== 'over' && game.tick > 0;
}

function refreshUi(): void {
  const inMatch = screen === 'match';
  const inSandbox = screen === 'sandbox';
  home.classList.toggle('hidden', screen !== 'home');
  $('hud').classList.toggle('hidden', screen === 'home');
  scoreEl.classList.toggle('hidden', !inMatch);
  overEl.classList.toggle('hidden', !inMatch || game.phase !== 'over' || performance.now() < overShowAt);
  for (const id of ['btn-replay', 'btn-lob', 'btn-debug', 'btn-settings']) $(id).classList.toggle('hidden', !inSandbox);
  $('btn-sound').textContent = sfx.enabled ? '🔊' : '🔇';
  $('btn-debug').classList.toggle('active', debug);
  const lobLabel = tuning.shot.lobMode === 'speed' ? 'Lob : swipe lent' : 'Lob : swipe courbé';
  $('btn-lob').textContent = lobLabel;

  // Accueil.
  for (const b of document.querySelectorAll<HTMLButtonElement>('#seg-level button')) b.classList.toggle('active', b.dataset.value === aiLevel);
  for (const b of document.querySelectorAll<HTMLButtonElement>('#seg-format button'))
    b.classList.toggle('active', Number(b.dataset.value) === tuning.match.gamesToWin);
  for (const b of document.querySelectorAll<HTMLButtonElement>('#seg-control button')) b.classList.toggle('active', b.dataset.value === controlMode);
  $('howto').textContent =
    controlMode === 'duo'
      ? 'Un pouce par joueur : moitié gauche de l’écran pour celui de gauche, moitié droite pour l’autre. Glisse pour le déplacer, coup de pouce sec pour frapper : vers le haut = coup tendu, vers le haut en douceur = lob, vers le bas = smash sur balle haute (amortie sinon). Monte au filet à deux, recule quand on te lobe.'
      : 'Ton joueur se place tout seul. Quand l’anneau vert s’allume sous lui, swipe vers le haut : la direction vise, la vitesse dose.';
  $('opt-lob').classList.toggle('hidden', controlMode === 'duo');
  $('btn-resume').classList.toggle('hidden', !matchInProgress());
  $('btn-play').textContent = matchInProgress() ? 'Nouveau match' : 'Jouer';
  const best = readBest()[aiLevel] ?? 0;
  $('best').textContent = best > 0 ? `Meilleur style en ${aiLevel} : ${best}` : '';
  setOption('opt-sound', `Son : ${sfx.enabled ? 'oui' : 'non'}`, sfx.enabled);
  setOption('opt-haptics', `Vibrations : ${haptics ? 'oui' : 'non'}`, haptics);
  $('opt-haptics').classList.toggle('hidden', !canVibrate());
  setOption('opt-lob', lobLabel, false);
  setOption('opt-debug', `Debug : ${debug ? 'oui' : 'non'}`, debug);
  refreshHint();
}

function setOption(id: string, text: string, on: boolean): void {
  const el = $(id);
  el.textContent = text;
  el.classList.toggle('on', on);
}

/** Consigne du moment : servir, ou frapper quand l'anneau s'allume. */
let lastHint = '';
function refreshHint(): void {
  let text = '';
  if (screen === 'sandbox') text = sandbox.ball ? '' : 'Swipe vers le haut depuis le bas de l’écran';
  else if (screen === 'match') {
    const firstPoint = game.score.games[0] + game.score.games[1] === 0 && game.score.points[0] + game.score.points[1] === 0 && game.phase !== 'over';
    const second = game.serveNumber === 2 ? ' (2e balle)' : '';
    if (game.mode === 'duo') {
      if (game.phase === 'serve' && game.servingTeam === 0)
        text = `Service${second} : coup de pouce vers le haut, côté ${game.serverId === HUMAN_ID ? 'droit' : 'gauche'} de l’écran`;
      else if (firstPoint) text = 'Glisse = déplacer · coup sec ↑ = tendu · ↑ doux = lob · ↓ = smash';
    } else if (game.phase === 'serve' && game.serverId === HUMAN_ID) text = `À toi de servir${second} : swipe vers le haut`;
    else if (firstPoint) text = 'Quand l’anneau vert s’allume sous toi, swipe vers le haut';
  }
  if (text === lastHint) return;
  lastHint = text;
  hint.textContent = text;
  hint.classList.toggle('hidden', !text);
}

function toggleSound(): void {
  sfx.enabled = !sfx.enabled;
  writeString('rebote.sound', sfx.enabled ? '1' : '0');
  if (sfx.enabled) sfx.unlock();
  refreshUi();
}

function toggleLob(): void {
  tuning.shot.lobMode = tuning.shot.lobMode === 'speed' ? 'hook' : 'speed';
  saveTuning(tuning);
  refreshUi();
}

function toggleDebug(): void {
  debug = !debug;
  writeString('rebote.debug', debug ? '1' : '0');
  refreshUi();
}

function play(): void {
  newGame();
  show('match');
}

$('btn-play').addEventListener('click', play);
$('btn-resume').addEventListener('click', () => show('match'));
$('btn-again').addEventListener('click', play);
$('btn-over-menu').addEventListener('click', () => show('home'));
$('btn-menu').addEventListener('click', () => show('home'));
$('btn-sound').addEventListener('click', toggleSound);
$('opt-sound').addEventListener('click', toggleSound);
$('opt-haptics').addEventListener('click', () => {
  haptics = !haptics;
  writeString('rebote.haptics', haptics ? '1' : '0');
  vibrate(20, haptics);
  refreshUi();
});
$('opt-lob').addEventListener('click', toggleLob);
$('btn-lob').addEventListener('click', toggleLob);
$('opt-debug').addEventListener('click', toggleDebug);
$('btn-debug').addEventListener('click', toggleDebug);
$('opt-sandbox').addEventListener('click', () => show('sandbox'));
$('opt-settings').addEventListener('click', () => panel.classList.remove('hidden'));
$('btn-settings').addEventListener('click', () => panel.classList.toggle('hidden'));
$('btn-replay').addEventListener('click', () => {
  if (relaunch(sandbox)) trail.length = 0;
});
for (const b of document.querySelectorAll<HTMLButtonElement>('#seg-level button')) {
  b.addEventListener('click', () => {
    aiLevel = b.dataset.value as AiLevel;
    writeString('rebote.level', aiLevel);
    newGame();
    refreshUi();
  });
}
for (const b of document.querySelectorAll<HTMLButtonElement>('#seg-control button')) {
  b.addEventListener('click', () => {
    controlMode = b.dataset.value === 'solo' ? 'solo' : 'duo';
    writeString('rebote.control', controlMode);
    newGame();
    refreshUi();
  });
}
for (const b of document.querySelectorAll<HTMLButtonElement>('#seg-format button')) {
  b.addEventListener('click', () => {
    tuning.match.gamesToWin = Number(b.dataset.value);
    saveTuning(tuning);
    newGame();
    refreshUi();
  });
}
mountTuningPanel(panel, tuning, (path) => {
  if (path === '*' || path.startsWith('view.')) resize();
  if (path === '*' || path.startsWith('match.')) newGame();
  refreshUi();
});

// ——— Score, retours, sons ———

function updateScore(): void {
  const s = game.score;
  const mine = game.players[game.serverId].isHuman;
  const serving = game.servingTeam === 0 ? (mine ? 'tu sers' : 'ton partenaire sert') : 'ils servent';
  const games = s.gamesToWin > 1 ? `<span class="me">Nous ${s.games[0]}</span> · <span class="ai">Eux ${s.games[1]}</span> · ` : '';
  scoreEl.innerHTML = `${games}<span class="style">Style ${game.style}</span><small>${pointsLabel(s)} · ${serving}</small>`;
}

let feedbackTimer = 0;
function showFeedback(text: string, kind: 'good' | 'bad' | 'info' | 'rebote', ms = 900, sub = ''): void {
  feedbackEl.textContent = text;
  if (sub) {
    const small = document.createElement('small');
    small.textContent = sub;
    feedbackEl.append(small);
  }
  feedbackEl.className = `show ${kind}`;
  clearTimeout(feedbackTimer);
  feedbackTimer = window.setTimeout(() => (feedbackEl.className = ''), ms);
}

const TIMING_FR = { parfait: 'Parfait !', juste: 'Bien', tot: 'Trop tôt', tard: 'Trop tard' } as const;
let overShowAt = 0;

function onGameEvent(e: MatchEvent): void {
  if (e.type === 'contact') {
    landingDirty = true;
    fx.add(e.contact);
    sfx.contact(e.contact.surface, e.contact.normalSpeed);
  } else if (e.type === 'serve') {
    landingDirty = true;
    anims[e.serverId].swingTick = game.tick;
    sfx.hit(0.35);
    updateScore();
  } else if (e.type === 'hit') {
    // L'IA a commencé son geste avant (preSwing) : au contact, elle en est à CONTACT_AT.
    // Toi, tu déclenches la frappe : le geste démarre presque au contact pour claquer tout de suite.
    const mine = game.players[e.playerId].isHuman;
    anims[e.playerId].swingTick = game.tick - CONTACT_TICKS * (mine ? 0.5 : 1);
    landingDirty = true;
    sfx.hit(e.kind === 'smash' ? 1 : e.power);
    if (!mine) {
      if (e.kind === 'smash') showFeedback('Smash adverse !', 'bad', 600);
      return;
    }
    if (e.timing === 'parfait') sfx.perfect();
    if (e.power > 0.7 || e.kind === 'smash') vibrate(e.kind === 'smash' ? 30 : 18, haptics);
    const mistimed = e.timing === 'tot' || e.timing === 'tard';
    // En Duo, on nomme le coup joué : c'est comme ça qu'on apprend les trois gestes.
    const named = e.kind === 'smash' ? 'Smash !' : e.kind === 'drop' ? 'Amortie' : e.kind === 'lob' && game.mode === 'duo' ? 'Lob' : null;
    const label = named ?? (e.offGlass && !mistimed ? 'Sortie de vitre !' : TIMING_FR[e.timing]);
    showFeedback(label, mistimed ? 'bad' : e.timing === 'parfait' || e.offGlass || e.kind === 'smash' ? 'good' : 'info', 700);
  } else if (e.type === 'fault') {
    sfx.fault();
    showFeedback(e.double ? 'Double faute' : 'Faute · 2e balle', 'bad', 1200);
  } else if (e.type === 'let') {
    showFeedback('Let · on rejoue', 'info', 1000);
  } else if (e.type === 'point') {
    onPoint(e);
  }
}

function onPoint(e: Extract<MatchEvent, { type: 'point' }>): void {
  landing = null;
  const ours = e.result.winner === 0;
  const rebote = e.winnerGlass >= STYLE.slowMoGlassCount;
  if (rebote) {
    // Coup gagnant après plusieurs vitres : micro-ralenti, pour savourer la trajectoire.
    slowUntil = performance.now() + SLOW_MS;
    sfx.rebote();
  }
  if (ours) {
    sfx.pointWon();
    vibrate(rebote ? [30, 50, 30, 50, 60] : [25, 40, 25], haptics);
  } else {
    sfx.pointLost();
  }
  const what = e.game && !e.match ? (ours ? 'Jeu pour nous' : 'Jeu pour eux') : ours ? 'Point pour nous' : 'Point pour eux';
  const styleLine = e.style ? `+${e.style.total} style${e.style.glass > 0 ? ` · dont vitres +${e.style.glass}` : ''}` : '';
  if (rebote && ours) showFeedback('REBOTE !', 'rebote', 2200, styleLine);
  else showFeedback(`${what} · ${REASON_FR[e.result.reason]}`, ours ? 'good' : 'bad', e.game ? 2200 : 1600, styleLine);
  updateScore();
  if (e.match) endMatch(ours, rebote);
}

function endMatch(won: boolean, afterSlowMo: boolean): void {
  const best = readBest();
  const record = game.style > (best[aiLevel] ?? 0);
  if (record) {
    best[aiLevel] = game.style;
    writeString('rebote.best', JSON.stringify(best));
  }
  const s = game.score;
  $('over-title').textContent = won ? 'Victoire !' : 'Défaite';
  overEl.classList.toggle('win', won);
  overEl.classList.toggle('loss', !won);
  $('over-text').textContent =
    (s.gamesToWin > 1 ? `${s.games[0]} jeux à ${s.games[1]} · ` : '') + `IA ${aiLevel} · plus long échange : ${game.bestRally} coups`;
  $('over-style').textContent = `Style ${game.style}${record ? ' · nouveau record !' : ''}`;
  const delay = afterSlowMo ? SLOW_MS + 900 : 1700;
  overShowAt = performance.now() + delay;
  setTimeout(() => {
    if (won) sfx.matchWon();
    else sfx.matchLost();
    refreshUi();
  }, delay);
}

function readBest(): Partial<Record<AiLevel, number>> {
  try {
    return JSON.parse(readString('rebote.best', '{}')) as Partial<Record<AiLevel, number>>;
  } catch {
    return {};
  }
}

// ——— Boucle : simulation à pas fixe (120 Hz), rendu à la fréquence de l'écran avec interpolation ———

const contacts: ContactEvent[] = [];
const gameEvents: MatchEvent[] = [];
let acc = 0;
let last = performance.now();
let fps = 60;

function pushTrail(pos: Vec3 | undefined): void {
  if (!pos) {
    trail.length = 0;
    return;
  }
  trail.push({ x: pos.x, y: pos.y, z: pos.z });
  if (trail.length > TRAIL_LENGTH) trail.shift();
}

function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (dt > 0) fps += (1 / dt - fps) * 0.05;
  const slow = now < slowUntil;
  vignette.classList.toggle('on', slow && screen === 'match');
  // Le ralenti étire le temps réel, pas la simulation : les ticks restent identiques, le rejeu aussi.
  if (screen !== 'home') acc += dt * (slow ? SLOW_FACTOR : 1);
  while (acc >= FIXED_DT) {
    if (screen === 'sandbox') {
      contacts.length = 0;
      tickSandbox(sandbox, tuning, court, contacts);
      for (const c of contacts) {
        fx.add(c);
        sfx.contact(c.surface, c.normalSpeed);
      }
      if (sandbox.tick % 2 === 0) pushTrail(sandbox.ball?.status === 'flying' ? sandbox.ball.pos : undefined);
    } else {
      gameEvents.length = 0;
      tickMatch(game, pendingInputs, tuning, court, gameEvents);
      // Les entrées sont horodatées au tick où elles ont été reçues ; une fois ce tick passé, on les oublie.
      while (pendingInputs.length && pendingInputs[0].tick < game.tick) pendingInputs.shift();
      recording.ticks = game.tick;
      for (const e of gameEvents) onGameEvent(e);
      updateAnims();
      if (game.tick % 2 === 0) pushTrail(game.ball?.status === 'flying' ? game.ball.pos : undefined);
    }
    acc -= FIXED_DT;
  }
  fx.update(dt);
  if (sandbox.ball?.status === 'out' && sandbox.idleTicks > 120) sandbox.ball = null;
  refreshHint();

  drawScene(ctx, proj, courtLayer, fx, sceneInput(acc / FIXED_DT, slow), widthCss, heightCss);
  if (isDuoPlaying()) drawSticks();
  requestAnimationFrame(frame);
}

const NAMES = ['toi', 'ton partenaire', 'adversaire gauche', 'adversaire droit'];
const PLAYER_COLORS = ['#ff6b4a', '#ff9d7a', '#4ad0ff', '#2f9fd6'];
const SWING_SECONDS = 0.34;

/** État d'animation d'un joueur : purement visuel, déduit de la simulation, jamais l'inverse. */
interface Anim {
  lastX: number;
  lastY: number;
  moveX: number;
  moveY: number;
  speed: number;
  runPhase: number;
  swingTick: number;
}
const anims: Anim[] = [0, 1, 2, 3].map(() => ({ lastX: 0, lastY: 0, moveX: 0, moveY: 1, speed: 0, runPhase: 0, swingTick: -1e9 }));
const sandboxAnim = { swingTick: -1e9 };

/** L'IA frappe à un instant connu d'avance : son geste part juste avant, pour arriver au contact à l'heure. */
function preSwing(pl: Match['players'][number]): number | null {
  if (pl.isHuman || !pl.target || game.assigned[pl.team] !== pl.id) return null;
  const ticksLeft = pl.target.tick - game.tick;
  if (ticksLeft < 0 || ticksLeft > CONTACT_TICKS) return null;
  return CONTACT_AT * (1 - ticksLeft / CONTACT_TICKS);
}

function resetAnims(): void {
  game.players.forEach((pl, i) => Object.assign(anims[i], { lastX: pl.pos.x, lastY: pl.pos.y, speed: 0, swingTick: -1e9 }));
}

function updateAnims(): void {
  const dtPhys = FIXED_DT * tuning.physics.timeScale;
  game.players.forEach((pl, i) => {
    const an = anims[i];
    const dx = pl.pos.x - an.lastX;
    const dy = pl.pos.y - an.lastY;
    const d = Math.hypot(dx, dy);
    an.lastX = pl.pos.x;
    an.lastY = pl.pos.y;
    // Un saut de plus de 50 cm en un tick est une remise en place (service), pas une course.
    if (d < 1e-5 || d > 0.5) {
      an.speed *= 0.8;
      return;
    }
    an.moveX = dx / d;
    an.moveY = dy / d;
    an.speed = d / dtPhys;
    an.runPhase += d * 4.5;
  });
}

/** Part du geste avant le contact avec la balle (voir les poses dans render/player.ts). */
const CONTACT_AT = 0.35;
const CONTACT_TICKS = (CONTACT_AT * SWING_SECONDS) / FIXED_DT;

function swingProgress(startTick: number, tick: number, alpha: number): number | null {
  const s = ((tick + alpha - startTick) * FIXED_DT) / SWING_SECONDS;
  return s >= 0 && s <= 1 ? s : null;
}

/** Sticks flottants : un anneau là où le pouce s'est posé, un point là où il est. */
function drawSticks(): void {
  for (const t of duo.touches()) {
    if (!t.stickActive) continue;
    const r = 56;
    let dx = t.x - t.x0;
    let dy = t.y - t.y0;
    const n = Math.hypot(dx, dy);
    if (n > r) {
      dx = (dx / n) * r;
      dy = (dy / n) * r;
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.beginPath();
    ctx.arc(t.x0, t.y0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    ctx.arc(t.x0 + dx, t.y0 + dy, 20, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Point de chute de la balle dans ton camp : en Duo, c'est le repère pour te placer. */
let landing: Vec3 | null = null;
let landingDirty = false;
function updateLanding(): void {
  landingDirty = false;
  landing = null;
  const ball = game.ball;
  if (game.mode !== 'duo' || game.phase !== 'rally' || !ball || game.rally.lastHitter !== 1 || game.rally.receiverBounces > 0) return;
  const pred = predict(ball, tuning.physics, court, FIXED_DT * tuning.physics.timeScale, 3, 8);
  const first = pred.contacts[0];
  if (first && first.surface === 'ground' && first.pos.y < court.netY) landing = first.pos;
}

function sceneInput(alpha: number, slow: boolean): SceneInput {
  if (landingDirty && screen === 'match') updateLanding();
  const common = { alpha, tuning, court, debug, preview, fps, trail, landing: screen === 'match' ? landing : null };
  if (screen === 'sandbox') {
    return {
      ...common,
      glow: false,
      ball: sandbox.ball,
      prevPos: sandbox.prevPos,
      lastContact: sandbox.lastContact,
      tick: sandbox.tick,
      players: [
        {
          x: sandboxPlayerX,
          y: tuning.shot.playerDepth - 0.35,
          facing: 1,
          shirt: PLAYER_COLORS[0],
          moveX: 0,
          moveY: 1,
          speed: 0,
          runPhase: 0,
          swing: swingProgress(sandboxAnim.swingTick, sandbox.tick, alpha),
          prep: 0,
          idlePhase: sandbox.tick * 0.03,
          scale: tuning.view.playerScale,
          marker: false,
          hittable: false,
          target: null,
        },
      ],
      debugLines: [],
    };
  }
  const players: ScenePlayer[] = game.players.map((pl) => {
    const an = anims[pl.id];
    // Armé : le bras part en arrière dans la dernière demi-seconde avant la frappe, ou avant de servir.
    let prep = 0;
    if (pl.target) prep = clamp(1 - ((pl.target.tick - game.tick) * FIXED_DT - 0.1) / 0.5, 0, 1);
    else if (game.phase === 'serve' && game.serverId === pl.id) prep = pl.isHuman ? 0.7 : clamp(game.phaseTicks / 110, 0, 1);
    return {
      x: pl.pos.x,
      y: pl.pos.y,
      facing: pl.team === 0 ? 1 : -1,
      shirt: PLAYER_COLORS[pl.id],
      moveX: an.moveX,
      moveY: an.moveY,
      speed: an.speed,
      runPhase: an.runPhase,
      swing: swingProgress(an.swingTick, game.tick, alpha) ?? preSwing(pl),
      prep,
      idlePhase: game.tick * 0.03 + pl.id * 1.7,
      scale: tuning.view.playerScale,
      marker: pl.isHuman && game.mode === 'solo',
      hittable: pl.isHuman && isHittable(game, pl, tuning, court),
      target: pl.target?.pos ?? null,
    };
  });
  const human = game.players[HUMAN_ID];
  const assigned = game.assigned.map((id) => (id === null ? '—' : NAMES[id])).join(' / ');
  return {
    ...common,
    glow: slow,
    ball: game.ball,
    prevPos: game.prevPos,
    lastContact: game.lastContact,
    tick: game.tick,
    players,
    debugLines: [
      `phase ${game.phase} · IA ${game.aiLevel} · graine ${game.seed}`,
      `balle pour : ${assigned} · ${game.shots} coups · vitres ${game.glassSinceHit}`,
      human.target ? `frappe prévue dans ${((human.target.tick - game.tick) * FIXED_DT).toFixed(2)} s (${human.target.kind})` : 'pas de frappe prévue',
    ],
  };
}

document.addEventListener('visibilitychange', () => {
  last = performance.now();
  acc = 0;
});
window.addEventListener('resize', resize);

// ——— PWA : hors ligne et installation ———

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Pas de service worker (navigation privée, http…) : le jeu marche quand même en ligne.
    });
  });
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}
let installPrompt: InstallPromptEvent | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e as InstallPromptEvent;
  $('btn-install').classList.remove('hidden');
});
$('btn-install').addEventListener('click', () => {
  void installPrompt?.prompt();
  installPrompt = null;
  $('btn-install').classList.add('hidden');
});
const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone) $('install-hint').classList.remove('hidden');

newGame();
resize();
refreshUi();
requestAnimationFrame(frame);

// Pour le debug depuis la console du navigateur : copy(JSON.stringify(rebote.recording())),
// ou rebote.slowMo() pour voir l'effet « Rebote » sans attendre un coup à deux vitres.
(window as unknown as { rebote: object }).rebote = {
  recording: () => recording,
  game: () => game,
  screen: () => screen,
  slowMo: () => {
    slowUntil = performance.now() + SLOW_MS;
    sfx.rebote();
    showFeedback('REBOTE !', 'rebote', 2200, '+550 style · dont vitres +300');
  },
};

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
