// Seeded random numbers (mulberry32): the same seed gives the same sequence, so tests,
// the balance simulator and online timeout moves are reproducible.

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One item, chosen with `random` (a function returning [0, 1)). */
export function pick<T>(items: readonly T[], random: () => number): T {
  if (!items.length) throw new Error('pick from an empty list');
  return items[Math.floor(random() * items.length)];
}
