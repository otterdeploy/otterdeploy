/**
 * Buckets: the object-storage workbench, at its own address.
 *
 * One viewer, not two. A prefix IS a filter — walking into
 * `invoices/2026-08/` and filtering on that prefix are the same
 * ListObjectsV2 call, differing only in whether the delimiter is set — so
 * the breadcrumb and the filter tokens both edit ONE state object, and
 * Folders/Flat is a rendering toggle over one result set rather than a
 * second screen. All of that state lives in the URL, so any view is a link.
 *
 * Nothing opens on arrival. `?bucket=` is the whole answer to "which
 * keyspace", so with no bucket named the page shows the picker rather than
 * guessing at the first row — the same front door the data workbench gives
 * databases. Once you are in one, the bucket joins the header's crumb trail
 * — `acme / acme-uploads` — because which bucket you are in is the same
 * species of fact as which org.
 */
import { useEffect, useState } from "react";

import { createPortal } from "react-dom";

import { createFileRoute, useNavigate } from "@tanstack/react-router";

import type { BucketsSearch } from "@/features/buckets/state";

import { BucketPicker } from "@/features/buckets/components/bucket-picker";
import { BucketSwitcher } from "@/features/buckets/components/bucket-switcher";
import { ConnectBucketDialog } from "@/features/buckets/components/connect-bucket-dialog";
import { bucketsCollection, useBuckets } from "@/features/buckets/data/buckets-data";
import { bucketsSearchSchema } from "@/features/buckets/state";
import { BucketWorkbench } from "@/features/buckets/workbench";

export const Route = createFileRoute("/_app/$orgSlug/_shell/buckets")({
  validateSearch: bucketsSearchSchema,
  component: BucketsPage,
});

function BucketsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { buckets, isLoading } = useBuckets();
  const [connectOpen, setConnectOpen] = useState(false);

  const setSearch = (next: Partial<BucketsSearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });

  // Derived, not stored, and never guessed: an unknown or absent `?bucket=`
  // means nothing is open, and the picker shows.
  const activeBucket = buckets.find((b) => b.id === search.bucket);
  const openBucket = (id: string) =>
    void navigate({ search: { bucket: id, prefix: "", grouping: search.grouping, q: "" } });
  const leave = () => void navigate({ search: {} });

  // A freshly connected bucket becomes the active one: you connected it to
  // look at it.
  const onConnected = (id: string) => {
    void bucketsCollection.utils.refetch();
    void navigate({ search: { bucket: id, prefix: "", grouping: "folders", q: "" } });
  };

  const switcher = (
    <BucketSwitcher
      buckets={buckets}
      active={activeBucket}
      isLoading={isLoading}
      onPick={openBucket}
      onConnect={() => setConnectOpen(true)}
      onLeave={activeBucket === undefined ? undefined : leave}
    />
  );

  // The switcher joins the header's crumb trail — `acme / acme-uploads` —
  // instead of squatting in the rail. The slot is grabbed after mount because
  // the portal target renders in a different subtree of the same layout.
  const [crumbSlot, setCrumbSlot] = useState<Element | null>(null);
  useEffect(() => {
    setCrumbSlot(document.getElementById("site-header-crumb-slot"));
  }, []);
  const headerCrumb =
    crumbSlot === null
      ? null
      : createPortal(
          <>
            <span aria-hidden className="px-1 text-base text-muted-foreground/40 select-none">
              /
            </span>
            {switcher}
          </>,
          crumbSlot,
        );

  // Full-bleed, no Page gutter and no card: this is an instrument surface,
  // the exception Page's own docs carve out — a keyspace browser boxed
  // inside page padding wastes the two dimensions it needs most.
  return (
    <div className="flex h-[calc(100svh-var(--header-height))] min-h-0 min-w-0 flex-col overflow-hidden">
      {headerCrumb}
      {isLoading ? (
        <div className="min-h-0 flex-1 animate-pulse bg-muted/20" />
      ) : activeBucket === undefined ? (
        <BucketPicker
          buckets={buckets}
          onPick={openBucket}
          onConnect={() => setConnectOpen(true)}
        />
      ) : (
        <BucketWorkbench
          // Remount on bucket change: a different bucket is a different
          // keyspace, so the selection, paging and seen-prefix tree carried
          // across would describe objects that do not exist there.
          key={activeBucket.id}
          bucket={activeBucket}
          search={search}
          setSearch={setSearch}
        />
      )}

      <ConnectBucketDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onConnected={onConnected}
      />
    </div>
  );
}
