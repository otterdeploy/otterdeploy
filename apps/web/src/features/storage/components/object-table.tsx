import { ArrowRight01Icon, File01Icon, Folder01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { formatBytes } from "@otterdeploy/shared/format";

import { Checkbox } from "@/shared/components/ui/checkbox";
import { CLOCK_STAMP, clockFormatter, epochMsFromIso } from "@/shared/lib/clock";
import { cn } from "@/shared/lib/utils";

/**
 * The object listing.
 *
 * Prefix rows and object rows in ONE table, because in folder mode they are one
 * result set — S3 returns `commonPrefixes` and `contents` from the same call.
 * Rendering them as two lists would make "3 of 12 selected" ambiguous about
 * what the other nine are.
 */
import type { StorageObjectRow } from "../types";

import { basename } from "../browse-state";

const formatStamp = clockFormatter(CLOCK_STAMP);

/**
 * Last-modified, through the shared clock so no `Date` reaches the view.
 *
 * A malformed timestamp off the wire becomes a dash rather than a throw inside
 * a table row — one bad object must not blank the whole listing.
 */
function formatModified(iso: string | null): string {
  if (iso === null) return "—";
  const ms = epochMsFromIso(iso);
  return ms === null ? "—" : formatStamp(ms);
}

export function ObjectTable({
  prefixes,
  objects,
  grouping,
  selected,
  activeKey,
  onOpenPrefix,
  onSelect,
  onToggle,
  onToggleAll,
}: {
  prefixes: readonly string[];
  objects: readonly StorageObjectRow[];
  grouping: "folders" | "flat";
  selected: ReadonlySet<string>;
  activeKey: string | null;
  onOpenPrefix: (prefix: string) => void;
  onSelect: (key: string) => void;
  onToggle: (key: string) => void;
  onToggleAll: (next: boolean) => void;
}) {
  const allSelected = objects.length > 0 && objects.every((o) => selected.has(o.key));
  const someSelected = objects.some((o) => selected.has(o.key));

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-separate border-spacing-0">
        <thead>
          <tr>
            <Th className="w-10">
              <Checkbox
                aria-label="Select all objects on this page"
                checked={allSelected}
                indeterminate={someSelected && !allSelected}
                onCheckedChange={(v) => onToggleAll(Boolean(v))}
              />
            </Th>
            <Th className="min-w-[320px]">key</Th>
            <Th className="w-28 text-right">size</Th>
            <Th className="w-32">storage class</Th>
            <Th className="w-44">last modified</Th>
          </tr>
        </thead>
        <tbody>
          {prefixes.map((prefix) => (
            <tr
              key={prefix}
              onClick={() => onOpenPrefix(prefix)}
              className="cursor-pointer hover:bg-muted/40"
            >
              <Td className="text-center text-muted-foreground">
                <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3" />
              </Td>
              <Td>
                <span className="flex items-center gap-1.5 text-primary">
                  <HugeiconsIcon icon={Folder01Icon} strokeWidth={2} className="size-3.5" />
                  {basename(prefix)}/
                </span>
              </Td>
              {/* A prefix has no size or class of its own. Saying "—" is honest;
                  summing its contents would need a full scan of the subtree. */}
              <Td className="text-right text-muted-foreground/50">—</Td>
              <Td className="text-muted-foreground/50">—</Td>
              <Td className="text-muted-foreground/50">—</Td>
            </tr>
          ))}

          {objects.map((o) => (
            <tr
              key={o.key}
              onClick={() => onSelect(o.key)}
              className={cn(
                "cursor-pointer",
                o.key === activeKey ? "bg-primary/5" : "hover:bg-muted/40",
              )}
            >
              <Td onClick={(e) => e.stopPropagation()} className="text-center">
                <Checkbox
                  aria-label={`Select ${o.key}`}
                  checked={selected.has(o.key)}
                  onCheckedChange={() => onToggle(o.key)}
                />
              </Td>
              <Td>
                <span className="flex items-center gap-1.5">
                  <HugeiconsIcon
                    icon={File01Icon}
                    strokeWidth={2}
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                  {/* In flat mode the full key is the point; in folder mode the
                      path is already in the breadcrumb above. */}
                  <span className="truncate">{grouping === "flat" ? o.key : basename(o.key)}</span>
                </span>
              </Td>
              <Td className="text-right">{formatBytes(o.size)}</Td>
              <Td>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] tracking-wide text-muted-foreground">
                  {o.storageClass}
                </span>
              </Td>
              <Td className="text-muted-foreground">{formatModified(o.lastModified)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "sticky top-0 z-10 border-b bg-muted/40 px-3 py-1.5 text-left font-mono text-[11px] font-medium text-muted-foreground",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
  onClick,
}: {
  children?: React.ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <td
      onClick={onClick}
      className={cn("truncate border-b px-3 py-1.5 font-mono text-[12px]", className)}
    >
      {children}
    </td>
  );
}
