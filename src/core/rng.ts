/**
 * Générateur pseudo-aléatoire à graine (mulberry32). Tout l'aléatoire de la simulation
 * passe par ici, jamais par Math.random : même graine + mêmes entrées = même partie,
 * ce qui permettra de rejouer un « fantôme ».
 */
export interface Rng {
  state: number;
}

export function createRng(seed: number): Rng {
  return { state: seed >>> 0 };
}

/** Nombre dans [0, 1). */
export function nextFloat(rng: Rng): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0;
  let t = rng.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function range(rng: Rng, min: number, max: number): number {
  return min + (max - min) * nextFloat(rng);
}

/** Approximation d'une loi normale centrée (somme de 4 uniformes), sans fonction transcendante. */
export function gaussian(rng: Rng, sigma: number): number {
  return (nextFloat(rng) + nextFloat(rng) + nextFloat(rng) + nextFloat(rng) - 2) * sigma * Math.sqrt(3);
}
