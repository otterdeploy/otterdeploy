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

      {!enabled && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Type an image above to browse its tags.
        </p>
      )}

      {enabled && listing.isPending && (
        <p className="mt-2 font-mono text-[11px] text-muted-foreground">querying registry…</p>
      )}

      {enabled && listing.isError && (
        <p className="mt-2 text-[11px] text-destructive">
          Tag listing failed{listing.error instanceof Error ? ` — ${listing.error.message}` : ""}
        </p>
      )}

      {enabled && listing.data && !listing.data.ok && (
        <Card className="mt-2 rounded-md p-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {listing.data.message ?? "The registry did not answer the tag listing."}
          </p>
        </Card>
      )}

      {enabled && listing.data?.ok && (
        <>
          {tags.length > 8 && (
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter tags…"
              className="mt-2 h-8 font-mono text-xs"
            />
          )}
          {tags.length === 0 ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              This repository has no tags yet.
            </p>
          ) : (
            <Card className="mt-2 max-h-64 gap-0 overflow-y-auto rounded-md p-0">
              {filtered.length === 0 && (
                <p className="p-3 text-[11px] text-muted-foreground">
                  No tags match “{filter.trim()}”.
                </p>
              )}
              {filtered.map((t, i) => {
                const selected = tag === t.name;
                const digest = shortDigest(t.digest);
                return (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => onPick(t.name)}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-3 px-3.5 py-2 text-left transition-colors hover:bg-accent",
                      i < filtered.length - 1 && "border-b border-border/60",
                      selected && "bg-accent",
                    )}
                  >
                    <I.doc width={12} height={12} className="shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate font-mono text-[13px] font-medium">
                      {t.name}
                    </span>
                    {digest && (
                      <span className="font-mono text-[11px] text-muted-foreground">{digest}</span>
                    )}
                    {t.sizeBytes !== undefined && (
                      <span className="w-16 text-right text-[11px] text-muted-foreground">
                        {formatSize(t.sizeBytes)}
                      </span>
                    )}
                    {selected && <I.check width={11} height={11} className="shrink-0" />}
                  </button>
                );
              })}
            </Card>
          )}
          {listing.data.truncated && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Showing the first {tags.length} tags — this repository has more. Type the exact tag if
              it isn't listed.
            </p>
          )}
        </>
      )}
    </>
  );
}
