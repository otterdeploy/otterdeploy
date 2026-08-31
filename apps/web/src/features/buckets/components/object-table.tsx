/**
 * The object listing.
 *
 * Prefix rows and object rows in ONE table, because in folder mode they are
 * one result set — S3 returns `commonPrefixes` and `contents` from the same
 * call. Rendering them as two lists would make "3 of 12 selected" ambiguous
 * about what the other nine are. The row renderers live in
 * `object-table-rows`.
 *
 * Columns drag-resize at the header dividers. Widths live in state and the
 * table is `table-fixed` over a colgroup, so a drag moves ONE divider and
 * every cell under it, never reflows the neighbours' text mid-drag.
 */
import { useState } from "react";

import { Checkbox } from "@/shared/components/ui/checkbox";
import { cn } from "@/shared/lib/utils";

import type { ObjectRow } from "../use-bucket-workbench";

import { ObjectTableRow, PrefixTableRow } from "./object-table-rows";

const SELECT_WIDTH = 36;
const MIN_WIDTH = 72;

type ResizableColumn = "key" | "size" | "storageClass" | "modified" | "actions";

const DEFAULT_WIDTHS: Record<ResizableColumn, number> = {
  key: 420,
  size: 100,
  storageClass: 130,
  modified: 170,
  actions: 88,
};

export function ObjectTable({
  prefixes,
  prefixTallies,
  scanComplete,
  objects,
  grouping,
  currentPrefix,
  selected,
  activeKey,
  onOpenPrefix,
  onSelect,
  onToggle,
  onToggleAll,
  onDownloadKey,
  onCopyLinkForKey,
}: {
  prefixes: readonly string[];
  prefixTallies: ReadonlyMap<string, { count: number; bytes: number }>;
  scanComplete: boolean;
  objects: readonly ObjectRow[];
  grouping: "folders" | "flat";
  currentPrefix: string;
  selected: ReadonlyMap<string, number>;
  activeKey: string | null;
  onOpenPrefix: (prefix: string) => void;
  onSelect: (key: string) => void;
  onToggle: (key: string, size: number) => void;
  onToggleAll: (next: boolean) => void;
  onDownloadKey: (key: string) => void;
  onCopyLinkForKey: (key: string) => void;
}) {
  const allSelected = objects.length > 0 && objects.every((o) => selected.has(o.key));
  const someSelected = objects.some((o) => selected.has(o.key));

  const [widths, setWidths] = useState(DEFAULT_WIDTHS);
  const totalWidth = SELECT_WIDTH + Object.values(widths).reduce((a, w) => a + w, 0);

  const startResize = (column: ResizableColumn, event: React.PointerEvent) => {
    event.preventDefault();
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

  if (prefixes.length === 0 && objects.length === 0) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center px-6 text-center">
        <div>
          <p className="text-[13px] text-muted-foreground">No keys match</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground/70">
            {currentPrefix === "" ? "/" : currentPrefix}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table
        className="min-w-full table-fixed border-separate border-spacing-0"
        style={{ width: totalWidth }}
      >
        <colgroup>
          <col style={{ width: SELECT_WIDTH }} />
          <col style={{ width: widths.key }} />
          <col style={{ width: widths.size }} />
          <col style={{ width: widths.storageClass }} />
          <col style={{ width: widths.modified }} />
          <col style={{ width: widths.actions }} />
        </colgroup>
        <thead>
          <tr>
            <Th>
              <Checkbox
                aria-label="Select all objects on this page"
                checked={allSelected}
                indeterminate={someSelected && !allSelected}
                onCheckedChange={(v) => onToggleAll(Boolean(v))}
              />
            </Th>
            <Th onResize={(e) => startResize("key", e)}>key</Th>
            <Th className="text-right" onResize={(e) => startResize("size", e)}>
              size
            </Th>
            <Th onResize={(e) => startResize("storageClass", e)}>storage class</Th>
            <Th onResize={(e) => startResize("modified", e)}>last modified</Th>
            <Th onResize={(e) => startResize("actions", e)}>
              <span className="sr-only">actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {prefixes.map((prefix) => (
            <PrefixTableRow
              key={prefix}
              prefix={prefix}
              tally={prefixTallies.get(prefix)}
              scanComplete={scanComplete}
              onOpen={onOpenPrefix}
            />
          ))}
          {objects.map((o) => (
            <ObjectTableRow
              key={o.key}
              object={o}
              grouping={grouping}
              currentPrefix={currentPrefix}
              isChecked={selected.has(o.key)}
              isActive={o.key === activeKey}
              onSelect={onSelect}
              onToggle={onToggle}
              onDownloadKey={onDownloadKey}
              onCopyLinkForKey={onCopyLinkForKey}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  className,
  onResize,
}: {
  children?: React.ReactNode;
  className?: string;
  onResize?: (event: React.PointerEvent) => void;
}) {
  return (
    <th
      className={cn(
        "sticky top-0 z-10 h-8 border-b bg-muted/40 px-3 text-left font-mono text-[11px] font-medium whitespace-nowrap text-muted-foreground",
        onResize !== undefined && "relative",
        className,
      )}
    >
      {children}
      {onResize !== undefined ? (
        <span
          aria-hidden
          onPointerDown={onResize}
          className="absolute top-0 -right-px z-20 h-full w-2 cursor-col-resize touch-none select-none after:absolute after:inset-y-1.5 after:right-1 after:w-px after:bg-border after:transition-colors hover:after:w-0.5 hover:after:bg-primary/60"
        />
      ) : null}
    </th>
  );
}
