/**
 * The bucket workbench: rail · listing · preview, one instrument surface.
 *
 * Assembled here so the route stays a shell. Mounted with a `key` per bucket
 * by the route — a different bucket is a different keyspace, so the
 * selection, the paging stack and the seen-prefix tree all die with the
 * mount rather than being cleared field by field.
 */
import type { BucketRow } from "./data/buckets-data";
import type { BucketsSearch, Grouping } from "./state";

import { BrowseBar } from "./components/browse-bar";
import { BucketRail } from "./components/bucket-rail";
import { FacetsRow } from "./components/facets-row";
import { ObjectPreview } from "./components/object-preview";
import { ObjectTable } from "./components/object-table";
import { SelectionBar } from "./components/selection-bar";
import { StatsStrip } from "./components/stats-strip";
import { WorkbenchFooter } from "./components/workbench-footer";
import { PAGE_SIZE } from "./data/buckets-data";
import { useBucketWorkbench } from "./use-bucket-workbench";

export function BucketWorkbench({
  bucket,
  search,
  setSearch,
}: {
  bucket: BucketRow;
  search: BucketsSearch;
  setSearch: (next: Partial<BucketsSearch>) => void;
}) {
  const b = useBucketWorkbench({ bucket, search, setSearch });

  // The footer sits OUTSIDE the rail/main/preview row so its top border is
  // one contiguous line across the whole surface.
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <BucketRail
          knownPrefixes={b.knownPrefixes}
          activePrefix={search.prefix}
          onPickPrefix={b.navigateTo}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          <BrowseBar
            crumbs={b.crumbs}
            query={search.q}
            grouping={search.grouping}
            statsOpen={b.statsOpen}
            uploading={b.uploading}
            onNavigate={b.navigateTo}
            onQueryChange={b.setQuery}
            onGroupingChange={(grouping: Grouping) => b.setGrouping(grouping)}
            onToggleStats={b.toggleStats}
            onUpload={(files) => void b.upload(files)}
          />

          {b.statsOpen ? (
            <StatsStrip
              bucket={bucket}
              stats={b.stats.data}
              isLoading={b.stats.isLoading}
              prefix={search.prefix}
              q={search.q}
            />
          ) : null}

          <FacetsRow stats={b.facets} q={search.q} onToggleToken={b.toggleToken} />

          {b.listing.isError ? (
            <div className="grid min-h-0 flex-1 place-items-center px-6 text-center">
              <p className="text-[13px] text-muted-foreground">
                {b.listing.error instanceof Error
                  ? b.listing.error.message
                  : "Couldn't list this bucket."}
              </p>
            </div>
          ) : b.listing.isLoading ? (
            <div className="min-h-0 flex-1 animate-pulse bg-muted/20" />
          ) : (
            <ObjectTable
              prefixes={b.prefixes}
              prefixTallies={b.prefixTallies}
              scanComplete={b.stats.data?.complete ?? false}
              objects={b.objects}
              grouping={search.grouping}
              currentPrefix={search.prefix}
              selected={b.selected}
              activeKey={b.activeKey}
              onOpenPrefix={b.navigateTo}
              onSelect={b.setActiveKey}
              onToggle={b.toggle}
              onToggleAll={b.toggleAll}
              onDownloadKey={(key) => void b.downloadKey(key)}
              onCopyLinkForKey={(key) => void b.copyLinkForKey(key)}
            />
          )}

          {b.selected.size > 0 ? (
            <SelectionBar
              count={b.selected.size}
              bytes={b.selectedBytes}
              isDeleting={b.isDeleting}
              onDownload={() => void b.downloadSelected()}
              onCopyLinks={() => void b.copyLinksSelected()}
              onDelete={b.deleteSelected}
              onClear={b.clearSelection}
            />
          ) : null}
        </main>

        {b.activeKey !== null ? (
          <ObjectPreview
            objectKey={b.activeKey}
            detail={b.detail.data}
            isLoading={b.detail.isLoading}
            onClose={() => b.setActiveKey(null)}
            onDownload={() => {
              if (b.activeKey !== null) void b.downloadKey(b.activeKey);
            }}
            onCopyLink={() => {
              if (b.activeKey !== null) void b.copyLinkForKey(b.activeKey);
            }}
            onMintUrl={() =>
              b.activeKey === null ? Promise.resolve(null) : b.mintUrl(b.activeKey)
            }
          />
        ) : null}
      </div>

      <WorkbenchFooter
        pageSize={PAGE_SIZE}
        objectCount={b.objects.length}
        prefixCount={b.prefixes.length}
        objectBytes={b.objects.reduce((sum, o) => sum + o.size, 0)}
        truncated={b.listing.data?.truncated ?? false}
        pageIndex={b.pageIndex}
        hasNextPage={b.hasNextPage}
        onPrevPage={b.prevPage}
        onNextPage={b.nextPage}
      />
    </div>
  );
}
