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

import type { StorageError, StorageTarget } from "./target";

import { resolveKey, storageError } from "./target";

/** S3 returns at most 1000 keys per call, and so do we. */
const MAX_KEYS = 1000;
const DELETE_CONCURRENCY = 8;

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
    return storageError("denied", message);
  }
  if (/no ?such ?bucket|not ?found|404/i.test(message)) {
    return storageError("not_found", message);
  }
  if (/econnrefused|enotfound|timeout|network/i.test(message)) {
    return storageError("unreachable", message);
  }
  return storageError("request", message);
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
 * This is how the browser reads an object WITHOUT the control plane proxying
 * the bytes and without ever holding a credential.
 */
export function presignObject(
  target: StorageTarget,
  key: string,
  method: "GET" | "PUT" = "GET",
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

export interface DeleteObjectsResult {
  deleted: string[];
  failed: Array<{ key: string; reason: string }>;
}

/** Delete objects with bounded concurrency and an exact outcome per key. */
export async function deleteObjects(
  target: StorageTarget,
  keys: readonly string[],
): Promise<Result<DeleteObjectsResult, StorageError>> {
  const scoped: Array<{ key: string; fullKey: string }> = [];
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) {
      return Result.err(storageError("request", `object key "${key}" was provided more than once`));
    }
    seen.add(key);
    const resolved = resolveKey(target, key);
    if (resolved.isErr()) return Result.err(resolved.error);
    scoped.push({ key, fullKey: resolved.value });
  }

  const client = clientFor(target);
  const deleted: string[] = [];
  const failed: DeleteObjectsResult["failed"] = [];
  for (let offset = 0; offset < scoped.length; offset += DELETE_CONCURRENCY) {
    const batch = scoped.slice(offset, offset + DELETE_CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map(({ fullKey }) =>
        Result.tryPromise({ try: () => client.delete(fullKey), catch: toStorageError }),
      ),
    );
    outcomes.forEach((outcome, index) => {
      const key = batch[index]?.key;
      if (key === undefined) return;
      if (outcome.isOk()) deleted.push(key);
      else failed.push({ key, reason: outcome.error.message });
    });
  }
  return Result.ok({ deleted, failed });
}

/**
 * The ceiling on one recursive delete. A folder holding more keys than this
 * takes several calls, and the answer says so rather than reporting a
 * finished job — an operator who thinks a subtree is gone when it is not is
 * exactly the wrong thing to be wrong about.
 */
const DELETE_PREFIX_KEY_LIMIT = 10_000;

export interface DeletePrefixResult {
  deleted: number;
  failed: Array<{ key: string; reason: string }>;
  /** False when keys were left behind: budget spent, or something refused. */
  complete: boolean;
}

/**
 * Delete everything under a prefix, recursively.
 *
 * S3 has no folders and therefore no rmdir: emptying `invoices/2026-08/`
 * means listing its whole subtree flat and deleting the keys. This is the
 * one place that walk lives, so the UI never has to page a million keys into
 * the browser just to delete them.
 *
 * Each round re-lists FROM THE TOP rather than following a continuation
 * token: the keys from the previous round are gone, so the token would point
 * into a listing that no longer exists. Not truncated and nothing refused
 * means the subtree is empty; anything else stops and reports.
 */
export async function deletePrefix(
  target: StorageTarget,
  prefix: string,
): Promise<Result<DeletePrefixResult, StorageError>> {
  if (!prefix.endsWith("/")) {
    return Result.err(storageError("request", "a prefix delete needs a prefix ending in '/'"));
  }
  const scoped = resolveKey(target, prefix);
  if (scoped.isErr()) return Result.err(scoped.error);
  // Emptying a whole bucket is not something a folder row may ask for by
  // accident, and `root` is the ceiling the rest of this module enforces.
  if (scoped.value === target.root) {
    return Result.err(storageError("denied", "refusing to empty the bucket root"));
  }

  const client = clientFor(target);
  const failed: DeletePrefixResult["failed"] = [];
  let deleted = 0;

  while (deleted + failed.length < DELETE_PREFIX_KEY_LIMIT) {
    // No delimiter: one flat walk of the subtree, folder markers included.
    const listed = await Result.tryPromise({
      try: () => client.list({ prefix: scoped.value, maxKeys: MAX_KEYS }),
      catch: toStorageError,
    });
    if (listed.isErr()) return Result.err(listed.error);

    const contents = listed.value.contents ?? [];
    if (contents.length === 0) return Result.ok({ deleted, failed, complete: true });

    for (let offset = 0; offset < contents.length; offset += DELETE_CONCURRENCY) {
      const batch = contents.slice(offset, offset + DELETE_CONCURRENCY);
      const outcomes = await Promise.all(
        batch.map((object) =>
          Result.tryPromise({ try: () => client.delete(object.key), catch: toStorageError }),
        ),
      );
      outcomes.forEach((outcome, index) => {
        const fullKey = batch[index]?.key;
        if (fullKey === undefined) return;
        if (outcome.isOk()) deleted += 1;
        else failed.push({ key: fullKey.slice(target.root.length), reason: outcome.error.message });
      });
    }

    // Something under here refuses to go; another round would loop on it.
    if (failed.length > 0) return Result.ok({ deleted, failed, complete: false });
    if (!(listed.value.isTruncated ?? false)) {
      return Result.ok({ deleted, failed, complete: true });
    }
  }

  return Result.ok({ deleted, failed, complete: false });
}
