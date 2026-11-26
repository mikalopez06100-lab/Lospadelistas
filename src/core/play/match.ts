import { AIDS, AI_LEVELS, FIXED_DT, PARTNER_LEVEL, type AiLevel, type AiParams, type CourtGeometry, type Tuning } from '../constants';
import { clamp, copyV3, DEG, lerp, v3, type Vec2, type Vec3 } from '../math/vec3';
import { createBall, stepBall, type BallState, type ContactEvent } from '../physics/step';
import {
  canHit,
  createRally,
  onBallStatus,
  onContact,
  onHit,
  sideOf,
  startServe,
  type Box,
  type PointResult,
  type RallyState,
} from '../rules/rally';
import { styleForPoint, type StyleGain } from '../rules/style';
import { awardPoint, createScore, pointsPlayedInGame, type MatchScore, type Team } from '../rules/score';
import { createRng, gaussian, nextFloat, range, type Rng } from '../rng';
import { aimAt } from '../shot/aim';
import { shotVelocity, type ShotIntent, type ShotKind } from '../shot/swipeToShot';
import { chooseWindow, findWindows, type ContactWindow, type WindowChoice } from './positioning';

/**
 * Phase 2 — match en double. Simulation pure et déterministe : même graine + mêmes entrées
 * horodatées (en ticks) = même match. C'est la base des « fantômes ».
 *
 * Joueurs (vus depuis le camp de chacun, « droite » = côté du coup droit) :
 *   0 = toi        équipe 0, moitié droite  (x de 5 à 10)
 *   1 = partenaire équipe 0, moitié gauche  (x de 0 à 5)
 *   2 = adversaire équipe 1, moitié droite  (x de 0 à 5, il regarde vers le bas)
 *   3 = adversaire équipe 1, moitié gauche  (x de 5 à 10)
 */

export const HUMAN_ID = 0;

/**
 * 'solo' : tu joues le joueur 0 au swipe, placement automatique, partenaire IA.
 * 'duo'  : tu diriges les joueurs 0 et 1, un pouce chacun (déplacement au stick, frappe au geste).
 */
export type ControlMode = 'solo' | 'duo';

export interface Zone {
  xMin: number;
  xMax: number;
}

export interface MatchPlayer {
  id: number;
  team: Team;
  isHuman: boolean;
  /** Paramètres d'IA (pour le joueur humain : ceux du partenaire, non utilisés pour frapper). */
  ai: AiParams;
  zone: Zone;
  pos: Vec2;
  home: Vec2;
  target: { tick: number; pos: Vec3; kind: ContactWindow['kind'] } | null;
  /** L'IA ne bouge qu'après son temps de réaction (tick absolu). */
  moveAfter: number;
  /** Mode Duo : le joueur ne se déplace que sur ordre (stick), jamais tout seul en profondeur. */
  manual: boolean;
  /** Commande de déplacement en cours : x vers la droite, y vers le filet adverse, norme ≤ 1. */
  stick: Vec2 | null;
  /** Aide latérale : abscisse où la balle passera à la profondeur actuelle du joueur. */
  assistX: number | null;
  /** Geste de frappe gardé en mémoire en attendant que la balle soit à portée. */
  pending: { intent: ShotIntent; expires: number } | null;
}

export type MatchPhase = 'serve' | 'rally' | 'pause' | 'over';
export type ServeSide = 'right' | 'left';
export type Timing = 'parfait' | 'tot' | 'tard' | 'juste';

/** Entrée d'un joueur humain : une frappe, ou une commande de déplacement (null = stick relâché). */
export type MatchInput =
  | { tick: number; playerId: number; intent: ShotIntent }
  | { tick: number; playerId: number; stick: Vec2 | null };

export type MatchEvent =
  | { type: 'contact'; contact: ContactEvent }
  | { type: 'serve'; serverId: number; second: boolean }
  | { type: 'hit'; playerId: number; team: Team; kind: ShotKind; quality: number; timing: Timing; power: number; offGlass: boolean }
  | { type: 'fault'; serverId: number; double: boolean }
  | { type: 'let' }
  | {
      type: 'point';
      result: PointResult;
      shots: number;
      game: boolean;
      match: boolean;
      /** Style gagné sur ce point (null si le point est perdu ou donné par une double faute). */
      style: StyleGain | null;
      /** Vitres touchées par le coup gagnant après son rebond (0 si le point vient d'une faute). */
      winnerGlass: number;
    };

