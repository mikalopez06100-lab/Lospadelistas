/** Équipe 0 = en bas (ta paire), équipe 1 = en haut. */
export type Team = 0 | 1;

/**
 * Score d'un match : points 0-15-30-40, puis ÉGALITÉ et AVANTAGE (il faut deux points d'écart
 * pour prendre le jeu). Le match se joue en `gamesToWin` jeux gagnants : 1 dans le jeu,
 * davantage seulement pour les tests et la simulation. Pas de sets.
 */
export interface MatchScore {
  /** Points marqués dans le jeu en cours (0, 1, 2, 3 = 0, 15, 30, 40 ; au-delà : égalité / avantage). */
  points: [number, number];
  games: [number, number];
  gamesToWin: number;
  winner: Team | null;
}

export function createScore(gamesToWin: number): MatchScore {
  return { points: [0, 0], games: [0, 0], gamesToWin, winner: null };
}

/** Attribue un point. Renvoie si ce point a conclu le jeu et/ou le match. */
export function awardPoint(s: MatchScore, team: Team): { game: boolean; match: boolean } {
  if (s.winner !== null) return { game: false, match: false };
  const other: Team = team === 0 ? 1 : 0;
  s.points[team]++;
  // Jeu : au moins 4 points marqués et 2 d'écart.
  if (s.points[team] < 4 || s.points[team] - s.points[other] < 2) return { game: false, match: false };
  s.points = [0, 0];
  s.games[team]++;
  if (s.games[team] >= s.gamesToWin) {
    s.winner = team;
    return { game: true, match: true };
  }
  return { game: true, match: false };
}

const LABELS = ['0', '15', '30', '40'];

/** Affichage des points de chaque équipe : « 15 », « 40 », ou « AV » pour l'avantage. */
export function pointLabels(s: MatchScore): [string, string] {
  const [a, b] = s.points;
  if (a < 3 || b < 3) return [LABELS[Math.min(a, 3)], LABELS[Math.min(b, 3)]];
  if (a === b) return ['40', '40'];
  return a > b ? ['AV', '40'] : ['40', 'AV'];
}

/** Égalité à 40 partout (ou après un avantage perdu). */
export function isDeuce(s: MatchScore): boolean {
  return s.points[0] >= 3 && s.points[0] === s.points[1];
}
