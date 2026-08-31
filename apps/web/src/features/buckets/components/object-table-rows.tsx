/**
 * The two row kinds of the object listing, one file over.
 *
 * A prefix row shows a size only when the stats scan actually walked it;
 * otherwise it shows "—", because summing a subtree needs a full scan and a
 * guessed number in a size column poisons every number near it. A "+" marks
 * tallies from a partial scan.
 */
import {
  ArrowRight01Icon,
  Download01Icon,
  File01Icon,
  Folder01Icon,
  Link01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Checkbox } from "@/shared/components/ui/checkbox";
import { CLOCK_STAMP, clockFormatter, epochMsFromIso } from "@/shared/lib/clock";
import { cn } from "@/shared/lib/utils";

import type { ObjectRow } from "../use-bucket-workbench";

import { basename, formatSize } from "../state";

const formatStamp = clockFormatter(CLOCK_STAMP);

/** A malformed timestamp becomes a dash rather than a throw inside a row. */
function formatModified(iso: string | null): string {
  if (iso === null) return "—";
  const ms = epochMsFromIso(iso);
  return ms === null ? "—" : formatStamp(ms);
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
  return (
    <tr onClick={() => onOpen(prefix)} className="cursor-pointer hover:bg-muted/40">
      <Td className="text-center text-muted-foreground">
        <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3" />
      </Td>
      <Td>
        <span className="flex items-center gap-1.5 text-primary">
          <HugeiconsIcon icon={Folder01Icon} strokeWidth={2} className="size-3.5" />
          {basename(prefix)}/
        </span>
      </Td>
      <Td className={cn("text-right", tally === undefined && "text-muted-foreground/50")}>
        {tally === undefined ? "—" : formatSize(tally.bytes)}
        {tally !== undefined && !scanComplete ? "+" : ""}
      </Td>
      <Td colSpan={3} className="text-muted-foreground/70">
        {tally === undefined
          ? "—"
          : `${tally.count}${scanComplete ? "" : "+"} object${
              tally.count === 1 && scanComplete ? "" : "s"
            } below this prefix`}
      </Td>
    </tr>
  );
}

export function ObjectTableRow({
  object: o,
  grouping,
  currentPrefix,
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
      className={cn("group cursor-pointer", isActive ? "bg-primary/5" : "hover:bg-muted/40")}
    >
      <Td onClick={(e) => e.stopPropagation()} className="text-center">
        <Checkbox
          aria-label={`Select ${o.key}`}
          checked={isChecked}
          onCheckedChange={() => onToggle(o.key, o.size)}
        />
      </Td>
      <Td>
        <span className="flex items-center gap-1.5">
          <HugeiconsIcon
            icon={File01Icon}
            strokeWidth={2}
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
      <Td className="text-right">{formatSize(o.size)}</Td>
      <Td>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] tracking-wide text-muted-foreground">
          {o.storageClass}
        </span>
      </Td>
      <Td className="text-muted-foreground">{formatModified(o.lastModified)}</Td>
      <Td onClick={(e) => e.stopPropagation()} className="py-0">
        {/* Icons, revealed on row hover: actions are per-row verbs, not
            content, so at rest the column stays quiet. focus-within keeps
            them reachable by keyboard. */}
        <span className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
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
  colSpan,
  onClick,
}: {
  children?: React.ReactNode;
  className?: string;
  colSpan?: number;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <td
      onClick={onClick}
      colSpan={colSpan}
      className={cn("truncate border-b px-3 py-1.5 font-mono text-[12px]", className)}
    >
      {children}
    </td>
  );
}