export interface Match {
  tick: number;
  seed: number;
  rng: Rng;
  aiLevel: AiLevel;
  mode: ControlMode;
  ball: BallState | null;
  prevPos: Vec3;
  rally: RallyState;
  players: MatchPlayer[];
  score: MatchScore;
  phase: MatchPhase;
  phaseTicks: number;
  /** Durée de la pause en cours (ticks). */
  pauseTicks: number;
  servingTeam: Team;
  serverId: number;
  /** Prochain serveur de chaque équipe (alternance d'un jeu de service à l'autre). */
  nextServer: [number, number];
  serveNumber: 1 | 2;
  serveSide: ServeSide;
  /** Joueur de chaque équipe chargé de la prochaine balle (null = personne, l'équipe vient de frapper). */
  assigned: [number | null, number | null];
  /** Tirage fait à chaque frappe : l'IA qui reçoit tentera-t-elle le smash si la balle s'y prête ? */
  aiSmashRoll: number;
  shots: number;
  bestRally: number;
  lastContact: ContactEvent | null;
  /** Score de style cumulé de ton équipe sur le match. */
  style: number;
  /** Compteurs de style de l'échange en cours. */
  rallyPerfects: number;
  rallyOffGlass: number;
  /** Vitres touchées dans le camp du receveur, après le rebond, depuis la dernière frappe. */
  glassSinceHit: number;
}

const SERVE_DELAY_TICKS = 110;
const POINT_PAUSE_TICKS = 160;
const GAME_PAUSE_TICKS = 260;
const FAULT_PAUSE_TICKS = 90;
const CENTER_BAND = 0.8;
/** Duo : débordement toléré au-delà de la ligne centrale pour l'aide latérale (m). */
const LANE_OVERLAP = 0.5;
/** Duo : distance minimale à la ligne centrale pour un joueur au repos (m). */
const LANE_MARGIN = 1.2;
const SERVE_CONTACT_Z = 0.8;

/** Profondeur (depuis sa vitre de fond) d'une équipe IA montée au filet. */
const NET_HOME_DEPTH = 7;

export function createMatch(seed: number, aiLevel: AiLevel, court: CourtGeometry, gamesToWin: number, mode: ControlMode = 'solo'): Match {
  const W = court.width;
  const right: Zone = { xMin: W / 2, xMax: W };
  const left: Zone = { xMin: 0, xMax: W / 2 };
  const opp = AI_LEVELS[aiLevel];
  const partner = AI_LEVELS[PARTNER_LEVEL];
  const mk = (id: number, team: Team, isHuman: boolean, ai: AiParams, zone: Zone): MatchPlayer => {
    const home = homeOf(team, zone, isHuman ? 3 : ai.homeDepth, court);
    return { id, team, isHuman, ai, zone, pos: { ...home }, home, target: null, moveAfter: 0, manual: isHuman && mode === 'duo', stick: null, assistX: null, pending: null };
  };
  const m: Match = {
    tick: 0,
    seed,
    rng: createRng(seed),
    aiLevel,
    mode,
    ball: null,
    prevPos: v3(),
    rally: createRally(),
    players: [
      mk(0, 0, true, partner, right),
      mk(1, 0, mode === 'duo', partner, left),
      mk(2, 1, false, opp, left),
      mk(3, 1, false, opp, right),
    ],
    score: createScore(gamesToWin),
    phase: 'serve',
    phaseTicks: 0,
    pauseTicks: 0,
    // Tu sers le premier jeu : c'est le meilleur moyen d'apprendre le geste.
    servingTeam: 0,
    serverId: HUMAN_ID,
    nextServer: [1, 2],
    serveNumber: 1,
    serveSide: 'right',
    assigned: [null, null],
    aiSmashRoll: 1,
    shots: 0,
    bestRally: 0,
    lastContact: null,
    style: 0,
    rallyPerfects: 0,
    rallyOffGlass: 0,
    glassSinceHit: 0,
  };
  setupServe(m, court);
  return m;
}

function homeOf(team: Team, zone: Zone, depthFromBack: number, court: CourtGeometry): Vec2 {
  const x = (zone.xMin + zone.xMax) / 2;
  return { x, y: team === 0 ? depthFromBack : court.length - depthFromBack };
}

/** Carré de service de l'équipe `receiving`, du côté `side` vu depuis ce camp. */
export function serviceBox(receiving: Team, side: ServeSide, court: CourtGeometry): Box {
  const half = court.width / 2;
  // Équipe 0 regarde vers +y : sa droite est x > 5. Équipe 1 regarde vers −y : sa droite est x < 5.
  const rightIsHighX = receiving === 0;
  const highX = (side === 'right') === rightIsHighX;
  const [xMin, xMax] = highX ? [half, court.width] : [0, half];
  const [yMin, yMax] =
    receiving === 0 ? [court.netY - court.serviceLineFromNet, court.netY] : [court.netY, court.netY + court.serviceLineFromNet];
  return { xMin, xMax, yMin, yMax };
}

function other(t: Team): Team {
  return t === 0 ? 1 : 0;
}

/** Receveur : le joueur de l'équipe qui reçoit dont la moitié contient le carré visé. */
export function receiverFor(m: Match, court: CourtGeometry): number {
  const box = serviceBox(other(m.servingTeam), m.serveSide, court);
  const cx = (box.xMin + box.xMax) / 2;
  return m.players.find((p) => p.team !== m.servingTeam && cx >= p.zone.xMin && cx <= p.zone.xMax)!.id;
}

