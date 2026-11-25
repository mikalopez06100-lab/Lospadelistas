import { AI_LEVELS, FIXED_DT, PARTNER_LEVEL, type AiLevel, type AiParams, type CourtGeometry, type Tuning } from '../constants';
import { clamp, copyV3, DEG, lerp, v3, type Vec2, type Vec3 } from '../math/vec3';
import { createBall, stepBall, type BallState, type ContactEvent } from '../physics/step';
import {
  canHit,
  createRally,
  onBallStatus,
  onContact,
  onHit,
  startServe,
  type Box,
  type PointResult,
  type RallyState,
} from '../rules/rally';
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
}

export type MatchPhase = 'serve' | 'rally' | 'pause' | 'over';
export type ServeSide = 'right' | 'left';
export type Timing = 'parfait' | 'tot' | 'tard' | 'juste';

export interface MatchInput {
  tick: number;
  intent: ShotIntent;
}

export type MatchEvent =
  | { type: 'contact'; contact: ContactEvent }
  | { type: 'serve'; serverId: number; second: boolean }
  | { type: 'hit'; playerId: number; team: Team; kind: ShotKind; quality: number; timing: Timing }
  | { type: 'fault'; serverId: number; double: boolean }
  | { type: 'let' }
  | { type: 'point'; result: PointResult; shots: number; game: boolean; match: boolean };

export interface Match {
  tick: number;
  seed: number;
  rng: Rng;
  aiLevel: AiLevel;
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
  pending: { intent: ShotIntent; expires: number } | null;
  shots: number;
  bestRally: number;
  lastContact: ContactEvent | null;
}

const SERVE_DELAY_TICKS = 110;
const POINT_PAUSE_TICKS = 160;
const GAME_PAUSE_TICKS = 260;
const FAULT_PAUSE_TICKS = 90;
const CENTER_BAND = 0.8;
const SERVE_CONTACT_Z = 0.8;

