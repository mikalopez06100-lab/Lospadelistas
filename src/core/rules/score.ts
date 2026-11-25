/** Équipe 0 = en bas (toi et ton partenaire), équipe 1 = en haut. */
export type Team = 0 | 1;

/**
 * Score d'un match v1 : points 0-15-30-40, POINT EN OR à 40-40 (pas d'avantage),
 * match en N jeux gagnants, pas de sets.
 */
export interface MatchScore {
  /** Points du jeu en cours : 0, 1, 2, 3 = 0, 15, 30, 40. */
  points: [number, number];
  games: [number, number];
  gamesToWin: number;
  winner: Team | null;
}

export function createScore(gamesToWin: number): MatchScore {
  return { points: [0, 0], games: [0, 0], gamesToWin, winner: null };
}

export function isGoldenPoint(s: MatchScore): boolean {
  return s.points[0] === 3 && s.points[1] === 3;
}

/** Attribue un point. Renvoie si ce point a conclu le jeu et/ou le match. */
export function awardPoint(s: MatchScore, team: Team): { game: boolean; match: boolean } {
  if (s.winner !== null) return { game: false, match: false };
  const other: Team = team === 0 ? 1 : 0;
  const wonGame = isGoldenPoint(s) || (s.points[team] === 3 && s.points[other] < 3);
  if (!wonGame) {
    s.points[team]++;
    return { game: false, match: false };
  }
  s.points = [0, 0];
  s.games[team]++;
  if (s.games[team] >= s.gamesToWin) {
    s.winner = team;
    return { game: true, match: true };
  }
  return { game: true, match: false };
}

const LABELS = ['0', '15', '30', '40'];

/** « 15 – 30 », ou « Point en or » à 40-40. */
export function pointsLabel(s: MatchScore): string {
  if (isGoldenPoint(s)) return 'Point en or';
  return `${LABELS[s.points[0]]} – ${LABELS[s.points[1]]}`;
}

/** Nombre de points joués dans le jeu : pair = service à droite, impair = à gauche. */
export function pointsPlayedInGame(s: MatchScore): number {
  return s.points[0] + s.points[1];
}