/** Tout le monde en place pour servir : serveur derrière la ligne de service, son partenaire au filet. */
function setupServe(m: Match, court: CourtGeometry): void {
  m.ball = null;
  m.phase = 'serve';
  m.phaseTicks = 0;
  // Comme au padel, le serveur sert une fois à droite, une fois à gauche. Lui seul se déplace
  // pour servir : son partenaire reste de son côté, et le serveur regagne le sien ensuite.
  m.serveSide = pointsPlayedInGame(m.score) % 2 === 0 ? 'right' : 'left';
  m.assigned = [null, null];
  const receiving = other(m.servingTeam);
  const serverBoxSide = serviceBox(m.servingTeam, m.serveSide, court);
  const receiverBox = serviceBox(receiving, m.serveSide, court);
  const receiverId = receiverFor(m, court);
  for (const p of m.players) {
    p.target = null;
    p.assistX = null;
    p.pending = null;
    p.moveAfter = 0;
    if (!p.isHuman) p.home.y = p.team === 0 ? p.ai.homeDepth : court.length - p.ai.homeDepth;
    const back = p.team === 0 ? 1 : court.length - 1;
    if (p.id === m.serverId) {
      const sx = (serverBoxSide.xMin + serverBoxSide.xMax) / 2;
      p.pos = { x: lerp(court.width / 2, sx, 0.6), y: p.team === 0 ? 1.8 : court.length - 1.8 };
    } else if (p.team === m.servingTeam) {
      // Le partenaire du serveur monte au filet, dans SON couloir, quel que soit le côté du service.
      p.pos = { x: p.home.x, y: p.team === 0 ? court.netY - 3 : court.netY + 3 };
    } else if (p.id === receiverId) {
      p.pos = { x: (receiverBox.xMin + receiverBox.xMax) / 2, y: p.team === 0 ? back + 1 : back - 1 };
    } else {
      p.pos = { ...p.home };
    }
  }
}

export function isHittable(m: Match, p: MatchPlayer, t: Tuning, court: CourtGeometry): boolean {
  const b = m.ball;
  if (!b || m.phase !== 'rally' || b.status === 'stopped' || b.status === 'out') return false;
  if (!canHit(m.rally, p.team, b.pos.y, court, p.id)) return false;
  if (b.pos.z < t.play.minContactZ || b.pos.z > maxContactZ(m, t)) return false;
  return Math.hypot(b.pos.x - p.pos.x, b.pos.y - p.pos.y) <= t.play.reach + glassReachBonus(m, p);
}

/** Aide du niveau : en Duo, une balle sortie de ta vitre se joue d'un peu plus loin. */
function glassReachBonus(m: Match, p: MatchPlayer): number {
  return p.manual && m.glassSinceHit > 0 ? AIDS[m.aiLevel].glassReachBonus : 0;
}

/** En Duo, les balles hautes se jouent au-dessus de la tête (smash) ; en solo, non. */
function maxContactZ(m: Match, t: Tuning): number {
  return m.mode === 'duo' ? t.play.overheadZ : t.play.maxContactZ;
}

export function tickMatch(m: Match, inputs: readonly MatchInput[], t: Tuning, court: CourtGeometry, out: MatchEvent[]): void {
  const dt = FIXED_DT * t.physics.timeScale;
  for (const input of inputs) {
    if (input.tick !== m.tick) continue;
    const p = m.players[input.playerId];
    if (!p?.isHuman) continue;
    if ('intent' in input) p.pending = { intent: input.intent, expires: m.tick + Math.round(t.play.swipeBufferMs / 1000 / FIXED_DT) };
    else if (p.manual) p.stick = input.stick ? { x: clamp(input.stick.x, -1, 1), y: clamp(input.stick.y, -1, 1) } : null;
  }
  for (const p of m.players) if (p.pending && m.tick > p.pending.expires) p.pending = null;
  m.phaseTicks++;

  if (m.phase === 'serve') {
    const server = m.players[m.serverId];
    if (server.isHuman) {
      // On sert d'un geste vers le haut ; un geste vers le bas (smash) n'a pas de sens ici.
      if (server.pending && server.pending.intent.kind !== 'smash') serve(m, t, court, out, server.pending.intent);
    } else if (m.phaseTicks >= SERVE_DELAY_TICKS) {
      serve(m, t, court, out, null);
    }
  } else if (m.phase === 'pause' && m.phaseTicks >= m.pauseTicks) {
    setupServe(m, court);
  }

  const ball = m.ball;
  if (ball) {
    copyV3(m.prevPos, ball.pos);
    const contacts: ContactEvent[] = [];
    stepBall(ball, dt, t.physics, court, contacts);
    for (const c of contacts) {
      out.push({ type: 'contact', contact: c });
      m.lastContact = c;
      const hitter = m.rally.lastHitter;
      if (c.surface === 'glass' && hitter !== null && m.rally.receiverBounces >= 1 && sideOf(court, c.pos.y) !== hitter) m.glassSinceHit++;
      onContact(m.rally, c, court);
    }
    onBallStatus(m.rally, ball);
    if (m.phase === 'rally' && m.rally.result) endRally(m, out);
    else if (m.phase === 'rally' && contacts.length > 0 && m.rally.lastHitter !== null) assign(m, other(m.rally.lastHitter), t, court, dt);
  }

  // Duo : tes joueurs bougent, donc l'aide latérale se recalcule régulièrement pendant que la balle arrive.
  if (m.mode === 'duo' && m.phase === 'rally' && m.tick % 10 === 0 && m.rally.lastHitter === 1) assign(m, 0, t, court, dt);

  for (const p of m.players) movePlayer(m, p, t, dt, court);

  if (m.phase === 'rally') {
    for (const p of m.players) {
      if (!p.isHuman || !p.pending || !isHittable(m, p, t, court)) continue;
      hitHuman(m, p, p.pending.intent, t, court, out);
      break;
    }
    for (const p of m.players) {
      if (p.isHuman || m.assigned[p.team] !== p.id) continue;
      if (isHittable(m, p, t, court) && (!p.target || m.tick >= p.target.tick)) hitAi(m, p, t, court, out);
    }
  }
  m.tick++;
}

