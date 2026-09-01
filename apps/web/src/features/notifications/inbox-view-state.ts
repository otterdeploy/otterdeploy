/**
 * The popover's small state questions: which body to show, how much is
 * beyond the page, and how a timestamp reads. Split from shared.ts (over the
 * file-size cap), which keeps the catalog and the channel helpers.
 */
/**
 * Which of the four bodies the inbox popover shows.
 *
 * A function rather than a chain of ternaries inline in the JSX, because the
 * ORDER is the correctness property and it deserves a name and a test. A
 * failed request leaves the item list empty, so checking `empty` before
 * `error` renders "No notifications yet" for a request that 500'd, timed out,
 * or lost its session: the app asserting nothing happened when in truth it
 * could not find out. That is the bug this encodes against.
 */
export type InboxViewState = "loading" | "error" | "empty" | "list";

export function inboxViewState(query: {
  isLoading: boolean;
  isError: boolean;
  itemCount: number;
}): InboxViewState {
  if (query.isLoading) return "loading";
  // Before `empty`, always.
  if (query.isError) return "error";
  return query.itemCount === 0 ? "empty" : "list";
}

/**
 * Unread rows the page could not carry.
 *
 * `unread` is counted server-side across every unread row; `items` is capped at
 * the requested page size. The difference is what the operator cannot see, and
 * it matters because "Mark all read" clears ALL unread rows, not just the
 * rendered ones — so without surfacing this, the button silently discards
 * notifications that were never shown.
 */
export function hiddenUnreadCount(input: { unread: number; itemCount: number }): number {
  return Math.max(0, input.unread - input.itemCount);
}
