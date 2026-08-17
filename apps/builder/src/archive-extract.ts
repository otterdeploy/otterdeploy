/**
 * Hardened extraction for tenant-uploaded `.tar.gz` source archives
 * (`source: "upload"` deploys, see `extract.ts`). Replaces a bare
 * `tar -xzf` shell-out, which trusts every entry in the archive: a
 * hostile tarball could write outside the work dir (Zip Slip), plant a
 * symlink and then write through it, drop a device/fifo node, or expand
 * into gigabytes of disk from a tiny upload (a decompression bomb).
 *
 * This module parses the tar stream itself (via `tar-stream`, a pure-JS
 * parser, no shelling out, so every entry is inspected before a single
 * byte reaches the filesystem) and enforces, per entry and in aggregate:
 *
 *   - no absolute paths, no `..` traversal segments (Zip Slip)
 *   - no symlink or hard-link entries at all: the archive can't create a
 *     link to walk through later, so "symlink-then-write" is structurally
 *     impossible, not just discouraged
 *   - no device/character/block/FIFO entries
 *   - a cap on entry count, per-entry bytes, and total decompressed bytes
 *     (zip-bomb defense), plus a compression-ratio trip wire so a
 *     highly-compressible bomb aborts long before the absolute cap
 *   - a cap on path length and path depth
 *   - duplicate-entry rejection, including entries that only differ by
 *     Unicode normalization form or case: both collide to the same file
 *     on the case-insensitive, normalization-sensitive default macOS
 *     volume format, so the second entry would silently shadow the first
 *   - modes are normalized on write (this process's own umask/uid/gid;
 *     header uid/gid/mode bits from the archive are never trusted)
 *
 * Nested archives (a tar/zip entry inside the tar) are not a distinct
 * amplification vector here: this is a single non-recursive pass, so a
 * nested archive just counts as one more regular file against the same
 * per-entry and total-byte caps: it is never itself unpacked.
 */