/**
 * Trajectoire du service d'un joueur humain pour un geste donné. Sert au jeu ET au trait
 * pointillé de visée : ce que tu vois est exactement ce qui partira.
 * Geste droit = centre du carré ; la direction décale le point visé, la puissance la profondeur.
 */
export function humanServeShot(m: Match, intent: ShotIntent, t: Tuning, court: CourtGeometry): { origin: Vec3; vel: Vec3; box: Box } {
  const server = m.players[m.serverId];
  const receiving = other(m.servingTeam);
  const box = serviceBox(receiving, m.serveSide, court);
  const origin = { x: server.pos.x, y: server.pos.y, z: SERVE_CONTACT_Z };
  const forward = m.servingTeam === 0 ? 1 : -1;
  const nearY = receiving === 1 ? box.yMin : box.yMax;
  const farY = receiving === 1 ? box.yMax : box.yMin;
  const cx = (box.xMin + box.xMax) / 2;
  const depth = lerp(nearY + forward * 1.5, farY - forward * 0.5, intent.power);
  const target = { x: cx + Math.tan(intent.aim) * Math.abs(depth - origin.y) * 0.5, y: depth };
  if (AIDS[m.aiLevel].serveInBox) target.x = clamp(target.x, box.xMin + 0.7, box.xMax - 0.7);
  return { origin, vel: aimAt(origin, target, 'drive', forward, t.shot, t.physics, court), box };
}

function serve(m: Match, t: Tuning, court: CourtGeometry, out: MatchEvent[], intent: ShotIntent | null): void {
  const server = m.players[m.serverId];
  const receiving = other(m.servingTeam);
  const box = serviceBox(receiving, m.serveSide, court);
  let origin: Vec3;
  let vel: Vec3;
  if (intent) {
    ({ origin, vel } = humanServeShot(m, intent, t, court));
  } else {
    const ai = server.ai;
    const forward = m.servingTeam === 0 ? 1 : -1;
    const nearY = receiving === 1 ? box.yMin : box.yMax;
    const farY = receiving === 1 ? box.yMax : box.yMin;
    origin = { x: server.pos.x, y: server.pos.y, z: SERVE_CONTACT_Z };
    const target = {
      x: range(m.rng, box.xMin + 0.8, box.xMax - 0.8) + gaussian(m.rng, ai.serveError),
      y: lerp(nearY, farY, range(m.rng, 0.45, 0.85)) + gaussian(m.rng, ai.serveError),
    };
    vel = aimAt(origin, target, 'drive', forward, t.shot, t.physics, court);
  }
  m.ball = createBall(origin, vel);
  copyV3(m.prevPos, origin);
  m.rally = createRally();
  startServe(m.rally, m.servingTeam, box, receiverFor(m, court));
  m.phase = 'rally';
  m.phaseTicks = 0;
  server.pending = null;
  m.shots = 1;
  m.rallyPerfects = 0;
  m.rallyOffGlass = 0;
  m.glassSinceHit = 0;
  out.push({ type: 'serve', serverId: m.serverId, second: m.serveNumber === 2 });
  assign(m, receiving, t, court, FIXED_DT * t.physics.timeScale);
  assignNobody(m, m.servingTeam);
}

