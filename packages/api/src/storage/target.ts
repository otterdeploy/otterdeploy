/**
 * Resolving "which bucket, reached with what credentials".
 *
 * Buckets are NOT a new thing to configure. An S3 backup destination already
 * carries everything a browser needs — bucket, region, endpoint, prefix, and an
 * encrypted access key — so connecting one is the same act as connecting the
 * other, and asking an operator to enter the same credentials twice would be
 * asking them to keep two copies of a secret in sync.
 *
 * The credentials are decrypted HERE, in the control plane, and never leave it.
 * The browser receives listings and presigned URLs, never a key.
 */
import type { BackupDestinationId, OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { backupDestination } from "@otterdeploy/db/schema";
import { Result, TaggedError } from "better-result";
import { and, eq } from "drizzle-orm";
import * as z from "zod";

import { decryptSecret } from "../lib/crypto";

export class StorageError extends TaggedError("StorageError")<{
  reason: "not_found" | "unreachable" | "denied" | "unsupported" | "request";
  message: string;
}>() {}

type StorageErrorReason = StorageError["reason"];

export function storageError(reason: StorageErrorReason, message: string): StorageError {
  return new StorageError({ reason, message });
}

/** The non-secret half of an S3 destination's config. */
const s3ConfigSchema = z.object({
  bucket: z.string().min(1),
  region: z.string().optional(),
  endpoint: z.string().optional(),
  /**
   * A key prefix the destination is scoped to.
   *
   * Load-bearing, not cosmetic: a destination pointed at `backups/` must not
   * let the browser walk up into the rest of the bucket, so every listing is
   * rooted here and every key the client sends is checked against it.
   */
  prefix: z.string().optional(),
});

const s3SecretSchema = z.object({
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  sessionToken: z.string().optional(),
});

export interface StorageTarget {
  destinationId: string;
  name: string;
  bucket: string;
  region: string | undefined;
  endpoint: string | undefined;
  /** Every key this target may touch starts with this. "" means the whole bucket. */
  root: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string | undefined;
}

/** Normalise a prefix to "" or "some/path/". */
export function normalizeStorageRoot(prefix: string | undefined): string {
  if (!prefix) return "";
  const trimmed = prefix.replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed === "" ? "" : `${trimmed}/`;
}

/**
 * Resolve an S3-backed destination into a browsable target.
 *
 * Only `type: "s3"` resolves. `local` and `sftp` destinations are real backup
 * targets but have no object API, and reporting that plainly is better than
 * showing an empty bucket.
 */
export async function resolveStorageTarget(input: {
  organizationId: OrganizationId;
  destinationId: BackupDestinationId;
}): Promise<Result<StorageTarget, StorageError>> {
  const [row] = await db
    .select({
      id: backupDestination.id,
      name: backupDestination.name,
      type: backupDestination.type,
      config: backupDestination.config,
      encryptedSecret: backupDestination.encryptedSecret,
    })
    .from(backupDestination)
    .where(
      and(
        eq(backupDestination.id, input.destinationId),
        eq(backupDestination.organizationId, input.organizationId),
      ),
    )
    .limit(1);

  if (!row) {
    return Result.err(storageError("not_found", "bucket not found"));
  }
  if (row.type !== "s3") {
    return Result.err(
      storageError(
        "unsupported",
        `${row.type} destinations have no object API to browse; only S3-compatible ones do`,
      ),
    );
  }

  const config = s3ConfigSchema.safeParse(row.config);
  if (!config.success) {
    return Result.err(
      storageError("not_found", "this destination is missing its bucket configuration"),
    );
  }
  if (!row.encryptedSecret) {
    return Result.err(storageError("denied", "this destination has no stored credentials"));
  }

  const decrypted = await Result.tryPromise({
    try: async () => {
      const json = await decryptSecret(row.encryptedSecret ?? "");
      const parsed: unknown = JSON.parse(json);
      return s3SecretSchema.parse(parsed);
    },
    catch: () => storageError("denied", "could not read this destination's credentials"),
  });
  if (decrypted.isErr()) return Result.err(decrypted.error);

  return Result.ok({
    destinationId: row.id,
    name: row.name,
    bucket: config.data.bucket,
    region: config.data.region,
    endpoint: config.data.endpoint,
    root: normalizeStorageRoot(config.data.prefix),
    accessKeyId: decrypted.value.accessKeyId,
    secretAccessKey: decrypted.value.secretAccessKey,
    sessionToken: decrypted.value.sessionToken,
  });
}

/**
 * Resolve a client-supplied key against the target's root.
 *
 * The check that stops a destination scoped to `backups/` from being used to
 * read the rest of the bucket. `..` is rejected outright rather than
 * normalised, because an S3 key may legitimately contain a literal `..`
 * segment and silently rewriting it would read a different object than the one
 * the caller named.
 */
export function resolveKey(target: StorageTarget, key: string): Result<string, StorageError> {
  const clean = key.replace(/^\/+/, "");
  if (clean.split("/").includes("..")) {
    return Result.err(storageError("denied", "key may not contain a '..' segment"));
  }
  const full = `${target.root}${clean}`;
  return Result.ok(full);
}
