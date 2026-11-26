import '@fontsource/press-start-2p/latin-400.css';
import './style.css';
import { mountTuningPanel, loadTuning, saveTuning } from './app/tuningPanel';
import { canVibrate, Sfx, vibrate } from './audio/sfx';
import { COURT, FIXED_DT, STYLE, type AiLevel } from './core/constants';
import { clamp, type Vec3 } from './core/math/vec3';
import { predict } from './core/physics/predict';
import type { ContactEvent } from './core/physics/step';
import { createMatch, HUMAN_ID, humanServeShot, isHittable, tickMatch, type ControlMode, type Match, type MatchEvent, type MatchInput } from './core/play/match';
import type { Recording } from './core/play/replay';
import { REASON_FR } from './core/rules/rally';
import { isDeuce, pointLabels } from './core/rules/score';
import { createSandbox, launchBall, relaunch, tickSandbox } from './core/sandbox';
import { analyzeFlick, analyzeSwipe, serveIntentFromDrag, shotVelocity, type ShotIntent, type Swipe } from './core/shot/swipeToShot';
import { attachDuo } from './input/duoTouch';
import { attachSwipe } from './input/touch';
import { P86View, type Banner, type Bottom, type Hud, type Ink, type Scene, type ScenePlayer, type SpriteName, type SpritePose } from './render/p86';

/**
 * PÁDEL 86 — quatre écrans :
 *  - « title »   : affiche avec PRESS START (le premier toucher lance aussi le son, règle iOS) ;
 *  - « home »    : menu (mode, adversaires, format, options) ; la simulation est en pause ;
 *  - « match »   : double, en Duo (tu diriges tes deux joueurs) ou en Classique ;
 *  - « sandbox » : bac à sable physique, pour régler les rebonds.
 */
type Screen = 'title' | 'home' | 'match' | 'sandbox';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('game');
const panel = $('panel');
const home = $('home');
const overEl = $('over');
const titleEl = $('title');
const titleImg = $<HTMLImageElement>('title-img');
const debugEl = $('debug');

/** Les trois paires adverses du kit, une par niveau. */
const PAIRS: Record<AiLevel, { team: string; names: string; sprites: [SpriteName, SpriteName] }> = {
  facile: { team: 'LOS GUIRIS', names: 'GUNTHER & BRIGITTE', sprites: ['gunther', 'brigitte'] },
  moyen: { team: 'LOS PRIMOS', names: 'PACO & PEPA', sprites: ['paco', 'pepa'] },
  fort: { team: 'LOS REYES', names: 'EL TORO & LA REINA', sprites: ['toro', 'reina'] },
};
const SPRITE_INDEX: SpriteName[] = ['lola', 'nico', 'gunther', 'brigitte', 'paco', 'pepa', 'toro', 'reina'];

const court = COURT;
const tuning = loadTuning();
// Le match se joue toujours en 1 jeu (un ancien réglage enregistré pouvait dire autre chose).
tuning.match.gamesToWin = 1;
const sandbox = createSandbox();
const view = new P86View(canvas, court);
const sfx = new Sfx();
let screen: Screen = 'title';
let aiLevel = readString('rebote.level', 'facile') as AiLevel;
if (!['facile', 'moyen', 'fort'].includes(aiLevel)) aiLevel = 'facile';
let debug = readString('rebote.debug', '0') === '1';
let haptics = readString('rebote.haptics', '1') === '1';
sfx.enabled = readString('rebote.sound', '1') === '1';
/** Duo = tu diriges tes deux joueurs à deux pouces ; solo = le mode classique à un pouce. */
let controlMode: ControlMode = readString('rebote.control', 'duo') === 'solo' ? 'solo' : 'duo';
let preview: { origin: Vec3; vel: Vec3 } | null = null;
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
/** Smash : arrêt sur image de 60 ms puis secousse de 2 px pendant 120 ms. */
let freezeUntil = 0;
let shakeUntil = 0;

function newGame(): void {
  const seed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
  game = createMatch(seed, aiLevel, court, tuning.match.gamesToWin, controlMode);
  recording = { version: 3, seed, aiLevel, mode: controlMode, tuning: structuredClone(tuning), inputs: [], ticks: 0 };
  landing = null;
  banner = null;
  pendingInputs.length = 0;
  trail.length = 0;
  slowUntil = 0;
  resetAnims();
}