function endRally(m: Match, out: MatchEvent[]): void {
  const result = m.rally.result!;
  m.phase = 'pause';
  m.phaseTicks = 0;
  m.assigned = [null, null];
  for (const p of m.players) {
    p.target = null;
    p.assistX = null;
    p.pending = null;
  }
  if (result.reason === 'let') {
    out.push({ type: 'let' });
    m.pauseTicks = FAULT_PAUSE_TICKS;
    return;
  }
  if (result.reason === 'faute-service' && m.serveNumber === 1) {
    m.serveNumber = 2;
    out.push({ type: 'fault', serverId: m.serverId, double: false });
    m.pauseTicks = FAULT_PAUSE_TICKS;
    return;
  }
  if (result.reason === 'faute-service') out.push({ type: 'fault', serverId: m.serverId, double: true });
  const { game, match } = awardPoint(m.score, result.winner);
  m.bestRally = Math.max(m.bestRally, m.shots);
  m.serveNumber = 1;
  if (game) {
    // Changement de service : l'autre équipe, et dans chaque équipe les deux joueurs alternent.
    m.servingTeam = other(m.servingTeam);
    m.serverId = m.nextServer[m.servingTeam];
    const mates = m.players.filter((p) => p.team === m.servingTeam).map((p) => p.id);
    m.nextServer[m.servingTeam] = mates.find((id) => id !== m.serverId)!;
  }
  m.pauseTicks = game ? GAME_PAUSE_TICKS : POINT_PAUSE_TICKS;
  if (match) m.phase = 'over';
  // Coup gagnant = le point revient à l'équipe qui a frappé en dernier (sinon c'est une faute adverse).
  const winnerGlass = result.winner === m.rally.lastHitter && result.reason !== 'faute-service' ? m.glassSinceHit : 0;
  let style: StyleGain | null = null;
  if (result.winner === 0 && result.reason !== 'faute-service') {
    style = styleForPoint({ shots: m.shots, perfects: m.rallyPerfects, offGlass: m.rallyOffGlass, winnerGlass });
    m.style += style.total;
  }
  out.push({ type: 'point', result, shots: m.shots, game, match, style, winnerGlass });
}

function assignNobody(m: Match, team: Team): void {
  m.assigned[team] = null;
  for (const p of m.players) {
    if (p.team !== team) continue;
    p.target = null;
    p.assistX = null;
  }
}

/**
 * Répartition des balles dans une équipe : chacun sa moitié en largeur ; dans la bande
 * centrale, le plus rapide à arriver la prend. Celui qui ne joue pas se replace.
 */
function assign(m: Match, team: Team, t: Tuning, court: CourtGeometry, dt: number): void {
  const ball = m.ball;
  if (!ball) return;
  const mates = m.players.filter((p) => p.team === team);
  const maxSteps = Math.ceil(4 / dt);
  const zMax = maxContactZ(m, t);
  let shared: ContactWindow[] | null = null;
  const choices: (WindowChoice | null)[] = mates.map((p) => {
    const windows = m.rally.serve
      ? findWindows(ball, m.rally, team, p.id, t.physics, t.play, court, dt, maxSteps, zMax)
      : (shared ??= findWindows(ball, m.rally, team, p.id, t.physics, t.play, court, dt, maxSteps, zMax));
    const mine = windows.filter((w) => w.pos.x >= p.zone.xMin - CENTER_BAND && w.pos.x <= p.zone.xMax + CENTER_BAND);
    const speed = p.manual ? t.play.duoMoveSpeed : p.isHuman ? t.play.moveSpeed : p.ai.moveSpeed;
    const reaction = p.isHuman ? 0 : p.ai.reaction;
    if (p.manual) p.assistX = assistAtDepth(mine, p, t);
    // Occasion de smash pour l'IA : une balle haute, avant le rebond, près du filet.
    if (m.mode === 'duo' && !p.isHuman && m.aiSmashRoll < p.ai.attackChance) {
      const high = mine.filter((w) => w.kind === 'volley' && w.pos.z >= t.play.smashMinZ + 0.2 && Math.abs(w.pos.y - court.netY) < 6);
      const smash = chooseWindow(high, p.pos, speed, dt, { ...t.play, idealContactZ: 2.2 }, 0);
      if (smash?.reachable && smash.slack > reaction) return { ...smash, slack: smash.slack - reaction };
    }
    const choice = chooseWindow(mine, p.pos, speed, dt, t.play, p.isHuman ? t.play.volleyPenalty : p.ai.volleyPenalty);
    return choice ? { ...choice, slack: choice.slack - reaction } : null;
  });
  let pick = -1;
  const owns = (i: number) => {
    const c = choices[i]!;
    return c.window.pos.x >= mates[i].zone.xMin && c.window.pos.x <= mates[i].zone.xMax;
  };
  const [a, b] = [choices[0], choices[1]];
  if (a && !b) pick = 0;
  else if (b && !a) pick = 1;
  else if (a && b) {
    if (a.reachable !== b.reachable) pick = a.reachable ? 0 : 1;
    else if (owns(0) && !owns(1)) pick = 0;
    else if (owns(1) && !owns(0)) pick = 1;
    else pick = a.slack >= b.slack ? 0 : 1;
  }
  m.assigned[team] = pick >= 0 ? mates[pick].id : null;
  mates.forEach((p, i) => {
    const c = choices[i];
    p.target = i === pick && c ? { tick: m.tick + c.window.steps, pos: c.window.pos, kind: c.window.kind } : null;
  });
}

