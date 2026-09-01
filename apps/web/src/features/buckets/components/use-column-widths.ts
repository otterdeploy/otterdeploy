/**
 * Drag-to-resize column widths for the listing.
 *
 * Widths live in state and the table is `table-fixed` over a colgroup, so a
 * drag moves ONE divider and every cell under it, never reflows the
 * neighbours' text mid-drag. Widths reset per mount, i.e. per bucket.
 */
import { useState } from "react";

export const SELECT_WIDTH = 36;
const MIN_WIDTH = 72;

export type ResizableColumn = "key" | "size" | "storageClass" | "modified" | "actions";

const DEFAULT_WIDTHS: Record<ResizableColumn, number> = {
  key: 420,
  size: 96,
  storageClass: 150,
  modified: 110,
  actions: 72,
};

export function useColumnWidths() {
  const [widths, setWidths] = useState(DEFAULT_WIDTHS);
  const totalWidth = SELECT_WIDTH + Object.values(widths).reduce((a, w) => a + w, 0);

  const startResize = (column: ResizableColumn) => (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widths[column];
    const onMove = (move: PointerEvent) =>
      setWidths((prev) => ({
        ...prev,
        [column]: Math.max(MIN_WIDTH, startWidth + move.clientX - startX),
      }));
    const onUp = () => window.removeEventListener("pointermove", onMove);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  return { widths, totalWidth, startResize };
}
