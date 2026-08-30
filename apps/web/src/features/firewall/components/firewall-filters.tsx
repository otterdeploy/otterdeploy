/**
 * The open tab's own controls, rendered into the one shared toolbar.
 *
 * Both of the Blocked tab's controls are always there. An earlier cut showed
 * its window picker in only one of two tenses, so the picker appeared and
 * disappeared under the pointer and every control beside it moved; the fix was
 * to stop having a control that is sometimes meaningless, not to hide one
 * better. The state filter passes that test too — at `now` it truthfully
 * reports zero expired rather than vanishing.
 */
import type { BlockedRange, BlockedState, FirewallWindow } from "../data";
import type { FirewallTab } from "../tabs";

import { BLOCKED_RANGES, BLOCKED_STATES, WINDOWS } from "../data";
import { Segmented } from "./segmented";

export function FirewallFilters({
  tab,
  range,
  onRangeChange,
  state,
  onStateChange,
  stateCounts,
  flaggedWindow,
  onFlaggedWindowChange,
}: {
  tab: FirewallTab;
  range: BlockedRange;
  onRangeChange: (next: BlockedRange) => void;
  state: BlockedState;
  onStateChange: (next: BlockedState) => void;
  /** How many rows each state would show, after the search box. */
  stateCounts: Record<BlockedState, number>;
  flaggedWindow: FirewallWindow;
  onFlaggedWindowChange: (next: FirewallWindow) => void;
}) {
  if (tab === "flagged") {
    return (
      <Segmented
        ariaLabel="Time window"
        options={WINDOWS}
        value={flaggedWindow}
        onChange={onFlaggedWindowChange}
      />
    );
  }
  // Sources is configuration, not a query: there is nothing to narrow but the
  // search box, which the toolbar owns.
  if (tab !== "blocked") return null;
  return (
    <>
      <Segmented
        ariaLabel="How far back"
        options={BLOCKED_RANGES}
        value={range}
        onChange={onRangeChange}
      />
      <Segmented
        ariaLabel="Decision state"
        options={BLOCKED_STATES}
        value={state}
        onChange={onStateChange}
        // The counts are the point: they answer "are there any expired ones"
        // before the filter is even clicked, which is what the search-box-only
        // version could never do.
        counts={stateCounts}
      />
    </>
  );
}