/**
 * Aide latérale (Duo) : parmi les instants jouables, celui qui se présente à la profondeur
 * actuelle du joueur. S'il n'y en a pas (lob qui passe au-dessus, balle trop courte),
 * pas d'aide : il faut reculer ou avancer soi-même.
 */
function assistAtDepth(windows: ContactWindow[], p: MatchPlayer, t: Tuning): number | null {
  let best: ContactWindow | null = null;
  let bestCost = Infinity;
  for (const w of windows) {
    if (Math.abs(w.pos.y - p.pos.y) > t.play.reach * 0.6) continue;
    const cost = Math.abs(w.pos.z - t.play.idealContactZ) + 0.002 * w.steps;
    if (cost < bestCost) {
      bestCost = cost;
      best = w;
    }
  }
  return best ? best.pos.x : null;
}

function moveManual(m: Match, p: MatchPlayer, t: Tuning, dt: number, court: CourtGeometry): void {
  if (m.phase === 'serve') return;
  const speed = t.play.duoMoveSpeed;
  let vx = 0;
  let vy = 0;
  const t2 = p.target;
  if (p.stick) {
    vx = p.stick.x * speed;
    vy = p.stick.y * speed;
  } else if (t2 && t2.kind === 'glass' && m.phase === 'rally' && AIDS[m.aiLevel].glassAutoPlace) {
    // Aide du niveau : la balle se jouera après ta vitre, le joueur va se placer tout seul.
    const dx = clamp(t2.pos.x, p.zone.xMin - CENTER_BAND, p.zone.xMax + CENTER_BAND) - p.pos.x;
    const dy = t2.pos.y - p.pos.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.05) {
      const v = Math.min(speed, d / dt);
      vx = (dx / d) * v;
      vy = (dy / d) * v;
    }
  } else if (p.assistX !== null && t.play.assist > 0 && m.phase === 'rally' && m.assigned[p.team] === p.id) {
    // Aide latérale : seul le joueur à qui revient la balle se décale, et il reste de son côté
    // (au plus 50 cm au-delà de la ligne centrale).
    const goal = clamp(p.assistX, p.zone.xMin - LANE_OVERLAP, p.zone.xMax + LANE_OVERLAP);
    const max = speed * t.play.assist;
    vx = clamp((goal - p.pos.x) / dt, -max, max);
  } else if (t.play.assist > 0) {
    // Chacun son couloir : un joueur laissé trop près du centre s'en écarte tout seul, pour que
    // la paire ne finisse pas collée au milieu. Sa profondeur ne bouge pas.
    const mid = court.width / 2;
    const leftLane = p.zone.xMin < mid;
    const goal = leftLane ? Math.min(p.pos.x, mid - LANE_MARGIN) : Math.max(p.pos.x, mid + LANE_MARGIN);
    // Du mauvais côté (il vient de servir en face de son couloir) : il rentre chez lui sans traîner.
    const wrongSide = leftLane ? p.pos.x > mid : p.pos.x < mid;
    const max = speed * (wrongSide ? 1 : t.play.assist * 0.6);
    vx = clamp((goal - p.pos.x) / dt, -max, max);
  }
  p.pos.x = clamp(p.pos.x + vx * dt, 0.4, court.width - 0.4);
  p.pos.y = clamp(p.pos.y + vy * dt, 0.4, court.netY - 0.8);
}

function movePlayer(m: Match, p: MatchPlayer, t: Tuning, dt: number, court: CourtGeometry): void {
  if (p.manual) {
    moveManual(m, p, t, dt, court);
    return;
  }
  if (m.phase === 'serve' || m.tick < p.moveAfter) return;
  const speed = p.isHuman ? t.play.moveSpeed : p.ai.moveSpeed;
  const goal = p.target ? p.target.pos : p.home;
  const gx = clamp(goal.x, 0.4, court.width - 0.4);
  const gy = p.team === 0 ? clamp(goal.y, 0.4, court.netY - 0.8) : clamp(goal.y, court.netY + 0.8, court.length - 0.4);
  const dx = gx - p.pos.x;
  const dy = gy - p.pos.y;
  const d = Math.hypot(dx, dy);
  const step = speed * dt;
  if (d <= step) {
    p.pos.x = gx;
    p.pos.y = gy;
  } else {
    p.pos.x += (dx / d) * step;
    p.pos.y += (dy / d) * step;
  }
}