export function createMatch(seed: number, aiLevel: AiLevel, court: CourtGeometry, gamesToWin: number): Match {
  const W = court.width;
  const right: Zone = { xMin: W / 2, xMax: W };
  const left: Zone = { xMin: 0, xMax: W / 2 };
  const opp = AI_LEVELS[aiLevel];
  const partner = AI_LEVELS[PARTNER_LEVEL];
  const mk = (id: number, team: Team, isHuman: boolean, ai: AiParams, zone: Zone): MatchPlayer => {
    const home = homeOf(team, zone, isHuman ? 3 : ai.homeDepth, court);
    return { id, team, isHuman, ai, zone, pos: { ...home }, home, target: null, moveAfter: 0 };
  };
  const m: Match = {
    tick: 0,
    seed,
    rng: createRng(seed),
    aiLevel,
    ball: null,
    prevPos: v3(),
    rally: createRally(),
    players: [
      mk(0, 0, true, partner, right),
      mk(1, 0, false, partner, left),
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
    pending: null,
    shots: 0,
    bestRally: 0,
    lastContact: null,
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
  m.pending = null;
  m.phase = 'serve';
  m.phaseTicks = 0;
  m.serveSide = pointsPlayedInGame(m.score) % 2 === 0 ? 'right' : 'left';
  m.assigned = [null, null];
  const receiving = other(m.servingTeam);
  const serverBoxSide = serviceBox(m.servingTeam, m.serveSide, court);
  const receiverBox = serviceBox(receiving, m.serveSide, court);
  const receiverId = receiverFor(m, court);
  for (const p of m.players) {
    p.target = null;
    p.moveAfter = 0;
    const back = p.team === 0 ? 1 : court.length - 1;
    if (p.id === m.serverId) {
      const sx = (serverBoxSide.xMin + serverBoxSide.xMax) / 2;
      p.pos = { x: lerp(court.width / 2, sx, 0.6), y: p.team === 0 ? 1.8 : court.length - 1.8 };
    } else if (p.team === m.servingTeam) {
      const sx = (serverBoxSide.xMin + serverBoxSide.xMax) / 2;
      p.pos = { x: court.width - sx, y: p.team === 0 ? court.netY - 3 : court.netY + 3 };
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
  if (b.pos.z < t.play.minContactZ || b.pos.z > t.play.maxContactZ) return false;
  return Math.hypot(b.pos.x - p.pos.x, b.pos.y - p.pos.y) <= t.play.reach;
}

export function tickMatch(m: Match, inputs: readonly MatchInput[], t: Tuning, court: CourtGeometry, out: MatchEvent[]): void {
  const dt = FIXED_DT * t.physics.timeScale;
  for (const input of inputs) {
    if (input.tick !== m.tick) continue;
    m.pending = { intent: input.intent, expires: m.tick + Math.round(t.play.swipeBufferMs / 1000 / FIXED_DT) };
  }
  if (m.pending && m.tick > m.pending.expires) m.pending = null;
  m.phaseTicks++;

  if (m.phase === 'serve') {
    const server = m.players[m.serverId];
    if (server.isHuman) {
      if (m.pending) serve(m, t, court, out, m.pending.intent);
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
      onContact(m.rally, c, court);
    }
    onBallStatus(m.rally, ball);
    if (m.phase === 'rally' && m.rally.result) endRally(m, out);
    else if (m.phase === 'rally' && contacts.length > 0 && m.rally.lastHitter !== null) assign(m, other(m.rally.lastHitter), t, court, dt);
  }

  for (const p of m.players) movePlayer(m, p, t, dt, court);

  if (m.phase === 'rally') {
    const human = m.players[HUMAN_ID];
    if (m.pending && isHittable(m, human, t, court)) hitHuman(m, human, m.pending.intent, t, court, out);
    for (const p of m.players) {
      if (p.isHuman || m.assigned[p.team] !== p.id) continue;
      if (isHittable(m, p, t, court) && (!p.target || m.tick >= p.target.tick)) hitAi(m, p, t, court, out);
    }
  }
  m.tick++;
}

function serve(m: Match, t: Tuning, court: CourtGeometry, out: MatchEvent[], intent: ShotIntent | null): void {
  const server = m.players[m.serverId];
  const receiving = other(m.servingTeam);
  const box = serviceBox(receiving, m.serveSide, court);
  const origin = { x: server.pos.x, y: server.pos.y, z: SERVE_CONTACT_Z };
  const forward = m.servingTeam === 0 ? 1 : -1;
  const nearY = receiving === 1 ? box.yMin : box.yMax;
  const farY = receiving === 1 ? box.yMax : box.yMin;
  const cx = (box.xMin + box.xMax) / 2;
  let target: Vec2;
  if (intent) {
    // Swipe droit = centre du carré. La direction décale le point visé, la puissance la profondeur.
    const depth = lerp(nearY + forward * 1.5, farY - forward * 0.5, intent.power);
    target = { x: cx + Math.tan(intent.aim) * Math.abs(depth - origin.y) * 0.5, y: depth };
  } else {
    const ai = server.ai;
    target = {
      x: range(m.rng, box.xMin + 0.8, box.xMax - 0.8) + gaussian(m.rng, ai.serveError),
      y: lerp(nearY, farY, range(m.rng, 0.45, 0.85)) + gaussian(m.rng, ai.serveError),
    };
  }
  m.ball = createBall(origin, aimAt(origin, target, 'drive', forward, t.shot, t.physics, court));
  copyV3(m.prevPos, origin);
  m.rally = createRally();
  startServe(m.rally, m.servingTeam, box, receiverFor(m, court));
  m.phase = 'rally';
  m.phaseTicks = 0;
  m.pending = null;
  m.shots = 1;
  out.push({ type: 'serve', serverId: m.serverId, second: m.serveNumber === 2 });
  assign(m, receiving, t, court, FIXED_DT * t.physics.timeScale);
  assignNobody(m, m.servingTeam);
}

function endRally(m: Match, out: MatchEvent[]): void {
  const result = m.rally.result!;
  m.phase = 'pause';
  m.phaseTicks = 0;
  m.pending = null;
  m.assigned = [null, null];
  for (const p of m.players) p.target = null;
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
  out.push({ type: 'point', result, shots: m.shots, game, match });
}

function assignNobody(m: Match, team: Team): void {
  m.assigned[team] = null;
  for (const p of m.players) if (p.team === team) p.target = null;
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
  let shared: ContactWindow[] | null = null;
  const choices: (WindowChoice | null)[] = mates.map((p) => {
    const windows = m.rally.serve ? findWindows(ball, m.rally, team, p.id, t.physics, t.play, court, dt, maxSteps) : (shared ??= findWindows(ball, m.rally, team, p.id, t.physics, t.play, court, dt, maxSteps));
    const mine = windows.filter((w) => w.pos.x >= p.zone.xMin - CENTER_BAND && w.pos.x <= p.zone.xMax + CENTER_BAND);
    const speed = p.isHuman ? t.play.moveSpeed : p.ai.moveSpeed;
    const reaction = p.isHuman ? 0 : p.ai.reaction;
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

function movePlayer(m: Match, p: MatchPlayer, t: Tuning, dt: number, court: CourtGeometry): void {
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
  const actual: ShotIntent = { ...intent, aim: intent.aim + aimErr, power: clamp(intent.power + powerErr, 0, 1) };
  const vel = shotVelocity(actual, ball.pos, t.shot, t.physics, court, 1);
  let timing: Timing = quality >= 0.85 ? 'parfait' : 'juste';
  if (timing !== 'parfait' && p.target) {
    if (m.tick < p.target.tick - 4) timing = 'tot';
    else if (m.tick > p.target.tick + 4) timing = 'tard';
  }
  launch(m, p, vel, out, intent.kind, quality, timing, t, court);
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
  const vel = aimAt(ball.pos, target, kind, forward, t.shot, t.physics, court);
  if (nextFloat(m.rng) < ai.errorChance) spoil(vel, ball.pos, m.rng, t, court);
  launch(m, p, vel, out, kind, 1, 'juste', t, court);
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
  t: Tuning,
  court: CourtGeometry,
): void {
  const ball = m.ball!;
  m.ball = createBall(ball.pos, vel);
  onHit(m.rally, p.team);
  m.shots++;
  m.pending = null;
  assignNobody(m, p.team);
  const receiving = other(p.team);
  for (const o of m.players) if (o.team === receiving && !o.isHuman) o.moveAfter = m.tick + Math.round(o.ai.reaction / FIXED_DT);
  assign(m, receiving, t, court, FIXED_DT * t.physics.timeScale);
  out.push({ type: 'hit', playerId: p.id, team: p.team, kind, quality, timing });
}
