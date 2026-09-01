/**
 * The two row kinds of the object listing, one file over.
 *
 * Every cell carries a hairline on its right so the columns read as columns
 * in the body, not only in the header. A prefix row shows a size only when
 * the stats scan actually walked it; otherwise "—", because summing a
 * subtree needs a full scan and a guessed number poisons every number near
 * it. A "+" marks tallies from a partial scan.
 */
import { Download01Icon, File01Icon, Folder01Icon, Link01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Checkbox } from "@/shared/components/ui/checkbox";
import { CLOCK_EXACT, clockFormatter } from "@/shared/lib/clock";
import { cn } from "@/shared/lib/utils";

import type { ObjectRow } from "../use-bucket-workbench";

import { basename, formatSize } from "../state";
import { agoLabel } from "./object-table-sort";

const formatExact = clockFormatter(CLOCK_EXACT);

/** Hot / warm / cold, so a column of class names reads at a glance. */
function classDot(storageClass: string): string {
  const c = storageClass.toUpperCase();
  if (c === "STANDARD" || c === "EXPRESS_ONEZONE") return "bg-success";
  if (c.endsWith("_IA") || c === "INTELLIGENT_TIERING") return "bg-warning";
  if (c.startsWith("GLACIER") || c === "DEEP_ARCHIVE") return "bg-info";
  return "bg-muted-foreground";
}

export function PrefixTableRow({
  prefix,
  tally,
  scanComplete,
  onOpen,
}: {
  prefix: string;
  tally: { count: number; bytes: number } | undefined;
  scanComplete: boolean;
  onOpen: (prefix: string) => void;
}) {
  const plus = tally !== undefined && !scanComplete ? "+" : "";
  return (
    <tr onClick={() => onOpen(prefix)} className="group cursor-pointer hover:bg-muted/40">
      <Td className="pl-3 text-muted-foreground">›</Td>
      <Td className="font-medium text-foreground">
        <span className="flex items-center gap-2">
          <HugeiconsIcon
            icon={Folder01Icon}
            strokeWidth={1.8}
            className="size-3.5 shrink-0 text-foreground/75"
          />
          <span className="truncate">{basename(prefix)}/</span>
          {tally !== undefined ? (
            <span className="ml-1 shrink-0 text-[10.5px] font-normal text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
              {tally.count}
              {plus} objects
            </span>
          ) : null}
        </span>
      </Td>
      <Td className={cn("text-right", tally === undefined && "text-muted-foreground/50")}>
        {tally === undefined ? "—" : `${formatSize(tally.bytes)}${plus}`}
      </Td>
      <Td className="text-muted-foreground/50">—</Td>
      <Td className="text-muted-foreground/50">—</Td>
      <Td />
    </tr>
  );
}

export function ObjectTableRow({
  object: o,
  grouping,
  currentPrefix,
  nowMs,
  isChecked,
  isActive,
  onSelect,
  onToggle,
  onDownloadKey,
  onCopyLinkForKey,
}: {
  object: ObjectRow;
  grouping: "folders" | "flat";
  currentPrefix: string;
  nowMs: number;
  isChecked: boolean;
  isActive: boolean;
  onSelect: (key: string) => void;
  onToggle: (key: string, size: number) => void;
  onDownloadKey: (key: string) => void;
  onCopyLinkForKey: (key: string) => void;
}) {
  return (
    <tr
      onClick={() => onSelect(o.key)}
      className={cn(
        "group cursor-pointer",
        isActive ? "bg-primary/5" : isChecked ? "bg-primary/[0.035]" : "hover:bg-muted/40",
      )}
    >
      <Td onClick={(e) => e.stopPropagation()} className="pl-3">
        {/* The box appears on hover or once ticked: the listing reads as
            data at rest, not as a form. */}
        <Checkbox
          aria-label={`Select ${o.key}`}
          checked={isChecked}
          onCheckedChange={() => onToggle(o.key, o.size)}
          className={cn(
            "transition-opacity",
            isChecked
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          )}
        />
      </Td>
      <Td>
        <span className="flex items-center gap-2">
          <HugeiconsIcon
            icon={File01Icon}
            strokeWidth={1.8}
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          {/* In flat mode the whole key is the point, with the walked part
              dimmed; in folder mode the path is already in the breadcrumb. */}
          {grouping === "flat" && currentPrefix !== "" ? (
            <span className="truncate">
              <span className="text-muted-foreground/60">{currentPrefix}</span>
              {o.key.slice(currentPrefix.length)}
            </span>
          ) : (
            <span className="truncate">{grouping === "flat" ? o.key : basename(o.key)}</span>
          )}
        </span>
      </Td>
      <Td className="text-right tabular-nums">{formatSize(o.size)}</Td>
      <Td>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <i aria-hidden className={cn("size-1.5 rounded-full", classDot(o.storageClass))} />
          {o.storageClass}
        </span>
      </Td>
      <Td
        className="text-muted-foreground"
        title={o.modifiedMs === null ? undefined : formatExact(o.modifiedMs)}
      >
        {agoLabel(o.modifiedMs, nowMs)}
      </Td>
      <Td onClick={(e) => e.stopPropagation()} className="pr-2 text-right">
        <span className="inline-flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
          <RowAction
            icon={Download01Icon}
            label={`Download ${o.key}`}
            onClick={() => onDownloadKey(o.key)}
          />
          <RowAction
            icon={Link01Icon}
            label={`Copy presigned link for ${o.key}`}
            onClick={() => onCopyLinkForKey(o.key)}
          />
        </span>
      </Td>
    </tr>
  );
}

function RowAction({
  icon,
  label,
  onClick,
}: {
  icon: typeof Download01Icon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none"
    >
      <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3.5" />
    </button>
  );
}

export function Td({
  children,
  className,
  title,
  onClick,
}: {
  children?: React.ReactNode;
  className?: string;
  title?: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <td
      onClick={onClick}
      title={title}
      className={cn(
        "h-[30px] truncate border-r border-b border-border/70 px-2.5 py-0 font-mono text-[12px] last:border-r-0",
        className,
      )}
    >
      {children}
    </td>
  );
}
