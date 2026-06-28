/**
 * "Data" tab for a MongoDB resource — a read-only document browser.
 *
 * A collection list on the left, a paginated document view on the right (each
 * doc as pretty Extended JSON). The server issues only read ops (find / skip /
 * limit), so nothing here can write.
 */
import { useState } from "react";

import { FolderLibraryIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { ErrorState } from "@/shared/components/ui/error-state";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/lib/utils";

import type { PostgresBodyProps } from "../../../postgres/types";

import { Pager } from "../../../mariadb/tabs/data";
import { useMongoCollections, useMongoDocuments } from "./data/use-mongo";

const PAGE = 50;

export function MongoDataTabBody({ resource }: { resource: PostgresBodyProps["resource"] }) {
  const resourceId = resource.resourceId;
  const collectionsQuery = useMongoCollections(resourceId);
  const [selected, setSelected] = useState<string | null>(null);
  const [skip, setSkip] = useState(0);

  const collections = collectionsQuery.data?.collections ?? [];
  const active = selected ?? collections[0]?.name ?? null;

  const docsQuery = useMongoDocuments({
    resourceId,
    collection: active ?? "",
    limit: PAGE,
    skip,
    enabled: Boolean(active),
  });

  const pick = (name: string) => {
    setSelected(name);
    setSkip(0);
  };

  return (
    <div className="flex min-h-0 gap-3" style={{ height: "60vh" }}>
      <CollectionPicker
        isLoading={collectionsQuery.isLoading}
        isError={collectionsQuery.isError}
        onRetry={() => void collectionsQuery.refetch()}
        collections={collections}
        active={active}
        onPick={pick}
      />
      <DocumentPanel
        active={active}
        skip={skip}
        isLoading={docsQuery.isLoading}
        isError={docsQuery.isError}
        isFetching={docsQuery.isFetching}
        hasMore={docsQuery.data?.hasMore ?? false}
        docs={docsQuery.data?.docs ?? []}
        onRetry={() => void docsQuery.refetch()}
        onPrev={() => setSkip((s) => Math.max(0, s - PAGE))}
        onNext={() => setSkip((s) => s + PAGE)}
      />
    </div>
  );
}

interface CollectionRef {
  name: string;
  count: number;
}

/** Left rail: collection list with loading / error / empty states. */
function CollectionPicker({
  isLoading,
  isError,
  onRetry,
  collections,
  active,
  onPick,
}: {
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  collections: CollectionRef[];
  active: string | null;
  onPick: (name: string) => void;
}) {
  return (
    <div className="flex w-56 shrink-0 flex-col overflow-y-auto rounded-md ring-1 ring-foreground/10">
      {isLoading ? (
        <div className="flex flex-col gap-1 p-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState message="Couldn’t list collections" onRetry={onRetry} />
      ) : collections.length === 0 ? (
        <div className="p-3 text-[12px] text-muted-foreground">No collections.</div>
      ) : (
        <ul className="p-1">
          {collections.map((c) => (
            <li key={c.name}>
              <button
                type="button"
                onClick={() => onPick(c.name)}
                className={cn(
                  "flex w-full items-center justify-between gap-1.5 rounded px-2 py-1.5 text-left font-mono text-[12px]",
                  active === c.name ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                )}
              >
                <span className="truncate">{c.name}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                  {c.count}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Right pane: paginated Extended-JSON document list, or an empty prompt. */
function DocumentPanel({
  active,
  skip,
  isLoading,
  isError,
  isFetching,
  hasMore,
  docs,
  onRetry,
  onPrev,
  onNext,
}: {
  active: string | null;
  skip: number;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  hasMore: boolean;
  docs: string[];
  onRetry: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col rounded-md ring-1 ring-foreground/10">
      {!active ? (
        <Empty className="h-full">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={FolderLibraryIcon} strokeWidth={2} className="size-5" />
            </EmptyMedia>
            <EmptyTitle>Pick a collection</EmptyTitle>
            <EmptyDescription>Select a collection to browse its documents.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
            <span className="truncate font-mono text-[12px]">{active}</span>
            <Pager
              offset={skip}
              page={PAGE}
              hasMore={hasMore}
              loading={isFetching}
              onPrev={onPrev}
              onNext={onNext}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            <DocumentList isLoading={isLoading} isError={isError} docs={docs} onRetry={onRetry} />
          </div>
        </>
      )}
    </div>
  );
}

/** The document body: loading skeletons, error, empty, or the JSON list. */
function DocumentList({
  isLoading,
  isError,
  docs,
  onRetry,
}: {
  isLoading: boolean;
  isError: boolean;
  docs: string[];
  onRetry: () => void;
}) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }
  if (isError) {
    return <ErrorState message="Couldn’t read documents" onRetry={onRetry} />;
  }
  if (docs.length === 0) {
    return <div className="p-2 text-[12px] text-muted-foreground">No documents.</div>;
  }
  return (
    <div className="flex flex-col gap-2">
      {docs.map((doc, i) => (
        <pre
          key={i}
          className="overflow-x-auto rounded bg-muted/50 p-2.5 font-mono text-[11.5px] leading-relaxed ring-1 ring-foreground/5"
        >
          {doc}
        </pre>
      ))}
    </div>
  );
}
