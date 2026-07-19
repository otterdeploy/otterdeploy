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

import { useEffect, useRef, useState } from "react";

import { Database01Icon, SquareArrowExpand01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { cn } from "@/shared/lib/utils";

import type { PostgresBodyProps } from "../../../postgres/types";

import { useRedisKeys, useRedisKeyspace, useRedisValue } from "./data/use-redis";
import { EmptyState, errMessage, type KeyRow, mergeKeys, VALUE_LIMIT } from "./studio-atoms";
import { KeyBrowser, ValueView } from "./studio-parts";

interface RedisDataTabBodyProps {
  resource: PostgresBodyProps["resource"];
}

const PAGE = 200;

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
  const dbCounts = new Map<number, number>();
  for (const d of keyspaceQuery.data?.databases ?? []) dbCounts.set(d.index, d.keys);

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
      <KeyBrowser
        db={db}
        dbCounts={dbCounts}
        onSelectDb={(next) => resetSweep({ db: next })}
        searchDraft={searchDraft}
        onSearchDraftChange={setSearchDraft}
        onApplySearch={applySearch}
        keys={acc}
        isLoading={keysQuery.isLoading}
        isError={keysQuery.isError}
        errorText={errMessage(keysQuery.error)}
        isFetching={keysQuery.isFetching}
        scanComplete={scanComplete}
        match={match}
        selectedKey={selectedKey}
        onSelectKey={setSelectedKey}
        onLoadMore={loadMore}
      />

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
