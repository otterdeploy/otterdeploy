/**
 * Moving through rows without the mouse.
 *
 * ↑/↓ and j/k walk the feed, Home/End jump to its ends, and Enter opens the
 * row under the cursor (the row itself handles that part). Two things make
 * this harder than adding a keydown handler:
 *
 * - **The rows are virtualized.** The row being moved to may not be in the DOM
 *   yet, so the move scrolls first and focuses on the next frame, once the
 *   virtualizer has rendered the range that contains it.
 * - **Ten thousand tabbable rows is not a tab order.** Only one row is
 *   tabbable at a time (the ARIA roving-tabindex pattern), so Tab enters the
 *   table once and leaves it once, and the arrows do the walking in between.
 *
 * Focus, not selection, is the cursor: whatever the reader last focused is
 * where the next arrow key continues from, including after clicking a row.
 */

import { useCallback, useState } from "react";

/** Somewhere the reader is typing — the arrows belong to the text, not to us. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

/**
 * Which row a key moves to — the whole navigation model, as arithmetic.
 *
 * Separated from the hook so the semantics can be tested without a DOM: what
 * a key means is a decision, while scrolling and focusing are plumbing.
 * `null` means "not ours", and an unhandled key must keep its default or the
 * table would swallow type-ahead and page scrolling.
 */
export function nextIndex(key: string, activeIndex: number, count: number): number | null {
  if (count === 0) return null;
  const clamp = (index: number) => Math.max(0, Math.min(count - 1, index));
  switch (key) {
    case "ArrowDown":
    case "j":
      return clamp(activeIndex + 1);
    case "ArrowUp":
    case "k":
      // From "nowhere" (-1), up lands on the first row rather than the last:
      // the reader is entering the table, not wrapping around it.
      return clamp(activeIndex - 1);
    case "Home":
      return clamp(0);
    case "End":
      return clamp(count - 1);
    default:
      return null;
  }
}

export interface RowNavigation {
  /** The row the cursor is on, or -1 before the reader has entered the table. */
  activeIndex: number;
  /** Bind to the scroll container: row keydowns bubble to it. */
  onKeyDown: (event: React.KeyboardEvent) => void;
  /** A row reporting that it took focus, so clicking also moves the cursor. */
  onRowFocus: (index: number) => void;
  /** The one row in the tab order. */
  isTabbable: (index: number) => boolean;
}

export function useRowNavigation(params: {
  count: number;
  scrollEl: HTMLElement | null;
  scrollToIndex: (index: number) => void;
}): RowNavigation {
  const { count, scrollEl, scrollToIndex } = params;
  const [activeIndex, setActiveIndex] = useState(-1);

  const move = useCallback(
    (index: number) => {
      setActiveIndex(index);
      scrollToIndex(index);
      // The target row may be outside the rendered range: scroll now, focus
      // once the virtualizer has painted the range that contains it.
      requestAnimationFrame(() => {
        const el = scrollEl?.querySelector(`[data-row-index="${index}"]`);
        // `preventScroll`, because the virtualizer has already put the row
        // where it wants it and the browser would scroll it somewhere else.
        if (el instanceof HTMLElement) el.focus({ preventScroll: true });
      });
    },
    [scrollEl, scrollToIndex],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      // Chords belong to the app (⌘K, ⌘⇧F, browser find); bare keys to us.
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const to = nextIndex(event.key, activeIndex, count);
      if (to === null) return;
      move(to);
      // Only once a key was HANDLED: an unhandled key must keep its default,
      // or the table would swallow type-ahead and page scrolling.
      event.preventDefault();
    },
    [activeIndex, count, move],
  );

  const onRowFocus = useCallback((index: number) => setActiveIndex(index), []);

  const isTabbable = useCallback(
    // Before the reader has entered the table, the first row is the way in.
    (index: number) => (activeIndex < 0 ? index === 0 : index === activeIndex),
    [activeIndex],
  );

  return { activeIndex, onKeyDown, onRowFocus, isTabbable };
}
