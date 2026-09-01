import { keyExtension, compileStorageFilters } from "@otterdeploy/shared/storage-filter";
import { Temporal } from "@otterdeploy/shared/temporal";
/**
 * Scoped aggregates for the bucket viewer's stats strip and facet chips.
 *
 * S3 keeps no per-prefix totals, so the only honest way to answer "what is
 * `exports/` costing me" is to walk the keys and count. The walk is bounded:
 * up to SCAN_KEY_LIMIT keys under the asked-for prefix, and `complete` says
 * whether that was everything — the UI must render a partial scan as "first
 * N keys", never as the bucket's total.
 *
 * The same filter grammar the client uses to narrow its table narrows this
 * scan, so the strip and the rows can never disagree about what
 * `class:GLACIER_IR size:>100MB` selects.
 */
import { Result } from "better-result";

import type { StorageError, StorageTarget } from "./target";

import { listObjects } from "./objects";

/** The scan stops after this many keys; five ListObjectsV2 pages. */
export const SCAN_KEY_LIMIT = 5_000;

const LARGE_BYTES = 100_000_000;
const STALE_MS = 365 * 86_400_000;

export interface ClassStat {
  storageClass: string;
  count: number;
  bytes: number;
}

export interface ExtensionStat {
  extension: string;
  count: number;
  bytes: number;
}

export interface PrefixStat {
  /** Child prefix relative to the scanned prefix, e.g. `2026-08/`. */
  prefix: string;
  count: number;
  bytes: number;
}

export interface StorageStats {
  objects: number;
  bytes: number;
  byClass: ClassStat[];
  /** Top extensions by count; keys with no extension are omitted. */
  byExtension: ExtensionStat[];
  /** Objects over 100 MB. */
  largeCount: number;
  /** Objects untouched for over a year. */
  staleCount: number;
  /** Roll-up for each immediate child prefix, by bytes descending. */
  childPrefixes: PrefixStat[];
  scannedKeys: number;
  /** False when the scan hit SCAN_KEY_LIMIT before the keyspace ended. */
  complete: boolean;
}

interface Tally {
  count: number;
  bytes: number;
}

function bump(map: Map<string, Tally>, key: string, bytes: number): void {
  const t = map.get(key);
  if (t) {
    t.count += 1;
    t.bytes += bytes;
  } else {
    map.set(key, { count: 1, bytes });
  }
}

/**
 * Walk the keyspace under `prefix`, apply the filter tokens, aggregate.
 *
 * Always a FLAT walk regardless of how the viewer is rendering: the numbers
 * describe the subtree, and a delimiter would hide everything below the first
 * level from them.
 */
export async function scanStorageStats(
  target: StorageTarget,
  input: { prefix: string; q: string },
): Promise<Result<StorageStats, StorageError>> {
  const acc = new StatsAccumulator(input.prefix, input.q);
  let continuationToken: string | null = null;
  let complete = true;

  while (acc.scannedKeys < SCAN_KEY_LIMIT) {
    const page = await listObjects(target, {
      prefix: input.prefix,
      grouping: "flat",
      continuationToken,
      maxKeys: Math.min(1_000, SCAN_KEY_LIMIT - acc.scannedKeys),
    });
    if (page.isErr()) return Result.err(page.error);

    for (const o of page.value.objects) acc.take(o);

    if (!page.value.truncated || page.value.continuationToken === null) break;
    if (acc.scannedKeys >= SCAN_KEY_LIMIT) {
      complete = false;
      break;
    }
    continuationToken = page.value.continuationToken;
  }

  return Result.ok(acc.finish(complete));
}

class StatsAccumulator {
  scannedKeys = 0;

  private objects = 0;
  private bytes = 0;
  private largeCount = 0;
  private staleCount = 0;
  private readonly byClass = new Map<string, Tally>();
  private readonly byExtension = new Map<string, Tally>();
  private readonly childPrefixes = new Map<string, Tally>();
  private readonly filters;
  private readonly staleCutoff = Temporal.Now.instant().epochMilliseconds - STALE_MS;

  constructor(
    private readonly prefix: string,
    q: string,
  ) {
    this.filters = compileStorageFilters(q, Temporal.Now.instant().epochMilliseconds);
  }

  take(o: { key: string; size: number; storageClass: string; lastModified: string | null }): void {
    this.scannedKeys += 1;
    const parsedMs = o.lastModified === null ? Number.NaN : Date.parse(o.lastModified);
    const modifiedMs = Number.isNaN(parsedMs) ? null : parsedMs;
    const entry = { key: o.key, size: o.size, storageClass: o.storageClass, modifiedMs };
    if (!this.filters.every((f) => f.matches(entry))) return;

    this.objects += 1;
    this.bytes += o.size;
    if (o.size > LARGE_BYTES) this.largeCount += 1;
    if (modifiedMs !== null && modifiedMs < this.staleCutoff) this.staleCount += 1;
    bump(this.byClass, o.storageClass, o.size);
    const ext = keyExtension(o.key);
    if (ext !== null) bump(this.byExtension, ext, o.size);
    const rest = o.key.slice(this.prefix.length);
    const cut = rest.indexOf("/");
    if (cut >= 0) bump(this.childPrefixes, rest.slice(0, cut + 1), o.size);
  }

  finish(complete: boolean): StorageStats {
    return {
      objects: this.objects,
      bytes: this.bytes,
      byClass: [...this.byClass.entries()]
        .map(([storageClass, t]) => ({ storageClass, count: t.count, bytes: t.bytes }))
        .sort((a, b) => b.bytes - a.bytes),
      byExtension: [...this.byExtension.entries()]
        .map(([extension, t]) => ({ extension, count: t.count, bytes: t.bytes }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
      largeCount: this.largeCount,
      staleCount: this.staleCount,
      childPrefixes: [...this.childPrefixes.entries()]
        .map(([prefix, t]) => ({ prefix, count: t.count, bytes: t.bytes }))
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 100),
      scannedKeys: this.scannedKeys,
      complete,
    };
  }
}