/** Qualité de frappe 0–1 : balle bien centrée sur le joueur et à bonne hauteur. */
function hitQuality(ball: BallState, p: MatchPlayer, t: Tuning): number {
  const dxy = Math.hypot(ball.pos.x - p.pos.x, ball.pos.y - p.pos.y) / t.play.reach;
  const dz = Math.abs(ball.pos.z - t.play.idealContactZ) / 1.2;
  return clamp(1 - 0.6 * clamp(dxy, 0, 1) - 0.4 * clamp(dz, 0, 1), 0, 1);
}

function hitHuman(m: Match, p: MatchPlayer, intent: ShotIntent, t: Tuning, court: CourtGeometry, out: MatchEvent[]): void {
  const ball = m.ball!;
  const quality = hitQuality(ball, p, t);
  const spread = 1 - quality;
  const maxAim = t.play.maxTimingAimErrorDeg * DEG;
  const aimErr = clamp(gaussian(m.rng, 0.5) * spread * maxAim, -maxAim, maxAim);
  const powerErr = gaussian(m.rng, 0.5) * spread * t.play.maxTimingPowerError;
  // Geste vers le bas : smash si la balle est assez haute, sinon amortie.
  let kind: ShotKind = intent.kind === 'smash' && ball.pos.z < t.play.smashMinZ ? 'drop' : intent.kind;
  let actual: ShotIntent = { ...intent, kind, aim: intent.aim + aimErr, power: clamp(intent.power + powerErr, 0, 1) };
  // Aide du niveau : en sortie de vitre, un geste vers le haut donne un lob propre, la réponse
  // classique du padel dans cette situation. Le geste reste à faire, mais il pardonne.
  if (p.manual && m.glassSinceHit > 0 && AIDS[m.aiLevel].glassSafeLob && (kind === 'drive' || kind === 'lob')) {
    kind = 'lob';
    actual = { ...intent, kind, power: 0.45 };
  }
  const vel = shotVelocity(actual, ball.pos, t.shot, t.physics, court, 1);
  let timing: Timing = quality >= 0.85 ? 'parfait' : 'juste';
  // En Duo c'est toi qui te places : « trop tôt / trop tard » n'a de sens qu'avec le placement automatique.
  if (timing !== 'parfait' && p.target && !p.manual) {
    if (m.tick < p.target.tick - 4) timing = 'tot';
    else if (m.tick > p.target.tick + 4) timing = 'tard';
  }
  if (timing === 'parfait') m.rallyPerfects++;
  launch(m, p, vel, out, kind, quality, timing, actual.power, t, court);
}

function hitAi(m: Match, p: MatchPlayer, t: Tuning, court: CourtGeometry, out: MatchEvent[]): void {
  const ball = m.ball!;
  const ai = p.ai;
  const forward = p.team === 0 ? 1 : -1;
  const opponents = m.players.filter((o) => o.team !== p.team);
  // Adversaires au filet : le lob devient le coup à jouer.
  const oppNearNet = opponents.reduce((s, o) => s + Math.abs(o.pos.y - court.netY), 0) / opponents.length < 4.5;
  const atNet = Math.abs(ball.pos.y - court.netY) < 4.5 && ball.pos.z >= 0.5;
  let kind: ShotKind;
  let target: Vec2;
  if (m.mode === 'duo' && ai.attackChance > 0 && ball.pos.z >= t.play.smashMinZ + 0.2 && Math.abs(ball.pos.y - court.netY) < 7) {
    // Balle haute à portée : smash vers le côté le plus dégagé.
    const nearest = opponents.reduce((a, o) => (Math.abs(o.pos.x - ball.pos.x) < Math.abs(a.pos.x - ball.pos.x) ? o : a));
    const tx = clamp((nearest.pos.x < court.width / 2 ? court.width - 2 : 2) + gaussian(m.rng, ai.aimError), 0.5, court.width - 0.5);
    const intent: ShotIntent = { kind: 'smash', power: range(m.rng, 0.3, 0.9), aim: Math.atan2(tx - ball.pos.x, 8), swipeSpeed: 0, curvature: 0 };
    const v = shotVelocity(intent, ball.pos, t.shot, t.physics, court, forward);
    if (nextFloat(m.rng) < ai.errorChance) spoil(v, ball.pos, m.rng, t, court);
    launch(m, p, v, out, 'smash', 1, 'juste', intent.power, t, court);
    return;
  }
  if (atNet && nextFloat(m.rng) < ai.attackChance) {
    // Volée amortie : courte, le long de la ligne la plus loin de l'adversaire le plus proche.
    kind = 'drop';
    const nearest = opponents.reduce((a, o) => (Math.abs(o.pos.x - ball.pos.x) < Math.abs(a.pos.x - ball.pos.x) ? o : a));
    const x = nearest.pos.x < court.width / 2 ? court.width - 1 : 1;
    target = {
      x: clamp(x + gaussian(m.rng, ai.aimError * 0.6), 0.3, court.width - 0.3),
      y: court.netY + forward * range(m.rng, 1.2, 2.8),
    };
  } else {
    kind = nextFloat(m.rng) < (oppNearNet ? Math.max(ai.lobChance, 0.45) : ai.lobChance) ? 'lob' : 'drive';
    const depth = range(m.rng, ai.minDepth, ai.maxDepth);
    let baseX: number;
    if (nextFloat(m.rng) < ai.openCourtBias) {
      // Terrain ouvert : le point de la largeur le plus loin des deux adversaires.
      let best = court.width / 2;
      let bestGap = -1;
      for (const x of [1, 2.5, 4, 5, 6, 7.5, 9]) {
        const gap = Math.min(...opponents.map((o) => Math.abs(o.pos.x - x)));
        if (gap > bestGap) {
          bestGap = gap;
          best = x;
        }
      }
      baseX = best;
    } else {
      baseX = range(m.rng, 1.5, court.width - 1.5);
    }
    target = {
      x: clamp(baseX + gaussian(m.rng, ai.aimError), 0.3, court.width - 0.3),
      y: court.netY + forward * depth + gaussian(m.rng, ai.aimError),
    };
  }
  // Selon le niveau, l'IA joue plus ou moins bombé (marge au-dessus du filet).
  const shot = ai.loft > 0 ? { ...t.shot, netClearance: t.shot.netClearance + ai.loft } : t.shot;
  const vel = aimAt(ball.pos, target, kind, forward, shot, t.physics, court);
  if (nextFloat(m.rng) < ai.errorChance) spoil(vel, ball.pos, m.rng, t, court);
  launch(m, p, vel, out, kind, 1, 'juste', 0.5, t, court);
}