function resize(): void {
  // On laisse libre la rangée des boutons (et l'encoche) en haut, la barre d'accueil en bas.
  const safe = getComputedStyle($('safe-probe'));
  const safeTop = parseFloat(safe.paddingTop) || 0;
  const safeBottom = parseFloat(safe.paddingBottom) || 0;
  view.resize(safeTop + 40, safeBottom);
}

// ——— Entrées ———

function previewFromSwipe(swipe: Swipe): { intent: ShotIntent; origin: Vec3; vel: Vec3 } | null {
  const intent = analyzeSwipe(swipe, tuning.shot);
  if (!intent) return null;
  let origin;
  if (screen === 'sandbox') {
    sandboxPlayerX = clamp(view.courtXAt(swipe.points[0].x, tuning.shot.playerDepth), 0.6, court.width - 0.6);
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

/**
 * Duo : chaque moitié de l'écran dirige le joueur qui tient ce côté du terrain. Les côtés sont
 * fixes pendant tout le match (Lola à gauche, Nico à droite). `side` : 1 = gauche, 0 = droite.
 */
function humanOnSide(side: number): number {
  const wantLeft = side === 1;
  const p = game.players.find((pl) => pl.isHuman && pl.zone.xMin < court.width / 2 === wantLeft);
  return p ? p.id : side;
}

/** Nom du joueur de ta paire qui tient le côté gauche (true) ou droit (false). */
function nameOnSide(left: boolean): string {
  const p = game.players.find((pl) => pl.team === 0 && pl.zone.xMin < court.width / 2 === left);
  return p ? NAMES[p.id] : '';
}

/** Est-ce à un joueur humain de servir, là, maintenant ? */
function humanServing(): boolean {
  return screen === 'match' && game.phase === 'serve' && game.players[game.serverId].isHuman;
}

/** Geste de service en cours (doigt posé) : le trait pointillé le suit en direct. */
let serveDrag: ShotIntent | null = null;
/** Sans doigt posé, on montre le service « tout droit », en plus discret. */
const DEFAULT_SERVE: ShotIntent = { kind: 'drive', power: 0.5, aim: 0, swipeSpeed: 0, curvature: 0 };

function releaseServe(swipe: Swipe): void {
  serveDrag = null;
  const intent = serveIntentFromDrag(swipe, tuning.shot);
  if (intent) pushInput({ tick: game.tick, playerId: game.serverId, intent });
  else showBanner('TIRE VERS LE HAUT', 'W', 900);
}

const STICK_RADIUS = 36;

// Mode Duo : un pouce par joueur, sur tout l'écran.
const duo = attachDuo(canvas, {
  enabled: isDuoPlaying,
  flickMaxMs: 400,
  stickDelayMs: 50,
  radiusPx: STICK_RADIUS,
  onMove: (_playerId, swipe) => {
    if (isDuoPlaying() && humanServing()) serveDrag = serveIntentFromDrag(swipe, tuning.shot);
  },
  onStick: (side, stick) => {
    if (isDuoPlaying()) pushInput({ tick: game.tick, playerId: humanOnSide(side), stick });
  },
  onRelease: (side, swipe, quick) => {
    const playerId = humanOnSide(side);
    if (!isDuoPlaying()) return;
    // Au service : un trait vers le haut, n'importe où sur l'écran, sans limite de durée.
    if (humanServing()) {
      releaseServe(swipe);
      return;
    }
    if (!quick) return;
    const intent = analyzeFlick(swipe, tuning.shot);
    if (intent) pushInput({ tick: game.tick, playerId, intent });
  },
});

// Mode classique et bac à sable : un seul swipe, depuis la moitié basse de l'écran.
attachSwipe(canvas, {
  onMove: (swipe) => {
    if (isDuoPlaying()) return;
    if (humanServing()) serveDrag = serveIntentFromDrag(swipe, tuning.shot);
    else if (debug) preview = previewFromSwipe(swipe);
  },
  onEnd: (swipe) => {
    preview = null;
    if (isDuoPlaying()) return;
    if (humanServing()) {
      releaseServe(swipe);
      return;
    }
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
    serveDrag = null;
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
  // Thème : plein volume au menu, −6 dB en jeu, coupé une fois le match terminé.
  if (next === 'home') sfx.theme('menu');
  else if (next === 'sandbox' || (next === 'match' && game.phase !== 'over')) sfx.theme('match');
  refreshUi();
}

function matchInProgress(): boolean {
  return game.phase !== 'over' && game.tick > 0;
}

function refreshUi(): void {
  const inMatch = screen === 'match';
  const inSandbox = screen === 'sandbox';
  titleEl.classList.toggle('hidden', screen !== 'title');
  home.classList.toggle('hidden', screen !== 'home');
  $('hud').classList.toggle('hidden', screen === 'home' || screen === 'title');
  debugEl.classList.toggle('hidden', !debug || screen === 'home' || screen === 'title');
  overEl.classList.toggle('hidden', !inMatch || game.phase !== 'over' || performance.now() < overShowAt);
  for (const id of ['btn-replay', 'btn-lob', 'btn-debug', 'btn-settings']) $(id).classList.toggle('hidden', !inSandbox);
  $('btn-sound').textContent = sfx.enabled ? 'SON' : 'MUET';
  $('btn-debug').classList.toggle('active', debug);
  const lobLabel = tuning.shot.lobMode === 'speed' ? 'LOB: LENT' : 'LOB: COURBE';
  $('btn-lob').textContent = lobLabel;

  // Menu.
  const beaten = readBeaten();
  for (const b of document.querySelectorAll<HTMLButtonElement>('#seg-level button')) {
    const level = b.dataset.value as AiLevel;
    b.classList.toggle('active', level === aiLevel);
    // Une étoile après le nom des paires déjà battues.
    b.textContent = PAIRS[level].team + (beaten.includes(level) ? '  *' : '');
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('#seg-control button')) b.classList.toggle('active', b.dataset.value === controlMode);
  const pair = PAIRS[aiLevel];
  $('pair-names').textContent = pair.names;
  pair.sprites.forEach((name, i) => $(`pair-${i}`).style.setProperty('--row', String(SPRITE_INDEX.indexOf(name))));
  $('howto').textContent =
    controlMode === 'duo'
      ? 'UN POUCE PAR JOUEUR. GLISSE POUR LE DEPLACER, COUP DE POUCE POUR FRAPPER. VERS LE HAUT : COURT = TENDU, LONG = LOB. VERS LE BAS : COURT = AMORTIE, LONG = SMASH. UN SMASH PARFAIT PRES DU FILET PEUT SORTIR LA BALLE : PAR 3 OU PAR 4 !'
      : 'TON JOUEUR SE PLACE SEUL. QUAND L’ANNEAU VERT S’ALLUME, SWIPE VERS LE HAUT : LA DIRECTION VISE, LA VITESSE DOSE.';
  $('opt-lob').classList.toggle('hidden', controlMode === 'duo');
  $('btn-resume').classList.toggle('hidden', !matchInProgress());
  $('btn-play').textContent = matchInProgress() ? 'NOUVEAU MATCH' : 'JOUER !';
  const best = readBest()[aiLevel] ?? 0;
  $('best').textContent = best > 0 ? `RECORD STYLE : ${best}` : '';
  setOption('opt-sound', `SON : ${sfx.enabled ? 'OUI' : 'NON'}`, sfx.enabled);
  setOption('opt-haptics', `VIBRATIONS : ${haptics ? 'OUI' : 'NON'}`, haptics);
  $('opt-haptics').classList.toggle('hidden', !canVibrate());
  setOption('opt-lob', lobLabel, false);
  setOption('opt-debug', `DEBUG : ${debug ? 'OUI' : 'NON'}`, debug);
}

function setOption(id: string, text: string, on: boolean): void {
  const el = $(id);
  el.textContent = text;
  el.classList.toggle('on', on);
}

/** Consigne du moment : servir, ou frapper quand l'anneau s'allume. */
function currentHint(): string {
  if (screen === 'sandbox') return sandbox.ball ? '' : 'SWIPE VERS LE HAUT DEPUIS LE BAS DE L’ÉCRAN';
  if (screen !== 'match') return '';
  const firstPoint = game.score.games[0] + game.score.games[1] === 0 && game.score.points[0] + game.score.points[1] === 0 && game.phase !== 'over';
  const second = game.serveNumber === 2 ? ' (2E BALLE)' : '';
  if (humanServing()) return `SERVICE${second} : TIRE UN TRAIT VERS LE HAUT, AJUSTE, RELACHE`;
  if (!firstPoint) return '';
  return game.mode === 'duo' ? 'HAUT: COURT=TENDU LONG=LOB|BAS: COURT=AMORTI LONG=SMASH' : 'ANNEAU VERT SOUS TON JOUEUR : SWIPE VERS LE HAUT !';
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
  sfx.coin();
  newGame();
  show('match');
}

// PRESS START : le premier toucher lance le son et la musique, puis ouvre le menu.
titleEl.addEventListener('click', () => {
  sfx.unlock();
  sfx.coin();
  show('home');
});
let blink = false;
setInterval(() => {
  if (screen !== 'title') return;
  blink = !blink;
  titleImg.src = blink ? './padel86/padel86-titre-noblink-1x.png' : './padel86/padel86-affiche-1x.png';
}, 500);

$('btn-play').addEventListener('click', play);
$('btn-resume').addEventListener('click', () => show('match'));
$('btn-again').addEventListener('click', play);
$('btn-next').addEventListener('click', () => {
  if (nextLevel) chooseLevel(nextLevel);
  play();
});
// Retour au menu après une victoire : la paire suivante est déjà sélectionnée.
$('btn-over-menu').addEventListener('click', () => {
  if (game.phase === 'over' && game.score.winner === 0 && nextLevel) {
    chooseLevel(nextLevel);
    newGame();
  }
  show('home');
});
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
    chooseLevel(b.dataset.value as AiLevel);
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
mountTuningPanel(panel, tuning, (path) => {
  if (path === '*') {
    tuning.match.gamesToWin = 1;
    newGame();
  }
  refreshUi();
});

// ——— Retours à l'écran, sons ———

/** Texte central (frappe, point, faute), dessiné dans le canvas en police pixel. */
let banner: (Banner & { until: number }) | null = null;
function showBanner(text: string, ink: Ink, ms = 900, sub = ''): void {
  banner = { text: text.toUpperCase(), sub: sub.toUpperCase(), ink, until: performance.now() + ms };
}

const TIMING_FR = { parfait: 'PARFAIT !', juste: 'BIEN', tot: 'TROP TOT', tard: 'TROP TARD' } as const;
let overShowAt = 0;

function onContact(c: ContactEvent): void {
  view.addContact(c);
  sfx.contact(c.surface, c.normalSpeed);
}

function onGameEvent(e: MatchEvent): void {
  if (e.type === 'contact') {
    landingDirty = true;
    onContact(e.contact);
  } else if (e.type === 'serve') {
    landingDirty = true;
    anims[e.serverId].swingTick = game.tick;
    anims[e.serverId].swingPose = 'low';
    sfx.hit(0.35);
  } else if (e.type === 'hit') {
    const mine = game.players[e.playerId].isHuman;
    const smash = e.kind === 'smash';
    anims[e.playerId].swingTick = game.tick;
    anims[e.playerId].swingPose = smash || (game.ball?.pos.z ?? 0) >= 1.3 ? 'swing' : 'low';
    landingDirty = true;
    if (smash) {
      sfx.smash();
      const now = performance.now();
      freezeUntil = now + 60;
      shakeUntil = now + 180;
    } else {
      sfx.hit(e.power);
    }
    if (!mine) {
      if (smash) showBanner('SMASH ADVERSE !', 'R', 600);
      return;
    }
    if (e.timing === 'parfait') sfx.perfect();
    if (e.power > 0.7 || smash) vibrate(smash ? 30 : 18, haptics);
    const mistimed = e.timing === 'tot' || e.timing === 'tard';
    // En Duo, on nomme le coup joué : c'est comme ça qu'on apprend les trois gestes.
    const named = smash ? 'SMASH !' : e.kind === 'drop' ? 'AMORTIE' : e.kind === 'lob' && game.mode === 'duo' ? 'LOB' : null;
    const label = named ?? (e.offGlass && !mistimed ? 'SORTIE DE VITRE !' : TIMING_FR[e.timing]);
    showBanner(label, mistimed ? 'R' : e.timing === 'parfait' || e.offGlass || smash ? 'G' : 'W', 700);
  } else if (e.type === 'fault') {
    sfx.fault();
    showBanner(e.double ? 'DOUBLE FAUTE' : 'FAUTE', 'R', 1200, e.double ? '' : '2E BALLE');
  } else if (e.type === 'let') {
    showBanner('LET', 'W', 1000, 'ON REJOUE');
  } else if (e.type === 'point') {
    onPoint(e);
  }
}

function onPoint(e: Extract<MatchEvent, { type: 'point' }>): void {
  landing = null;
  const ours = e.result.winner === 0;
  // Ralenti pour les coups d'exception : plusieurs vitres, ou balle sortie du court (par 3 / par 4).
  const rebote = e.winnerGlass >= STYLE.slowMoGlassCount || e.par !== null;
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
  const what = e.game && !e.match ? (ours ? 'JEU POUR NOUS' : 'JEU POUR EUX') : ours ? 'POINT POUR NOUS' : 'POINT POUR EUX';
  // Après 40-40, on annonce l'égalité ou l'avantage : c'est ce qui compte à ce moment-là.
  const sc = game.score;
  const call = e.game ? '' : isDeuce(sc) ? 'EGALITE' : sc.points[0] >= 3 && sc.points[1] >= 3 ? (sc.points[0] > sc.points[1] ? 'AVANTAGE NOUS' : 'AVANTAGE EUX') : '';
  const reason = call || REASON_FR[e.result.reason];
  const gain = e.style ? ` +${e.style.total}` : '';
  if (e.par) showBanner(`PAR ${e.par} !`, ours ? 'Y' : 'R', 2400, ours ? `STYLE${gain}` : 'CHEZ EUX...');
  else if (rebote && ours) showBanner('REBOTE !', 'Y', 2200, `STYLE${gain}`);
  else showBanner(what, ours ? 'G' : 'R', e.game ? 2200 : 1600, reason + gain);
  if (e.match) endMatch(ours, rebote);
}

function endMatch(won: boolean, afterSlowMo: boolean): void {
  const best = readBest();
  const record = game.style > (best[aiLevel] ?? 0);
  if (record) {
    best[aiLevel] = game.style;
    writeString('rebote.best', JSON.stringify(best));
  }
  // Progression : une paire battue ouvre la suivante.
  const beatenLevel = aiLevel;
  const next = won ? LEVEL_ORDER[LEVEL_ORDER.indexOf(beatenLevel) + 1] : undefined;
  if (won) {
    const beaten = readBeaten();
    if (!beaten.includes(beatenLevel)) writeString('rebote.beaten', JSON.stringify([...beaten, beatenLevel]));
  }
  const champion = won && !next;
  $('over-title').textContent = champion ? 'CHAMPIONS !' : won ? 'VICTOIRE !' : 'DEFAITE';
  overEl.classList.toggle('win', won);
  overEl.classList.toggle('loss', !won);
  $('over-text').textContent = champion
    ? `${PAIRS[beatenLevel].team} SONT BATTUS. IL NE RESTE PLUS PERSONNE !`
    : won
      ? `${PAIRS[beatenLevel].team} SONT BATTUS. ${PAIRS[next!].team} T'ATTENDENT...`
      : `${PAIRS[beatenLevel].team} GAGNENT. PLUS LONG ECHANGE : ${game.bestRally} COUPS`;
  const btnNext = $('btn-next');
  btnNext.classList.toggle('hidden', !next);
  $('btn-again').classList.toggle('primary', !next);
  nextLevel = next ?? null;
  if (next) btnNext.textContent = `AFFRONTER ${PAIRS[next].team}`;
  $('over-style').textContent = `STYLE ${game.style}${record ? ' · RECORD !' : ''}`;
  const delay = afterSlowMo ? SLOW_MS + 900 : 1700;
  overShowAt = performance.now() + delay;
  setTimeout(() => {
    // Fin de match : on coupe le thème, puis le jingle.
    sfx.stopTheme();
    if (won) sfx.matchWon();
    else sfx.matchLost();
    refreshUi();
  }, delay);
}

const LEVEL_ORDER: AiLevel[] = ['facile', 'moyen', 'fort'];
/** Paire proposée après une victoire. */
let nextLevel: AiLevel | null = null;

function readBeaten(): AiLevel[] {
  try {
    const list = JSON.parse(readString('rebote.beaten', '[]')) as unknown;
    return Array.isArray(list) ? (list.filter((l) => LEVEL_ORDER.includes(l as AiLevel)) as AiLevel[]) : [];
  } catch {
    return [];
  }
}

function chooseLevel(level: AiLevel): void {
  aiLevel = level;
  writeString('rebote.level', aiLevel);
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
  // Le ralenti et l'arrêt sur image étirent le temps réel, pas la simulation : les ticks restent
  // identiques, le rejeu aussi.
  const playing = screen === 'match' || screen === 'sandbox';
  if (playing && now >= freezeUntil) acc += dt * (slow ? SLOW_FACTOR : 1);
  while (acc >= FIXED_DT) {
    if (screen === 'sandbox') {
      contacts.length = 0;
      tickSandbox(sandbox, tuning, court, contacts);
      for (const c of contacts) onContact(c);
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
  view.update(dt);
  if (sandbox.ball?.status === 'out' && sandbox.idleTicks > 120) sandbox.ball = null;
  if (banner && now > banner.until) banner = null;

  if (screen !== 'title') view.draw(scene(acc / FIXED_DT, slow, now));
  if (debug && playing) debugEl.textContent = debugText();
  requestAnimationFrame(frame);
}

const NAMES = ['NICO', 'LOLA', 'ADV. GAUCHE', 'ADV. DROIT'];
/** Durée d'affichage de la pose de frappe (s). */
const SWING_SECONDS = 0.3;
/** L'IA frappe à un instant connu d'avance : sa pose de frappe apparaît juste avant le contact. */
const PRE_SWING_TICKS = 0.1 / FIXED_DT;

/** État d'animation d'un joueur : purement visuel, déduit de la simulation, jamais l'inverse. */
interface Anim {
  lastX: number;
  lastY: number;
  speed: number;
  swingTick: number;
  swingPose: SpritePose;
}
const anims: Anim[] = [0, 1, 2, 3].map(() => ({ lastX: 0, lastY: 0, speed: 0, swingTick: -1e9, swingPose: 'low' }));
const sandboxAnim = { swingTick: -1e9 };

function resetAnims(): void {
  game.players.forEach((pl, i) => Object.assign(anims[i], { lastX: pl.pos.x, lastY: pl.pos.y, speed: 0, swingTick: -1e9 }));
}

function updateAnims(): void {
  const dtPhys = FIXED_DT * tuning.physics.timeScale;
  game.players.forEach((pl, i) => {
    const an = anims[i];
    const d = Math.hypot(pl.pos.x - an.lastX, pl.pos.y - an.lastY);
    an.lastX = pl.pos.x;
    an.lastY = pl.pos.y;
    // Un saut de plus de 50 cm en un tick est une remise en place (service), pas une course.
    if (d < 1e-5 || d > 0.5) an.speed *= 0.8;
    else an.speed = d / dtPhys;
  });
}

function swinging(startTick: number, tick: number): boolean {
  const s = (tick - startTick) * FIXED_DT;
  return s >= 0 && s <= SWING_SECONDS;
}

/** Pose du sprite : frappe (haute ou basse), course à 8 images/s, ou repos (de dos pour ta paire). */
function poseOf(pl: Match['players'][number]): SpritePose {
  const an = anims[pl.id];
  if (swinging(an.swingTick, game.tick)) return an.swingPose;
  if (!pl.isHuman && pl.target && game.assigned[pl.team] === pl.id) {
    const left = pl.target.tick - game.tick;
    if (left >= 0 && left <= PRE_SWING_TICKS) return pl.target.pos.z >= 1.3 ? 'swing' : 'low';
  }
  if (an.speed > 0.6) return Math.floor(game.tick / 15) % 2 ? 'run1' : 'run2';
  return pl.team === 0 ? 'back' : 'idle';
}

function spriteOf(pl: Match['players'][number]): SpriteName {
  // Ta paire : Lola à gauche (joueur 1), Nico à droite (joueur 0). En face : la paire du niveau.
  if (pl.team === 0) return pl.id === HUMAN_ID ? 'nico' : 'lola';
  return PAIRS[game.aiLevel].sprites[pl.id === 2 ? 0 : 1];
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

function hud(): Hud {
  const s = game.score;
  return {
    us: 'LOLA/NICO',
    them: PAIRS[game.aiLevel].team,
    games: s.gamesToWin > 1 ? [s.games[0], s.games[1]] : null,
    points: pointLabels(s),
    serving: game.servingTeam,
    seconds: game.tick * FIXED_DT,
    badge: game.mode === 'duo' ? 'DUO' : 'CLAS',
  };
}

function scene(alpha: number, slow: boolean, now: number): Scene {
  const inMatch = screen === 'match' || screen === 'home';
  if (landingDirty && screen === 'match') updateLanding();
  const hint = currentHint();
  const common = {
    alpha,
    tuning,
    court,
    debug,
    preview,
    trail,
    banner,
    stickRadius: STICK_RADIUS,
    shake: now < shakeUntil && now >= freezeUntil ? 2 : 0,
  };
  if (!inMatch) {
    return {
      ...common,
      glow: false,
      ball: sandbox.ball,
      prevPos: sandbox.prevPos,
      tick: sandbox.tick,
      players: [
        {
          x: sandboxPlayerX,
          y: tuning.shot.playerDepth - 0.35,
          sprite: 'nico',
          pose: swinging(sandboxAnim.swingTick, sandbox.tick) ? 'low' : 'back',
          marker: false,
          hittable: false,
          target: null,
        },
      ],
      landing: null,
      serveAim: null,
      hud: null,
      bottom: hint ? { kind: 'hint', text: hint } : null,
      sticks: [],
    };
  }
  const players: ScenePlayer[] = game.players.map((pl) => ({
    x: pl.pos.x,
    y: pl.pos.y,
    sprite: spriteOf(pl),
    pose: poseOf(pl),
    marker: pl.isHuman && game.mode === 'solo',
    hittable: pl.isHuman && screen === 'match' && isHittable(game, pl, tuning, court),
    target: pl.target?.pos ?? null,
  }));
  const bottom: Bottom = hint
    ? { kind: 'hint', text: hint }
    : {
        kind: 'thumbs',
        left: nameOnSide(true),
        right: nameOnSide(false),
        leftIsAi: !game.players.some((pl) => pl.isHuman && pl.zone.xMin < court.width / 2),
        rightIsAi: !game.players.some((pl) => pl.isHuman && pl.zone.xMin >= court.width / 2),
        style: game.style,
      };
  return {
    ...common,
    glow: slow,
    ball: game.ball,
    prevPos: game.prevPos,
    tick: game.tick,
    players,
    landing: screen === 'match' ? landing : null,
    serveAim: humanServing() ? { ...humanServeShot(game, serveDrag ?? DEFAULT_SERVE, tuning, court), active: serveDrag !== null } : null,
    hud: hud(),
    bottom,
    sticks: isDuoPlaying() ? duo.touches().filter((t) => t.stickActive) : [],
  };
}

function debugText(): string {
  if (screen === 'sandbox') {
    const b = sandbox.ball;
    return `${fps.toFixed(0)} fps · tick ${sandbox.tick}` + (b ? `\nv ${(Math.hypot(b.vel.x, b.vel.y, b.vel.z) * 3.6).toFixed(0)} km/h · z ${b.pos.z.toFixed(2)} m · ${b.status}` : '');
  }
  const human = game.players[HUMAN_ID];
  const assigned = game.assigned.map((id) => (id === null ? '—' : NAMES[id])).join(' / ');
  const b = game.ball;
  return [
    `${fps.toFixed(0)} fps · tick ${game.tick} · ${game.phase} · ${game.aiLevel} · graine ${game.seed}`,
    `balle pour : ${assigned} · ${game.shots} coups · vitres ${game.glassSinceHit}`,
    b ? `v ${(Math.hypot(b.vel.x, b.vel.y, b.vel.z) * 3.6).toFixed(0)} km/h · z ${b.pos.z.toFixed(2)} m` : 'pas de balle',
    human.target ? `frappe prévue dans ${((human.target.tick - game.tick) * FIXED_DT).toFixed(2)} s (${human.target.kind})` : 'pas de frappe prévue',
  ].join('\n');
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
    showBanner('REBOTE !', 'Y', 2200, '+550 STYLE');
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
