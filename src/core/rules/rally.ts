import type { CourtGeometry } from '../constants';
import type { BallState, ContactEvent } from '../physics/step';

/** Camp 0 = en bas (joueur humain), camp 1 = en haut. */
export type Side = 0 | 1;

export type PointReason =
  | 'double-rebond'
  | 'filet'
  | 'vitre-directe'
  | 'dehors'
  | 'sortie-apres-rebond'
  | 'propre-camp'
  | 'retour-camp'
  | 'faute-service'
  | 'let';

export interface PointResult {
  winner: Side;
  reason: PointReason;
}

/**
 * État d'un échange au regard des règles (v1 simplifiée) :
 * - après une frappe, la balle doit toucher le SOL adverse avant toute vitre ou grillage adverse ;
 * - ensuite elle peut toucher les vitres, et se reprendre ;
 * - deux rebonds au sol chez le receveur = point pour le frappeur ;
 * - sortie après un rebond valide = point pour le frappeur (pas de por tres en v1) ;
 * - les vitres du camp du frappeur sont autorisées (on peut jouer contre sa propre vitre).
 */
/** Carré de service visé (en coordonnées terrain). */
export interface Box {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/**
 * Service en cours (jusqu'à ce que le receveur frappe) :
 * - la balle doit rebondir dans le carré en diagonale, sinon faute ;
 * - filet puis carré = let (on rejoue le service) ;
 * - après le rebond, la vitre est permise mais pas le grillage (faute) ;
 * - seul le receveur désigné peut jouer la balle, et seulement après le rebond.
 */
export interface ServeState {
  box: Box;
  receiverId: number;
}

export interface RallyState {
  /** Dernier camp à avoir frappé ; null avant la mise en jeu. */
  lastHitter: Side | null;
  /** Rebonds au sol dans le camp du receveur depuis la dernière frappe. */
  receiverBounces: number;
  /** Dernière surface touchée (pour distinguer « filet » de « propre camp »). */
  lastSurface: ContactEvent['surface'] | null;
  serve: ServeState | null;
  result: PointResult | null;
}

export function createRally(): RallyState {
  return { lastHitter: null, receiverBounces: 0, lastSurface: null, serve: null, result: null };
}

export function cloneRally(r: RallyState): RallyState {
  return { ...r, serve: r.serve ? { ...r.serve } : null, result: r.result ? { ...r.result } : null };
}

/** Mise en jeu par un service du camp `server` vers le carré `box`, reçu par `receiverId`. */
export function startServe(r: RallyState, server: Side, box: Box, receiverId: number): void {
  r.lastHitter = server;
  r.receiverBounces = 0;
  r.lastSurface = null;
  r.serve = { box: { ...box }, receiverId };
  r.result = null;
}

function inBox(b: Box, x: number, y: number): boolean {
  return x >= b.xMin && x <= b.xMax && y >= b.yMin && y <= b.yMax;
}

export function sideOf(court: CourtGeometry, y: number): Side {
  return y < court.netY ? 0 : 1;
}

/**
 * Un joueur ne peut frapper que si la balle est dans son camp et que son camp n'a pas frappé le
 * dernier. Pendant le service, seul le receveur peut jouer, et seulement après le rebond.
 */
export function canHit(r: RallyState, side: Side, ballY: number, court: CourtGeometry, playerId?: number): boolean {
  if (r.result || r.lastHitter === side || sideOf(court, ballY) !== side) return false;
  if (r.serve) return playerId === r.serve.receiverId && r.receiverBounces >= 1;
  return true;
}

export function onHit(r: RallyState, side: Side): void {
  if (r.result) return;
  r.lastHitter = side;
  r.receiverBounces = 0;
  r.lastSurface = null;
  r.serve = null;
}

function end(r: RallyState, winner: Side, reason: PointReason): void {
  if (!r.result) r.result = { winner, reason };
}

export function onContact(r: RallyState, ev: ContactEvent, court: CourtGeometry): void {
  if (r.result || r.lastHitter === null) return;
  const hitter = r.lastHitter;
  const receiver: Side = hitter === 0 ? 1 : 0;
  const side = sideOf(court, ev.pos.y);
  if (r.serve) {
    onServeContact(r, ev, side, hitter, receiver);
    r.lastSurface = ev.surface;
    return;
  }
  if (ev.surface === 'ground') {
    if (side === receiver) {
      r.receiverBounces++;
      if (r.receiverBounces >= 2) end(r, hitter, 'double-rebond');
    } else if (r.receiverBounces === 0) {
      // Retombée chez le frappeur sans avoir rebondi chez le receveur.
      end(r, receiver, r.lastSurface === 'net' ? 'filet' : 'propre-camp');
    } else {
      // A rebondi chez le receveur puis est revenue chez le frappeur : imprenable.
      end(r, hitter, 'retour-camp');
    }
  } else if ((ev.surface === 'glass' || ev.surface === 'fence') && side === receiver && r.receiverBounces === 0) {
    end(r, receiver, 'vitre-directe');
  }
  r.lastSurface = ev.surface;
}

function onServeContact(r: RallyState, ev: ContactEvent, side: Side, server: Side, receiver: Side): void {
  const serve = r.serve!;
  if (ev.surface === 'net') return;
  if (r.receiverBounces === 0) {
    if (ev.surface === 'ground' && side === receiver && inBox(serve.box, ev.pos.x, ev.pos.y)) {
      if (r.lastSurface === 'net') end(r, server, 'let');
      else r.receiverBounces = 1;
    } else {
      end(r, receiver, 'faute-service');
    }
    return;
  }
  if (ev.surface === 'fence') end(r, receiver, 'faute-service');
  else if (ev.surface === 'ground') {
    if (side === receiver) end(r, server, 'double-rebond');
    else end(r, server, 'retour-camp');
  }
}

/** À appeler après chaque pas : balle sortie ou arrêtée. */
export function onBallStatus(r: RallyState, ball: BallState): void {
  if (r.result || r.lastHitter === null) return;
  const hitter = r.lastHitter;
  const receiver: Side = hitter === 0 ? 1 : 0;
  if (ball.status === 'out') {
    if (r.receiverBounces >= 1) end(r, hitter, 'sortie-apres-rebond');
    else end(r, receiver, r.serve ? 'faute-service' : 'dehors');
  } else if (ball.status === 'stopped') {
    // Une balle qui s'arrête a forcément touché le sol : déjà traité par les rebonds,
    // sauf une balle morte dans le filet du côté du frappeur.
    if (r.receiverBounces >= 1) end(r, hitter, 'double-rebond');
    else end(r, receiver, 'filet');
  }
}

export const REASON_FR: Record<PointReason, string> = {
  'double-rebond': 'Double rebond',
  filet: 'Filet',
  'vitre-directe': 'Vitre directe',
  dehors: 'Dehors',
  'sortie-apres-rebond': 'Sortie après rebond',
  'propre-camp': 'Dans son camp',
  'retour-camp': 'Balle revenue',
  'faute-service': 'Faute de service',
  let: 'Let',
};
