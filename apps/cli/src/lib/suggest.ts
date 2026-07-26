/**
 * "Did you mean …?" for mistyped commands.
 *
 * citty's own unknown-command path dumps the entire help output followed by
 * `Unknown command \`x\``, which buries the one useful fact under 40 lines. A
 * typo deserves a one-line answer naming the closest real command.
 *
 * Damerau-Levenshtein rather than plain Levenshtein because transposition is
 * the single most common CLI typo (`dpeloy`, `staus`) and plain edit distance
 * charges it double.
 */

/** Edit distance with adjacent transposition, capped for early exit. */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  // Three rolling rows are enough: the transposition case looks back two.
  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: cols }, (_, j) => j);
  let current: number[] = [];

  for (let i = 1; i < rows; i++) {
    current = [i];
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        (current[j - 1] ?? 0) + 1, // insertion
        (prev[j] ?? 0) + 1, // deletion
        (prev[j - 1] ?? 0) + cost, // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, (prev2[j - 2] ?? 0) + 1); // transposition
      }
      current[j] = best;
    }
    prev2 = prev;
    prev = current;
  }
  return prev[cols - 1] ?? Number.POSITIVE_INFINITY;
}

/**
 * Closest matches to `input`, nearest first, at most `limit`.
 *
 * The threshold scales with the input's length — one edit for a short word like
 * `up`, up to three for `environments` — so long names tolerate a real typo
 * while short ones don't match half the command set.
 */
export function suggestions(input: string, candidates: string[], limit = 3): string[] {
  const threshold = Math.max(1, Math.min(3, Math.floor(input.length / 3) + 1));
  const scored = candidates
    .map((candidate) => ({ candidate, score: distance(input, candidate) }))
    // A prefix match is always worth offering, however far the edit distance:
    // `otd deployment` should reach `deployments`.
    .filter(({ candidate, score }) => score <= threshold || candidate.startsWith(input))
    .sort((x, y) => x.score - y.score || x.candidate.localeCompare(y.candidate));
  return scored.slice(0, limit).map(({ candidate }) => candidate);
}