/**
 * Duo : les adversaires jouent la vraie logique du padel. Ils montent au filet après leur lob
 * ou quand tu es resté au fond, et reculent quand tu les lobes ou que tu tiens le filet.
 */
function updateAiHomes(m: Match, hitter: MatchPlayer, kind: ShotKind, court: CourtGeometry): void {
  const aiTeam: Team = 1;
  const ais = m.players.filter((p) => p.team === aiTeam);
  const humans = m.players.filter((p) => p.team !== aiTeam);
  const humansFromNet = humans.reduce((s, h) => s + (court.netY - h.pos.y), 0) / humans.length;
  let depth: number | null = null;
  if (hitter.team === aiTeam) {
    const wantsNet = kind === 'lob' || humansFromNet > 5.5;
    if (wantsNet && nextFloat(m.rng) < ais[0].ai.netChance) depth = NET_HOME_DEPTH;
    else if (humansFromNet < 4) depth = ais[0].ai.homeDepth;
  } else if (kind === 'lob') {
    depth = ais[0].ai.homeDepth;
  }
  if (depth !== null) for (const p of ais) p.home.y = court.length - depth;
}

/** Faute directe de l'IA : frappe trop forte (vitre sans rebond), dans le filet, ou trop croisée. */
function spoil(vel: Vec3, from: Vec3, rng: Rng, t: Tuning, court: CourtGeometry): void {
  const r = nextFloat(rng);
  if (r < 0.4) {
    vel.x *= 1.45;
    vel.y *= 1.45;
    vel.z = Math.abs(vel.z) * 1.45 + 1;
  } else if (r < 0.7) {
    // Dans le filet : trajectoire recalculée pour arriver au filet à 45 cm du sol (traînée négligée).
    const tn = Math.abs(court.netY - from.y) / Math.max(1, Math.abs(vel.y));
    vel.z = (0.45 - from.z + 0.5 * t.physics.gravity * tn * tn) / tn;
  } else {
    const a = (nextFloat(rng) < 0.5 ? -1 : 1) * 35 * DEG;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const x = vel.x * c - vel.y * sn;
    vel.y = vel.x * sn + vel.y * c;
    vel.x = x;
  }
}

function launch(
  m: Match,
  p: MatchPlayer,
  vel: Vec3,
  out: MatchEvent[],
  kind: ShotKind,
  quality: number,
  timing: Timing,
  power: number,
  t: Tuning,
  court: CourtGeometry,
): void {
  const ball = m.ball!;
  const offGlass = m.glassSinceHit > 0;
  if (offGlass && p.isHuman) m.rallyOffGlass++;
  m.glassSinceHit = 0;
  m.ball = createBall(ball.pos, vel);
  onHit(m.rally, p.team);
  m.shots++;
  p.pending = null;
  m.aiSmashRoll = nextFloat(m.rng);
  assignNobody(m, p.team);
  const receiving = other(p.team);
  if (m.mode === 'duo') updateAiHomes(m, p, kind, court);
  for (const o of m.players) if (o.team === receiving && !o.isHuman) o.moveAfter = m.tick + Math.round(o.ai.reaction / FIXED_DT);
  assign(m, receiving, t, court, FIXED_DT * t.physics.timeScale);
  out.push({ type: 'hit', playerId: p.id, team: p.team, kind, quality, timing, power, offGlass });
}
