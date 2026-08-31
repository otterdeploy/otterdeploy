/**
 * Listing and reading objects.
 *
 * ONE list procedure serves both the folder view and the flat view, because a
 * prefix IS a filter: navigating to `invoices/2026-08/` and filtering on
 * `prefix:invoices/2026-08/` produce the same S3 call, differing only in
 * whether `delimiter` is set. Modelling them separately would mean two code
 * paths that have to agree about what a listing means, and a selection that
 * cannot survive switching between them.
 *
 * Bun ships an S3 client, so this needs no AWS SDK: no new dependency, and the
 * same signing code Bun already uses for `Bun.s3`.
 */
import { Result } from "better-result";
import { S3Client } from "bun";

import type { StorageTarget } from "./target";

import { StorageError, resolveKey } from "./target";

/** S3 returns at most 1000 keys per call, and so do we. */
export const MAX_KEYS = 1000;

/** Presigned URLs are short-lived: long enough to click, short enough to leak badly. */
const PRESIGN_SECONDS = 15 * 60;

export interface StorageObject {
  /** Key relative to the target's root, so the client never sees the prefix. */
  key: string;
  size: number;
  /** ISO-8601. Converted to a Temporal instant at the UI boundary. */
  lastModified: string | null;
  storageClass: string;
  eTag: string | null;
}

export interface StorageListing {
  /** Sub-prefixes at this level, relative to the root. Empty in flat mode. */
  prefixes: string[];
  objects: StorageObject[];
  /** Pass back to continue. Null when the listing is complete. */
  continuationToken: string | null;
  /** True when S3 had more keys than this page. */
  truncated: boolean;
}

function clientFor(target: StorageTarget): S3Client {
  return new S3Client({
    bucket: target.bucket,
    accessKeyId: target.accessKeyId,
    secretAccessKey: target.secretAccessKey,
    ...(target.sessionToken === undefined ? {} : { sessionToken: target.sessionToken }),
    ...(target.region === undefined ? {} : { region: target.region }),
    ...(target.endpoint === undefined ? {} : { endpoint: target.endpoint }),
  });
}

/** Map a thrown S3 failure onto a tagged reason, keeping the provider's text. */
function toStorageError(cause: unknown): StorageError {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/access ?denied|forbidden|signature|credential/i.test(message)) {
    return new StorageError("denied", message);
  }
  if (/no ?such ?bucket|not ?found|404/i.test(message)) {
    return new StorageError("not_found", message);
  }
  if (/econnrefused|enotfound|timeout|network/i.test(message)) {
    return new StorageError("unreachable", message);
  }
  return new StorageError("request", message);
}

export interface ListInput {
  /** Prefix under the target's root, e.g. `invoices/2026-08/`. */
  prefix: string;
  /**
   * `folders` groups keys at the next `/` and returns them as prefixes.
   * `flat` walks the whole keyspace under `prefix`.
   *
   * The SAME state, rendered two ways — not two modes with separate queries.
   */
  grouping: "folders" | "flat";
  continuationToken: string | null;
  maxKeys: number;
}

export async function listObjects(
  target: StorageTarget,
  input: ListInput,
): Promise<Result<StorageListing, StorageError>> {
  const scoped = resolveKey(target, input.prefix);
  if (scoped.isErr()) return Result.err(scoped.error);

  const listed = await Result.tryPromise({
    try: () =>
      clientFor(target).list({
        prefix: scoped.value,
        maxKeys: Math.min(input.maxKeys, MAX_KEYS),
        ...(input.grouping === "folders" ? { delimiter: "/" } : {}),
        ...(input.continuationToken === null ? {} : { continuationToken: input.continuationToken }),
      }),
    catch: toStorageError,
  });
  if (listed.isErr()) return Result.err(listed.error);

  const response = listed.value;
  const strip = (key: string) => key.slice(target.root.length);

  return Result.ok({
    prefixes: (response.commonPrefixes ?? []).map((p) => strip(p.prefix)),
    objects: (response.contents ?? [])
      // A listing includes the prefix itself when a zero-byte "folder marker"
      // object exists. Showing it as a file next to the folder it represents is
      // confusing, so it is dropped.
      .filter((o) => o.key !== scoped.value)
      .map((o) => ({
        key: strip(o.key),
        size: o.size ?? 0,
        lastModified: o.lastModified ?? null,
        // S3 omits the class for STANDARD; reporting the default is honest and
        // keeps the column from being empty for most objects.
        storageClass: o.storageClass ?? "STANDARD",
        eTag: o.eTag ?? null,
      })),
    continuationToken: response.nextContinuationToken ?? null,
    truncated: response.isTruncated ?? false,
  });
}

export interface ObjectDetail extends StorageObject {
  contentType: string | null;
}

/** Metadata for one object, for the preview pane. */
export async function statObject(
  target: StorageTarget,
  key: string,
): Promise<Result<ObjectDetail, StorageError>> {
  const scoped = resolveKey(target, key);
  if (scoped.isErr()) return Result.err(scoped.error);

  const stat = await Result.tryPromise({
    try: async () => {
      const file = clientFor(target).file(scoped.value);
      return await file.stat();
    },
    catch: toStorageError,
  });
  if (stat.isErr()) return Result.err(stat.error);

  return Result.ok({
    key,
    size: stat.value.size,
    lastModified:
      stat.value.lastModified instanceof Date ? stat.value.lastModified.toISOString() : null,
    storageClass: "STANDARD",
    eTag: stat.value.etag ?? null,
    contentType: stat.value.type ?? null,
  });
}

/**
 * A short-lived presigned URL.
 *
 * This is how the browser reads or writes an object WITHOUT the control plane
 * proxying the bytes and without ever holding a credential. `method` decides
 * which: `GET` to download or preview, `PUT` to upload.
 */
export function presignObject(
  target: StorageTarget,
  key: string,
  method: "GET" | "PUT",
): Result<{ url: string; expiresInSeconds: number }, StorageError> {
  const scoped = resolveKey(target, key);
  if (scoped.isErr()) return Result.err(scoped.error);

  return Result.try({
    try: () => ({
      url: clientFor(target).presign(scoped.value, {
        method,
        expiresIn: PRESIGN_SECONDS,
      }),
      expiresInSeconds: PRESIGN_SECONDS,
    }),
    catch: toStorageError,
  });
}

/** Delete objects. Returns how many keys were accepted. */
export async function deleteObjects(
  target: StorageTarget,
  keys: readonly string[],
): Promise<Result<{ deleted: number }, StorageError>> {
  const scoped: string[] = [];
  for (const key of keys) {
    const resolved = resolveKey(target, key);
    if (resolved.isErr()) return Result.err(resolved.error);
    scoped.push(resolved.value);
  }

  const client = clientFor(target);
  // S3 has a batch delete, but Bun's client exposes per-object unlink. Failing
  // the whole call on the first error would leave an unknowable partial state,
  // so each is attempted and the count is reported honestly.
  const outcomes = await Promise.all(
    scoped.map((key) =>
      Result.tryPromise({ try: () => client.delete(key), catch: toStorageError }),
    ),
  );
  const failed = outcomes.find((o) => o.isErr());
  const deleted = outcomes.filter((o) => o.isOk()).length;
  if (failed?.isErr() && deleted === 0) return Result.err(failed.error);
  return Result.ok({ deleted });
}
