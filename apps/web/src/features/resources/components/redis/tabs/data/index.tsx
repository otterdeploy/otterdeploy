/**
 * "Data" tab for a Redis resource — a native key-value browser (read-only).
 *
 * Redis has no tables or SQL, so this is deliberately *not* the relational
 * studio: a logical-db picker + a SCAN-paged key list (type + TTL per key) on
 * the left, and a per-type value inspector on the right (string → text;
 * list/set/hash/zset/stream → a normalized grid). Nothing here can write — the
 * server only ever issues read commands and there is no free-text command
 * input. "Open editor" expands the same studio to fullscreen.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import {
  Database01Icon,
  Search01Icon,
  SquareArrowExpand01Icon,
  Tag01Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
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

import type { PostgresBodyProps } from "../../../postgres/types";

import { useRedisKeys, useRedisKeyspace, useRedisValue } from "./data/use-redis";

interface RedisDataTabBodyProps {
  resource: PostgresBodyProps["resource"];
}

interface KeyRow {
  name: string;
  type: string;
  ttl: number;
}

const PAGE = 200;
const DB_COUNT = 16;
const VALUE_LIMIT = 500;

export function RedisDataTabBody({ resource }: RedisDataTabBodyProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <RedisIdentity />
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setExpanded(true)}>
          <HugeiconsIcon icon={SquareArrowExpand01Icon} strokeWidth={2} className="size-3.5" />
          Open editor
        </Button>
      </div>

      <RedisStudio resource={resource} boxClassName="h-[calc(100dvh-20rem)] min-h-[460px]" />

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="top-0 left-0 flex h-screen w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <RedisIdentity />
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 p-4">
            <RedisStudio resource={resource} boxClassName="min-h-0 h-full" />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RedisIdentity() {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <HugeiconsIcon
        icon={Database01Icon}
        strokeWidth={2}
        className="size-4 text-muted-foreground"
      />
      <span className="text-muted-foreground">redis</span>
      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-muted-foreground">
        READ-ONLY
      </span>
    </div>
  );
}

function RedisStudio({
  resource,
  boxClassName,
}: {
  resource: RedisDataTabBodyProps["resource"];
  boxClassName?: string;
}) {
  const resourceId = String(resource.resourceId);

  const [db, setDb] = useState(0);
  const [searchDraft, setSearchDraft] = useState("");
  const [match, setMatch] = useState("*");
  const [reqCursor, setReqCursor] = useState("0");
  const [acc, setAcc] = useState<KeyRow[]>([]);
  const [nextCursor, setNextCursor] = useState("0");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Guards the accumulator against re-appending the same page on re-render.
  const appliedRef = useRef<string>("");

  const keyspaceQuery = useRedisKeyspace(resourceId);
  const dbCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const d of keyspaceQuery.data?.databases ?? []) m.set(d.index, d.keys);
    return m;
  }, [keyspaceQuery.data]);

  const keysQuery = useRedisKeys({
    resourceId,
    db,
    match,
    cursor: reqCursor,
    count: PAGE,
  });

  // Fold each SCAN page into the accumulated list (replace on a fresh sweep,
  // append-dedupe while loading more).
  useEffect(() => {
    const data = keysQuery.data;
    if (!data) return;
    const stamp = `${db}|${match}|${reqCursor}`;
    if (appliedRef.current === stamp) return;
    appliedRef.current = stamp;
    setAcc((prev) => (reqCursor === "0" ? data.keys : mergeKeys(prev, data.keys)));
    setNextCursor(data.cursor);
  }, [keysQuery.data, db, match, reqCursor]);

  const resetSweep = (next: { db?: number; match?: string }) => {
    if (next.db !== undefined) setDb(next.db);
    if (next.match !== undefined) setMatch(next.match);
    setReqCursor("0");
    setAcc([]);
    setNextCursor("0");
    appliedRef.current = "";
    setSelectedKey(null);
  };

  const applySearch = () => resetSweep({ match: searchDraft.trim() || "*" });
  const loadMore = () => {
    if (nextCursor !== "0") setReqCursor(nextCursor);
  };

  const valueQuery = useRedisValue({
    resourceId,
    db,
    key: selectedKey,
    limit: VALUE_LIMIT,
    enabled: true,
  });

  const scanComplete = nextCursor === "0";

  return (
    <div className={cn("flex overflow-hidden rounded-lg border bg-card", boxClassName)}>
      {/* ── Left rail — db picker + key browser ──────────────────────────── */}
      <div className="flex w-64 shrink-0 flex-col border-r bg-muted/20">
        <div className="space-y-2 border-b p-2">
          <Select value={String(db)} onValueChange={(v) => v && resetSweep({ db: Number(v) })}>
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
              onChange={(e) => setSearchDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applySearch();
              }}
              placeholder="Match keys…  e.g. user:*"
              className="h-7 pr-7 pl-7 font-mono text-[12px]"
            />
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-1/2 right-0.5 size-6 -translate-y-1/2"
              aria-label="Apply filter"
              onClick={applySearch}
            >
              <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className="size-3.5" />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className="px-1.5 pb-1.5 text-[10px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
            Keys {acc.length ? `· ${acc.length}${scanComplete ? "" : "+"}` : ""}
          </div>
          {keysQuery.isLoading && acc.length === 0 ? (
            <ListSkeleton />
          ) : keysQuery.isError ? (
            <p className="px-1.5 py-1 text-[12px] text-muted-foreground">
              {errMessage(keysQuery.error)}
            </p>
          ) : acc.length === 0 ? (
            <p className="px-1.5 py-1 text-[12px] text-muted-foreground">
              {match === "*" ? "No keys in this database." : "No keys match."}
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {acc.map((k) => (
                <button
                  key={k.name}
                  type="button"
                  onClick={() => setSelectedKey(k.name)}
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
                  disabled={keysQuery.isFetching}
                  onClick={loadMore}
                >
                  {keysQuery.isFetching ? "Loading…" : "Load more"}
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* ── Main — value inspector ───────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!selectedKey ? (
          <EmptyState title="Select a key" body="Pick a key from the left to inspect its value." />
        ) : valueQuery.isLoading ? (
          <EmptyState title="Loading…" body="" />
        ) : valueQuery.isError ? (
          <EmptyState title="Couldn’t read key" body={errMessage(valueQuery.error)} />
        ) : valueQuery.data ? (
          <ValueView value={valueQuery.data} />
        ) : null}
      </div>
    </div>
  );
}

function ValueView({ value }: { value: NonNullable<ReturnType<typeof useRedisValue>["data"]> }) {
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

function TypeBadge({ type }: { type: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
      <HugeiconsIcon icon={Tag01Icon} strokeWidth={2} className="size-2.5" />
      {type}
    </span>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon
            icon={Database01Icon}
            strokeWidth={2}
            className="size-5 text-muted-foreground"
          />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {body ? <EmptyDescription>{body}</EmptyDescription> : null}
      </EmptyHeader>
    </Empty>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1 px-1.5 py-1">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-5 animate-pulse rounded bg-muted/60" />
      ))}
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** Append a SCAN page, dropping keys already in the list (cursors can repeat). */
function mergeKeys(prev: KeyRow[], next: KeyRow[]): KeyRow[] {
  const seen = new Set(prev.map((k) => k.name));
  return [...prev, ...next.filter((k) => !seen.has(k.name))];
}

/** Compact TTL: `45s`, `12m`, `3h`, `5d`. (-1/-2 are filtered by callers.) */
function formatTtl(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

/** Pretty-print a string value if it parses as JSON; otherwise return as-is. */
function prettyMaybeJson(s: string): string {
  const t = s.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return s;
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return s;
  }
}

/** Pull the human reason out of an oRPC error (QUERY_FAILED carries `data.reason`). */
function errMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const data = (error as { data?: { reason?: unknown } }).data;
    if (data && typeof data.reason === "string") return data.reason;
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Something went wrong.";
}
