/**
 * The Redis studio's two panes — the left-rail key browser and the per-type
 * value inspector. Atoms (badge / empty / skeleton) and pure helpers live in
 * {@link ./studio-atoms}.
 */

import { RefreshIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";

import type { useRedisValue } from "./data/use-redis";
import type { KeyRow } from "./studio-atoms";

import {
  EmptyState,
  formatTtl,
  ListSkeleton,
  prettyMaybeJson,
  TypeBadge,
  VALUE_LIMIT,
} from "./studio-atoms";

const DB_COUNT = 16;

export function KeyBrowser({
  db,
  dbCounts,
  onSelectDb,
  searchDraft,
  onSearchDraftChange,
  onApplySearch,
  keys,
  isLoading,
  isError,
  errorText,
  isFetching,
  scanComplete,
  match,
  selectedKey,
  onSelectKey,
  onLoadMore,
}: {
  db: number;
  dbCounts: Map<number, number>;
  onSelectDb: (db: number) => void;
  searchDraft: string;
  onSearchDraftChange: (value: string) => void;
  onApplySearch: () => void;
  keys: KeyRow[];
  isLoading: boolean;
  isError: boolean;
  errorText: string;
  isFetching: boolean;
  scanComplete: boolean;
  match: string;
  selectedKey: string | null;
  onSelectKey: (key: string) => void;
  onLoadMore: () => void;
}) {
  return (
    <div className="flex w-64 shrink-0 flex-col border-r bg-muted/20">
      <div className="space-y-2 border-b p-2">
        <Select value={String(db)} onValueChange={(v) => v && onSelectDb(Number(v))}>
          <SelectTrigger className="h-7 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: DB_COUNT }, (_, i) => (
              <SelectItem key={i} value={String(i)}>
                db{i}
                {dbCounts.has(i) ? (
                  <span className="ml-1.5 text-muted-foreground">· {dbCounts.get(i)} keys</span>
                ) : null}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative">
          <HugeiconsIcon
            icon={Search01Icon}
            strokeWidth={2}
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={searchDraft}
            onChange={(e) => onSearchDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onApplySearch();
            }}
            placeholder="Match keys…  e.g. user:*"
            className="h-7 pr-7 pl-7 font-mono text-[12px]"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute top-1/2 right-0.5 size-6 -translate-y-1/2"
            aria-label="Apply filter"
            onClick={onApplySearch}
          >
            <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="px-1.5 pb-1.5 text-[10px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          Keys {keys.length ? `· ${keys.length}${scanComplete ? "" : "+"}` : ""}
        </div>
        {isLoading && keys.length === 0 ? (
          <ListSkeleton />
        ) : isError ? (
          <p className="px-1.5 py-1 text-[12px] text-muted-foreground">{errorText}</p>
        ) : keys.length === 0 ? (
          <p className="px-1.5 py-1 text-[12px] text-muted-foreground">
            {match === "*" ? "No keys in this database." : "No keys match."}
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {keys.map((k) => (
              <button
                key={k.name}
                type="button"
                onClick={() => onSelectKey(k.name)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] transition-colors",
                  selectedKey === k.name
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <TypeBadge type={k.type} />
                <span className="min-w-0 flex-1 truncate font-mono" title={k.name}>
                  {k.name}
                </span>
                {k.ttl >= 0 ? (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {formatTtl(k.ttl)}
                  </span>
                ) : null}
              </button>
            ))}
            {!scanComplete ? (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 h-7 text-[12px] text-muted-foreground"
                disabled={isFetching}
                onClick={onLoadMore}
              >
                {isFetching ? "Loading…" : "Load more"}
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export function ValueView({
  value,
}: {
  value: NonNullable<ReturnType<typeof useRedisValue>["data"]>;
}) {
  if (value.type === "none") {
    return (
      <EmptyState
        title="Key not found"
        body="It may have expired or been deleted since the list loaded."
      />
    );
  }

  return (
    <>
      {/* Header — key identity + metadata */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <TypeBadge type={value.type} />
        <span className="min-w-0 flex-1 truncate font-mono text-[13px]" title={value.key}>
          {value.key}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {value.length} {value.type === "string" ? "bytes" : "items"}
          <span className="text-muted-foreground/40"> · </span>
          {value.ttl < 0 ? "no expiry" : formatTtl(value.ttl)}
        </span>
      </div>

      {/* Body — string text or normalized grid */}
      <div className="min-h-0 flex-1 overflow-auto">
        {value.string !== null ? (
          <pre className="p-3 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap">
            {prettyMaybeJson(value.string)}
          </pre>
        ) : value.rows ? (
          <Table className="text-[12px]">
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                {value.rows.columns.map((c) => (
                  <TableHead key={c} className="h-8 font-mono text-[11px]">
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {value.rows.cells.map((row, i) => (
                <TableRow key={i}>
                  {row.map((cell, j) => (
                    <TableCell
                      key={j}
                      className="max-w-md truncate align-top font-mono"
                      title={cell}
                    >
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </div>

      {value.truncated ? (
        <div className="border-t px-3 py-1.5 text-[11px] text-amber-500">
          Showing the first {value.string !== null ? VALUE_LIMIT : value.rows?.cells.length} of{" "}
          {value.length} — value is capped in the viewer.
        </div>
      ) : null}
    </>
  );
}
