/**
 * Compare-and-set retry for active/paused toggles.
 *
 * A pause button is a TOGGLE: read the status, write the other one. Done as
 * an unguarded read then write, two concurrent clicks (a double-click, two
 * tabs) both read `active` and both write `paused`, so one click is silently
 * lost. Each toggle now writes only if the row still holds the
 * status it read (`eq(T.status, current.status)`); the click that loses that
 * race re-reads and flips what the winner wrote, so two clicks end where two
 * serial clicks would.
 */

/** One toggle attempt: the updated row, `null` (no such row), or `"lost"`. */
export type ToggleAttempt<Row> = () => Promise<Row | null | "lost">;

/** Far beyond any real contention on one row's pause button. */
export const TOGGLE_ATTEMPTS = 8;

export async function toggleWithRetry<Row>(input: {
  attempt: ToggleAttempt<Row>;
  /** Read the row as it stands, for the (theoretical) case every attempt lost. */
  current: () => Promise<Row | null>;
}): Promise<Row | null> {
  for (let i = 0; i < TOGGLE_ATTEMPTS; i++) {
    const result = await input.attempt();
    if (result !== "lost") return result;
  }
  return input.current();
}
