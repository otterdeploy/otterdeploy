/**
 * The object listing.
 *
 * Prefix rows and object rows in ONE table, because in folder mode they are
 * one result set — S3 returns `commonPrefixes` and `contents` from the same
 * call. Rendering them as two lists would make "3 of 12 selected" ambiguous
 * about what the other nine are. Row renderers live in `object-table-rows`,
 * sorting in `object-table-sort`.
 *
 * Columns drag-resize at the header dividers (`use-column-widths`). Sorting
 * is a rendering choice over the returned page and stays out of the URL.
 */
import { useState } from "react";

import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Temporal } from "@otterdeploy/shared/temporal";

import { Checkbox } from "@/shared/components/ui/checkbox";
import { cn } from "@/shared/lib/utils";

import type { ObjectRow } from "../use-bucket-workbench";
import type { SortDir, SortKey } from "./object-table-sort";

import { ObjectTableRow, PrefixTableRow } from "./object-table-rows";
import { sortObjects, sortPrefixes } from "./object-table-sort";
import { SELECT_WIDTH, useColumnWidths } from "./use-column-widths";

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

  const { widths, totalWidth, startResize } = useColumnWidths();
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "name", dir: 1 });
  const toggleSort = (key: SortKey) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  const nowMs = Temporal.Now.instant().epochMilliseconds;
  const sortedPrefixes = sortPrefixes(prefixes, prefixTallies, sort.key, sort.dir);
  const sortedObjects = sortObjects(objects, sort.key, sort.dir);

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
          <tr className="group/head">
            <Th className="pl-3">
              <Checkbox
                aria-label="Select all objects on this page"
                checked={allSelected}
                indeterminate={someSelected && !allSelected}
                onCheckedChange={(v) => onToggleAll(Boolean(v))}
                className={cn(
                  "transition-opacity",
                  someSelected ? "opacity-100" : "opacity-0 group-hover/head:opacity-100",
                )}
              />
            </Th>
            <Th sort={sort} sortKey="name" onSort={toggleSort} onResize={startResize("key")}>
              name
            </Th>
            <Th
              className="text-right"
              sort={sort}
              sortKey="size"
              onSort={toggleSort}
              onResize={startResize("size")}
            >
              size
            </Th>
            <Th onResize={startResize("storageClass")}>class</Th>
            <Th
              sort={sort}
              sortKey="modified"
              onSort={toggleSort}
              onResize={startResize("modified")}
            >
              modified
            </Th>
            <Th>
              <span className="sr-only">actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {sortedPrefixes.map((prefix) => (
            <PrefixTableRow
              key={prefix}
              prefix={prefix}
              tally={prefixTallies.get(prefix)}
              scanComplete={scanComplete}
              onOpen={onOpenPrefix}
            />
          ))}
          {sortedObjects.map((o) => (
            <ObjectTableRow
              key={o.key}
              object={o}
              grouping={grouping}
              currentPrefix={currentPrefix}
              nowMs={nowMs}
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
  sort,
  sortKey,
  onSort,
  onResize,
}: {
  children?: React.ReactNode;
  className?: string;
  sort?: { key: SortKey; dir: SortDir };
  sortKey?: SortKey;
  onSort?: (key: SortKey) => void;
  onResize?: (event: React.PointerEvent) => void;
}) {
  const sortable = sortKey !== undefined && onSort !== undefined;
  const active = sortable && sort?.key === sortKey;
  return (
    <th
      onClick={sortable ? () => onSort(sortKey) : undefined}
      aria-sort={active ? (sort?.dir === 1 ? "ascending" : "descending") : undefined}
      className={cn(
        "sticky top-0 z-10 h-[30px] border-r border-b border-border/70 bg-background px-2.5 text-left font-mono text-[10.5px] font-medium tracking-[0.02em] whitespace-nowrap text-muted-foreground select-none last:border-r-0",
        sortable && "group/th cursor-pointer hover:text-foreground",
        onResize !== undefined && "relative",
        className,
      )}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sortable ? <SortMark active={active} descending={sort?.dir === -1} /> : null}
      </span>
      {onResize !== undefined ? (
        <span
          aria-hidden
          onPointerDown={onResize}
          onClick={(e) => e.stopPropagation()}
          className="absolute top-0 -right-1 z-20 h-full w-2 cursor-col-resize touch-none select-none hover:bg-primary/20"
        />
      ) : null}
    </th>
  );
}

/** The sort arrow: solid when active, a faint hint on header hover otherwise. */
function SortMark({ active, descending }: { active: boolean; descending: boolean }) {
  return (
    <HugeiconsIcon
      icon={active && descending ? ArrowDown01Icon : ArrowUp01Icon}
      strokeWidth={2}
      className={cn(
        "size-3 transition-opacity",
        active ? "opacity-100" : "opacity-0 group-hover/th:opacity-40",
      )}
    />
  );
}
