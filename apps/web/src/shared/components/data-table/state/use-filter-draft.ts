/**
 * A text filter's local draft, committed on a pause in typing.
 *
 * Two boxes need exactly this — the toolbar's search and the sidebar's text
 * filter — and they had a copy each. The rules are subtle enough that two
 * copies is two chances to get them wrong:
 *
 * - **The draft leads, the store follows.** Committing per keystroke would be
 *   one request and one history entry per character.
 * - **A store change from elsewhere re-seeds the draft**, so clearing a filter
 *   or pasting a link puts the right text in the box.
 * - **That re-seed happens during render**, not from an effect: an effect would
 *   paint one frame of the stale text first.
 */

import { useEffect, useState } from "react";

import { useFilterField } from "@/shared/components/data-table/state/store";

/** Long enough that a word lands in one request, short enough to feel live. */
const COMMIT_MS = 300;

export interface FilterDraft {
  value: string;
  onChange: (next: string) => void;
}

export function useFilterDraft(filterKey: string, commitMs = COMMIT_MS): FilterDraft {
  const { value, setValue } = useFilterField(filterKey);
  const committed = typeof value === "string" ? value : "";
  const [draft, setDraft] = useState(committed);
  const [lastCommitted, setLastCommitted] = useState(committed);

  if (lastCommitted !== committed) {
    setLastCommitted(committed);
    setDraft(committed);
  }

  useEffect(() => {
    if (draft === committed) return;
    // Whitespace alone is not a filter: it would narrow to nothing and read as
    // a broken table rather than as an empty box.
    const timer = setTimeout(() => setValue(draft.trim() === "" ? undefined : draft), commitMs);
    return () => clearTimeout(timer);
  }, [draft, committed, setValue, commitMs]);

  return { value: draft, onChange: setDraft };
}
