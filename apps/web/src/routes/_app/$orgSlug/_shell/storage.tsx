/**
 * Storage: browsing the org's S3-compatible buckets.
 *
 * One viewer, not two. A prefix IS a filter — walking into `invoices/2026-08/`
 * and filtering on that prefix are the same S3 call, differing only in whether
 * the delimiter is set — so the breadcrumb, the prefix rail and the filter
 * tokens all edit ONE state object, and Folders/Flat is a rendering toggle over
 * one result set rather than a second screen.
 *
 * All of that state lives in the URL, so any view is a link, and the selection
 * survives switching grouping because it is a set of keys rather than of rows.
 *
 * Buckets are not a new thing to configure: an S3 backup destination already
 * carries the bucket, endpoint, prefix and credential, so they appear here
 * automatically. The controller lives in `features/storage/use-bucket-browser`.
 */
import { Delete02Icon, FolderLibraryIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { Page, PageHeader } from "@/shared/components/page";
import { Button } from "@/shared/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";

import type { BrowseSearch, Grouping } from "@/features/storage/browse-state";

import { browseSearchSchema } from "@/features/storage/browse-state";
import { BrowseBar } from "@/features/storage/components/browse-bar";
import { BucketRail } from "@/features/storage/components/bucket-rail";
import { ObjectPreview } from "@/features/storage/components/object-preview";
import { ObjectTable } from "@/features/storage/components/object-table";
import { useBucketBrowser } from "@/features/storage/use-bucket-browser";

export const Route = createFileRoute("/_app/$orgSlug/_shell/storage")({
  validateSearch: browseSearchSchema,
  component: StoragePage,
});

function StoragePage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const setSearch = (next: Partial<BrowseSearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });

  const b = useBucketBrowser({ search, setSearch });

  if (!b.bucketsLoading && b.buckets.length === 0) {
    return (
      <Page>
        <PageHeader title="Storage" description={DESCRIPTION} />
        <Empty className="rounded-lg border border-dashed bg-muted/20 py-12">
          <EmptyHeader>
            <HugeiconsIcon
              icon={FolderLibraryIcon}
              strokeWidth={1.5}
              className="size-10 text-muted-foreground/50"
            />
            <EmptyTitle>No buckets to browse</EmptyTitle>
            <EmptyDescription>
              Any S3-compatible backup destination shows up here. Add one under Backups →
              Destinations and it becomes browsable with the credentials already stored on it.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title="Storage" description={DESCRIPTION} />
      <div className="flex h-[calc(100dvh-14rem)] min-h-[420px] overflow-hidden rounded-lg border bg-card">
        <BucketRail
          buckets={b.buckets}
          activeBucketId={b.bucketId}
          prefixes={b.prefixes}
          activePrefix={search.prefix}
          isLoading={b.bucketsLoading}
          onPickBucket={b.pickBucket}
          onPickPrefix={b.navigateTo}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          <BrowseBar
            crumbs={b.crumbs}
            query={search.q}
            grouping={search.grouping}
            onNavigate={b.navigateTo}
            onQueryChange={(q) => setSearch({ q })}
            onGroupingChange={(grouping: Grouping) => setSearch({ grouping })}
          />

          {b.listing.isError ? (
            <ListingError error={b.listing.error} />
          ) : (
            <ObjectTable
              prefixes={b.prefixes}
              objects={b.objects}
              grouping={search.grouping}
              selected={b.selected}
              activeKey={b.activeKey}
              onOpenPrefix={b.navigateTo}
              onSelect={b.setActiveKey}
              onToggle={b.toggle}
              onToggleAll={b.toggleAll}
            />
          )}

          {b.selected.size > 0 ? (
            <SelectionBar
              count={b.selected.size}
              isDeleting={b.isDeleting}
              onDelete={b.deleteSelected}
            />
          ) : null}

          <StatusBar
            objects={b.objects.length}
            prefixes={b.prefixes.length}
            truncated={b.listing.data?.truncated ?? false}
          />
        </main>

        {b.activeKey !== null ? (
          <ObjectPreview
            bucketId={b.bucketId}
            objectKey={b.activeKey}
            detail={b.detail.data}
            isLoading={b.detail.isLoading}
            onClose={() => b.setActiveKey(null)}
          />
        ) : null}
      </div>
    </Page>
  );
}

const DESCRIPTION = "Browse the object stores your backup destinations point at.";

function ListingError({ error }: { error: unknown }) {
  return (
    <div className="grid flex-1 place-items-center px-6 text-center">
      <p className="text-[13px] text-muted-foreground">
        {error instanceof Error ? error.message : "Couldn't list this bucket."}
      </p>
    </div>
  );
}

function SelectionBar({
  count,
  isDeleting,
  onDelete,
}: {
  count: number;
  isDeleting: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-t bg-primary/5 px-3 py-1.5 font-mono text-[11.5px]">
      <b>{count} selected</b>
      <span className="flex-1" />
      <Button
        size="sm"
        variant="outline"
        className="h-6 gap-1.5 text-destructive"
        disabled={isDeleting}
        onClick={onDelete}
      >
        <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
        {isDeleting ? "Deleting…" : "Delete"}
      </Button>
    </div>
  );
}

function StatusBar({
  objects,
  prefixes,
  truncated,
}: {
  objects: number;
  prefixes: number;
  truncated: boolean;
}) {
  return (
    <div className="flex items-center gap-2 border-t bg-muted/20 px-3 py-1 font-mono text-[11px] text-muted-foreground">
      <span>
        {objects} object{objects === 1 ? "" : "s"}
        {prefixes > 0 ? ` · ${prefixes} prefixes` : ""}
      </span>
      {/* Honest about paging: S3 caps a listing at 1000 keys and we ask for 200,
          so "12 objects" must not be read as "this bucket has 12 objects". */}
      {truncated ? <span>· first page only</span> : null}
      <span className="flex-1" />
      <span>credentials stay in the control plane</span>
    </div>
  );
}