import { createReadStream } from "node:fs";
import { mkdir, open, stat as fsStat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import tarStreamModule from "tar-stream";

import type { LogSink } from "./log-stream";

const { extract: createTarExtractor } = tarStreamModule;

export interface ArchiveExtractLimits {
  /** Max number of entries (files + dirs) an archive may contain. */
  maxEntries: number;
  /** Max total decompressed bytes written across the whole archive. */
  maxUncompressedBytes: number;
  /** Max decompressed bytes for any single entry. */
  maxEntryBytes: number;
  /** Abort once decompressed:compressed exceeds this ratio (past the
   *  floor below): catches bombs well before the absolute byte cap. */
  maxCompressionRatio: number;
  /** Max byte length of an entry's path. */
  maxPathLength: number;
  /** Max number of `/`-separated segments in an entry's path. */
  maxPathSegments: number;
  /** Below this many decompressed bytes, skip the ratio check. A small
   *  legitimate file with a tiny compressed size (e.g. a few KB of gzip
   *  framing overhead around a few bytes of payload) can transiently look
   *  like a huge ratio without being any kind of threat. Configurable so
   *  tests can exercise the ratio trip wire without needing an
   *  eight-megabyte fixture. */
  ratioCheckFloorBytes: number;
}

/** Generous for real projects (source trees, not datasets), a hard wall
 *  against a hostile or runaway upload. */
export const DEFAULT_ARCHIVE_LIMITS: ArchiveExtractLimits = {
  maxEntries: 20_000,
  maxUncompressedBytes: 2 * 1024 ** 3, // 2 GiB
  maxEntryBytes: 512 * 1024 ** 2, // 512 MiB
  maxCompressionRatio: 300,
  maxPathLength: 4096,
  maxPathSegments: 64,
  ratioCheckFloorBytes: 8 * 1024 * 1024,
};

const ALLOWED_TYPES = new Set(["file", "directory", "contiguous-file"]);
/** Types that carry no body and are safe to skip once acknowledged.
 *  Tar-stream folds pax/gnu-longname records into the following header
 *  itself, so these should not normally surface as their own entries,
 *  but skip them defensively rather than fail a legitimate archive. */
const BENIGN_METADATA_TYPES = new Set(["pax-header", "pax-global-header"]);

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)}GiB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)}MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)}KiB`;
  return `${n}B`;
}

/**
 * Validate one entry's path and return its resolved on-disk destination.
 * Throws (fail closed) on absolute paths, traversal, oversized/overdeep
 * paths, and Unicode/case collisions against a prior entry in the same
 * archive. `seen` is mutated to record the accepted entry.
 */
export function resolveEntryPath(
  rawName: string,
  root: string,
  limits: ArchiveExtractLimits,
  seen: Map<string, string>,
): string {
  if (!rawName || rawName.length === 0) {
    throw new Error("archive contains an entry with an empty name");
  }
  if (rawName.includes("\0")) {
    throw new Error(`archive entry name contains a NUL byte: ${JSON.stringify(rawName)}`);
  }
  if (rawName.length > limits.maxPathLength) {
    throw new Error(
      `archive entry path exceeds ${limits.maxPathLength} characters: ${rawName.slice(0, 80)}…`,
    );
  }

  // Archives here are only ever produced by `tar` on macOS/Linux (see
  // cli/src/lib/tar-source.ts), so a literal backslash is never a
  // legitimate separator, but reject it as one anyway so a crafted
  // archive can't smuggle a traversal past the forward-slash check below.
  const normalized = rawName.replace(/\\/g, "/");
  if (path.posix.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`archive entry has an absolute path: ${rawName}`);
  }

  const segments = normalized.split("/").filter((s) => s.length > 0);
  if (segments.length > limits.maxPathSegments) {
    throw new Error(
      `archive entry is nested deeper than ${limits.maxPathSegments} path segments: ${rawName}`,
    );
  }
  if (segments.some((s) => s === "..")) {
    throw new Error(`archive entry attempts path traversal (".."): ${rawName}`);
  }

  const resolved = segments.length === 0 ? root : path.resolve(root, ...segments);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`archive entry resolves outside the extraction root: ${rawName}`);
  }

  // Unicode-normalization / case-folding collision guard. macOS's default
  // volume format (APFS/HFS+) is case-insensitive and treats differently
  // normalized (NFC vs NFD) but visually identical names as the same
  // file: two archive entries that collide under that folding would
  // have the second silently clobber (or shadow) the first on extract.
  // Fail closed instead of guessing which entry the attacker intended to
  // win.
  const canonicalKey = segments.join("/").normalize("NFC").toLowerCase();
  const prior = seen.get(canonicalKey);
  if (prior !== undefined) {
    throw new Error(
      prior === normalized
        ? `archive contains a duplicate entry: ${rawName}`
        : `archive has colliding entries that normalize to the same path on a case-insensitive filesystem: "${prior}" vs "${rawName}"`,
    );
  }
  seen.set(canonicalKey, normalized);

  return resolved;
}

/**
 * Why an entry's *type* disqualifies it, or null when the type is permitted.
 * Split out of the extraction loop so the rejection rules read as one list
 * rather than a stack of branches: the loop stays about streaming.
 */
function entryTypeViolation(
  name: string,
  type: string,
  linkname: string | null | undefined,
): string | null {
  if (type === "symlink")
    return `entry "${name}" is a symlink (→ "${linkname}"): symlinks are not permitted in uploaded source archives`;
  if (type === "link")
    return `entry "${name}" is a hard link (→ "${linkname}"): hard links are not permitted in uploaded source archives`;
  if (type === "character-device" || type === "block-device" || type === "fifo")
    return `entry "${name}" is a device/special file (${type}): not permitted in uploaded source archives`;
  if (!ALLOWED_TYPES.has(type)) return `entry "${name}" has unsupported type "${type}"`;
  return null;
}

/**
 * Why the bytes seen so far bust a limit, or null while still within them.
 * Evaluated per chunk, so it stays allocation-free on the happy path.
 */
function byteLimitViolation(args: {
  name: string;
  entryBytes: number;
  decompressedBytes: number;
  limits: ArchiveExtractLimits;
  ratioDenominator: number;
}): string | null {
  const { name, entryBytes, decompressedBytes, limits, ratioDenominator } = args;

  if (entryBytes > limits.maxEntryBytes)
    return `entry "${name}" exceeds the per-file ${fmtBytes(limits.maxEntryBytes)} limit`;
  if (decompressedBytes > limits.maxUncompressedBytes)
    return `archive exceeds the ${fmtBytes(limits.maxUncompressedBytes)} total uncompressed size limit`;
  if (
    decompressedBytes > limits.ratioCheckFloorBytes &&
    decompressedBytes > ratioDenominator * limits.maxCompressionRatio
  )
    return `archive compression ratio exceeds ${limits.maxCompressionRatio}:1, rejected as a likely decompression bomb`;
  return null;
}

/**
 * Stream one regular file entry to disk, enforcing the byte limits as it
 * goes, and return how many bytes it contributed. Opened "wx": fail if the
 * path already exists rather than silently overwrite. Belt-and-suspenders
 * alongside the duplicate-entry check, and it means we never write through
 * anything we didn't just create ourselves in this same extraction.
 */
async function writeEntryToDisk(args: {
  entry: AsyncIterable<Buffer>;
  destPath: string;
  name: string;
  limits: ArchiveExtractLimits;
  ratioDenominator: number;
  /** Running archive total *before* this entry, for the aggregate limits. */
  decompressedBefore: number;
}): Promise<number> {
  const fh = await open(args.destPath, "wx", 0o644);
  try {
    let entryBytes = 0;
    for await (const chunk of args.entry) {
      entryBytes += chunk.length;

      const overLimit = byteLimitViolation({
        name: args.name,
        entryBytes,
        decompressedBytes: args.decompressedBefore + entryBytes,
        limits: args.limits,
        ratioDenominator: args.ratioDenominator,
      });
      if (overLimit) throw new Error(overLimit);

      await fh.write(chunk);
    }
    return entryBytes;
  } finally {
    await fh.close();
  }
}

/**
 * Extract a `.tar.gz` archive into `destDir`, rejecting the whole archive
 * (no partial extraction left behind for the caller to trip over) the
 * moment any entry violates a safety rule. `destDir` must already exist
 * and be empty (the builder always hands us a freshly created work dir).
 */
export async function extractArchiveSafely(opts: {
  archivePath: string;
  destDir: string;
  sink?: LogSink;
  limits?: Partial<ArchiveExtractLimits>;
}): Promise<void> {
  const limits: ArchiveExtractLimits = { ...DEFAULT_ARCHIVE_LIMITS, ...opts.limits };
  const root = path.resolve(opts.destDir);
  await mkdir(root, { recursive: true });

  const compressedSize = await fsStat(opts.archivePath)
    .then((s) => s.size)
    .catch(() => 0);
  const ratioDenominator = Math.max(compressedSize, 1);

  const source = createReadStream(opts.archivePath);
  const gunzip = createGunzip();
  const tarExtract = createTarExtractor();

  // Feeds compressed bytes in. Settles to an Error instead of rejecting:
  // rejecting a validation entry destroys the pipeline, which would reject
  // this with ERR_STREAM_PREMATURE_CLOSE and mask the real reason we
  // aborted. Genuine read/gunzip failures are re-thrown on the success
  // path below, where nothing else has gone wrong to explain them.
  const pipelineDone = pipeline(source, gunzip, tarExtract).then(
    () => null,
    (err: unknown): Error => (err instanceof Error ? err : new Error(String(err))),
  );

  let decompressedBytes = 0;
  let entryCount = 0;
  const seen = new Map<string, string>();

  const fail = (err: Error): never => {
    tarExtract.destroy(err);
    gunzip.destroy();
    source.destroy();
    throw err;
  };

  try {
    for await (const entry of tarExtract) {
      const header = entry.header;
      entryCount += 1;
      if (entryCount > limits.maxEntries) {
        entry.resume();
        fail(new Error(`archive has more than ${limits.maxEntries} entries`));
      }

      if (BENIGN_METADATA_TYPES.has(header.type ?? "")) {
        entry.resume();
        continue;
      }

      const typeViolation = entryTypeViolation(header.name, header.type ?? "", header.linkname);
      if (typeViolation) {
        entry.resume();
        fail(new Error(typeViolation));
      }

      const destPath = resolveEntryPath(header.name, root, limits, seen);

      if (header.type === "directory") {
        entry.resume();
        await mkdir(destPath, { recursive: true, mode: 0o755 });
        continue;
      }

      // "file" | "contiguous-file"
      if (typeof header.size === "number" && header.size > limits.maxEntryBytes) {
        entry.resume();
        fail(
          new Error(
            `entry "${header.name}" declares ${fmtBytes(header.size)}, exceeding the per-file ${fmtBytes(limits.maxEntryBytes)} limit`,
          ),
        );
      }

      await mkdir(path.dirname(destPath), { recursive: true, mode: 0o755 });
      decompressedBytes += await writeEntryToDisk({
        entry,
        destPath,
        name: header.name,
        limits,
        ratioDenominator,
        decompressedBefore: decompressedBytes,
      });
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    tarExtract.destroy(error);
    gunzip.destroy();
    source.destroy();
    throw error;
  }

  // Surfaces any error from the read/gunzip stages that didn't come
  // through the entry loop (e.g. a truncated or corrupt gzip stream).
  const pipelineError = await pipelineDone;
  if (pipelineError) throw pipelineError;

  opts.sink?.system(
    `extracted ${entryCount} ${entryCount === 1 ? "entry" : "entries"}, ${fmtBytes(decompressedBytes)}, within limits`,
  );
}
