/**
 * Live tag browser for the Image step. Queries `registry.listTags`
 * (Docker Registry v2 tags/list + per-tag manifest lookups) for the image
 * currently typed — anonymous for public images, the picked/auto-matched
 * stored credential for private ones. Picking a row fills the wizard's
 * `tag` field; everything shown (digest, size) comes from the registry,
 * never fabricated. Failures render the server's honest message (rate
 * limit, private repo, bad host) instead of an empty shrug.
 */

import { useEffect, useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { Card } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { SectionHeader } from "../form-primitives";
import { I } from "../icons";

/** Local debounce — don't hammer the registry on every keystroke. */
function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function shortDigest(digest: string | undefined): string | null {
  if (!digest) return null;
  return digest.replace(/^sha256:/, "").slice(0, 7);
}

interface TagInfo {
  name: string;
  digest?: string;
  sizeBytes?: number;
}

function TagRow({
  tag,
  selected,
  isLast,
  onPick,
}: {
  tag: TagInfo;
  selected: boolean;
  isLast: boolean;
  onPick: (tag: string) => void;
}) {
  const digest = shortDigest(tag.digest);
  return (
    <button
      type="button"
      onClick={() => onPick(tag.name)}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 px-3.5 py-2 text-left transition-colors hover:bg-accent",
        !isLast && "border-b border-border/60",
        selected && "bg-accent",
      )}
    >
      <I.doc width={12} height={12} className="shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate font-mono text-[13px] font-medium">{tag.name}</span>
      {digest && <span className="font-mono text-[11px] text-muted-foreground">{digest}</span>}
      {tag.sizeBytes !== undefined && (
        <span className="w-16 text-right text-[11px] text-muted-foreground">
          {formatSize(tag.sizeBytes)}
        </span>
      )}
      {selected && <I.check width={11} height={11} className="shrink-0" />}
    </button>
  );
}

/** The successful-listing body: optional filter input, the tag rows, and the
 *  truncation note. Split out of {@link ImageTagBrowser} for complexity. */
function TagList({
  tags,
  filtered,
  filter,
  onFilterChange,
  tag,
  onPick,
  truncated,
}: {
  tags: TagInfo[];
  filtered: TagInfo[];
  filter: string;
  onFilterChange: (v: string) => void;
  tag: string;
  onPick: (tag: string) => void;
  truncated: boolean | undefined;
}) {
  return (
    <>
      {tags.length > 8 && (
        <Input
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="Filter tags…"
          className="mt-2 h-8 font-mono text-xs"
        />
      )}
      {tags.length === 0 ? (
        <p className="mt-2 text-[11px] text-muted-foreground">This repository has no tags yet.</p>
      ) : (
        <Card className="mt-2 max-h-64 gap-0 overflow-y-auto rounded-md p-0">
          {filtered.length === 0 && (
            <p className="p-3 text-[11px] text-muted-foreground">
              No tags match “{filter.trim()}”.
            </p>
          )}
          {filtered.map((t, i) => (
            <TagRow
              key={t.name}
              tag={t}
              selected={tag === t.name}
              isLast={i === filtered.length - 1}
              onPick={onPick}
            />
          ))}
        </Card>
      )}
      {truncated && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Showing the first {tags.length} tags — this repository has more. Type the exact tag if it
          isn't listed.
        </p>
      )}
    </>
  );
}

/** Idle / querying / failed / registry-said-no states of the tag listing. */
function ListingStatus({
  enabled,
  isPending,
  isError,
  error,
  data,
}: {
  enabled: boolean;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: { ok: boolean; message?: string | null } | undefined;
}) {
  if (!enabled) {
    return (
      <p className="mt-2 text-[11px] text-muted-foreground">
        Type an image above to browse its tags.
      </p>
    );
  }
  if (isPending) {
    return <p className="mt-2 font-mono text-[11px] text-muted-foreground">querying registry…</p>;
  }
  if (isError) {
    return (
      <p className="mt-2 text-[11px] text-destructive">
        Tag listing failed{error instanceof Error ? ` — ${error.message}` : ""}
      </p>
    );
  }
  if (data && !data.ok) {
    return (
      <Card className="mt-2 rounded-md p-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {data.message ?? "The registry did not answer the tag listing."}
        </p>
      </Card>
    );
  }
  return null;
}

interface ImageTagBrowserProps {
  image: string;
  /** Stored registry id ("" = anonymous / auto-match by host). */
  registryId: string;
  tag: string;
  onPick: (tag: string) => void;
}

export function ImageTagBrowser({ image, registryId, tag, onPick }: ImageTagBrowserProps) {
  const debouncedImage = useDebouncedValue(image.trim(), 500);
  const [filter, setFilter] = useState("");
  const enabled = debouncedImage.length > 0;

  const listing = useQuery(
    orpc.registry.listTags.queryOptions({
      // The branded ContainerRegistryId is opaque client-side — same cast
      // idiom the source step uses for GitRepoId.
      input: {
        image: debouncedImage,
        ...(registryId ? { registryId: registryId as never } : {}),
      },
      enabled,
      staleTime: 60_000,
      retry: false,
    }),
  );

  const tags = listing.data?.ok ? listing.data.tags : [];
  const filtered = filter.trim()
    ? tags.filter((t) => t.name.toLowerCase().includes(filter.trim().toLowerCase()))
    : tags;

  return (
    <>
      <div className="mt-5">
        <SectionHeader
          title="Available tags"
          sub="Live from the registry — pick one to fill the tag field. Registries return tags in name order, not push order."
        />
      </div>

      <ListingStatus
        enabled={enabled}
        isPending={listing.isPending}
        isError={listing.isError}
        error={listing.error}
        data={listing.data}
      />

      {enabled && listing.data?.ok && (
        <TagList
          tags={tags}
          filtered={filtered}
          filter={filter}
          onFilterChange={setFilter}
          tag={tag}
          onPick={onPick}
          truncated={listing.data.truncated}
        />
      )}
    </>
  );
}
