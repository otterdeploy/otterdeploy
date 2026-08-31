/**
 * The bucket viewer's controller: one state object, all of it in the URL.
 *
 * Split out of the route so the page component is layout, and so the rule that
 * makes the whole design work — the breadcrumb, the prefix rail and the filter
 * tokens are three editors of ONE state — lives somewhere it can be read in one
 * screen.
 */
import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { orpc } from "@/shared/server/orpc";

import type { BrowseSearch } from "./browse-state";

import { applyFilters, compileFilters, crumbsFor } from "./browse-state";
import { useBuckets, useObjectDetail, useObjectListing } from "./data/buckets";

export function useBucketBrowser({
  search,
  setSearch,
}: {
  search: BrowseSearch;
  setSearch: (next: Partial<BrowseSearch>) => void;
}) {
  const { buckets, isLoading: bucketsLoading } = useBuckets();

  // Land on the first bucket when none is named. Derived during render rather
  // than set from an effect: it is a function of the props, not an event.
  const activeBucket = buckets.find((b) => b.id === search.bucket) ?? buckets[0];
  const bucketId = activeBucket?.id ?? "";

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const listing = useObjectListing({
    bucketId,
    prefix: search.prefix,
    grouping: search.grouping,
    continuationToken: null,
    enabled: bucketId !== "",
  });
  const detail = useObjectDetail({ bucketId, key: activeKey });
  const remove = useMutation(orpc.storage.remove.mutationOptions());

  const prefixes = listing.data?.prefixes ?? [];
  const objects = applyFilters(listing.data?.objects ?? [], compileFilters(search.q));

  /**
   * Navigating closes the preview but KEEPS the selection.
   *
   * A bulk action spanning prefixes is a real thing to want, and silently
   * dropping keys someone ticked two folders ago is the worse surprise.
   */
  const navigateTo = (prefix: string) => {
    setActiveKey(null);
    setSearch({ prefix });
  };

  const pickBucket = (id: string) => {
    // A different bucket IS a different keyspace, so the selection cannot mean
    // anything there. This is the one place clearing it is right.
    setSelected(new Set());
    setActiveKey(null);
    setSearch({ bucket: id, prefix: "" });
  };

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleAll = (next: boolean) =>
    setSelected(next ? new Set(objects.map((o) => o.key)) : new Set());

  const deleteSelected = () => {
    const keys = [...selected];
    if (keys.length === 0 || bucketId === "") return;
    remove.mutate(
      { bucketId, keys },
      {
        onSuccess: (res) => {
          toast.success(`Deleted ${res.deleted} object${res.deleted === 1 ? "" : "s"}`);
          setSelected(new Set());
          setActiveKey(null);
          void listing.refetch();
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Couldn't delete the objects."),
      },
    );
  };

  return {
    buckets,
    bucketsLoading,
    bucketId,
    bucketName: activeBucket?.name ?? "bucket",
    crumbs: crumbsFor(activeBucket?.name ?? "bucket", search.prefix),
    prefixes,
    objects,
    listing,
    detail,
    selected,
    activeKey,
    setActiveKey,
    navigateTo,
    pickBucket,
    toggle,
    toggleAll,
    deleteSelected,
    isDeleting: remove.isPending,
  };
}
