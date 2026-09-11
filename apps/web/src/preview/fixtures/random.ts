/**
 * A seeded PRNG, so a preview shows the same table twice.
 *
 * Deterministic on purpose: a fixture that reshuffles on reload makes "does
 * this column read well" impossible to answer, because the thing being judged
 * changes between looks.
 */
export function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick from a weighted list — traffic mixes are never uniform. */
export function weightedPick<T extends { weight: number }>(
  items: readonly T[],
  random: () => number,
): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = random() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[0];
}
