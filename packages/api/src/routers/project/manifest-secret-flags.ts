/**
 * Carry the manifest's `secrets` declaration onto the env rows an apply writes.
 *
 * Apply REPLACES a service's env, so without a declaration every apply
 * re-inserted the rows unflagged: an explicit "mark sensitive" survived until
 * the next apply and then fell back to key-name heuristics (od-w2r). A key
 * called `TOKEN` looked secret again by luck; `MY_THING` did not, and rendered
 * in the clear.
 *
 * Its own module because manifest-apply-services.ts is at its line cap.
 */
export function withSecretFlags(
  env: ReadonlyArray<{ key: string; value: string }>,
  secrets: readonly string[] | undefined,
): Array<{ key: string; value: string; isSecret: boolean }> {
  const flagged = new Set(secrets ?? []);
  return env.map((e) => ({ ...e, isSecret: flagged.has(e.key) }));
}
