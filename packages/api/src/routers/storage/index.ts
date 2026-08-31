/**
 * `storage.*` handlers.
 *
 * Every one resolves the destination first, which is where the credential is
 * decrypted and where the destination's configured prefix becomes the ceiling
 * on what any key may address. The client sends keys RELATIVE to that prefix
 * and never learns what it is.
 *
 * Permissions ride the backup scopes rather than inventing new ones: a bucket
 * IS a backup destination, and someone who may read the destination may read
 * what is in it.
 */
import type { BackupDestinationId, OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { backupDestination } from "@otterdeploy/db/schema";
import { and, eq } from "drizzle-orm";
import * as z from "zod";

import type { StorageError, StorageTarget } from "../../storage";

import { requirePermission } from "../..";
import {
  deleteObjects,
  listObjects,
  normalizeStorageRoot,
  presignObject,
  resolveStorageTarget,
  scanStorageStats,
  statObject,
} from "../../storage";

interface StorageErrorConstructors {
  NOT_FOUND: () => Error;
  UNSUPPORTED: (init: { data: { reason: string } }) => Error;
  UNREACHABLE: (init: { data: { reason: string } }) => Error;
  DENIED: (init: { data: { reason: string } }) => Error;
  REQUEST_FAILED: (init: { data: { reason: string } }) => Error;
}

/** Map a runtime failure onto the contract's error set, keeping S3's own text. */
function raise(error: StorageError, errors: StorageErrorConstructors): Error {
  const reason = error.message;
  switch (error.reason) {
    case "not_found":
      return errors.NOT_FOUND();
    case "unsupported":
      return errors.UNSUPPORTED({ data: { reason } });
    case "unreachable":
      return errors.UNREACHABLE({ data: { reason } });
    case "denied":
      return errors.DENIED({ data: { reason } });
    case "request":
      return errors.REQUEST_FAILED({ data: { reason } });
  }
}

/** Resolve a destination or throw the mapped contract error. */
async function open(
  organizationId: OrganizationId,
  destinationId: BackupDestinationId,
  errors: StorageErrorConstructors,
): Promise<StorageTarget> {
  const target = await resolveStorageTarget({ organizationId, destinationId });
  if (target.isErr()) throw raise(target.error, errors);
  return target.value;
}

/** Non-secret config shape, for the bucket list. */
const configSchema = z.object({
  bucket: z.string().default(""),
  region: z.string().nullish(),
  endpoint: z.string().nullish(),
  prefix: z.string().nullish(),
});

export const storageRouter = {
  listBuckets: requirePermission({ backup: ["read"] }).storage.listBuckets.handler(
    async ({ context }) => {
      const rows = await db
        .select({
          id: backupDestination.id,
          name: backupDestination.name,
          config: backupDestination.config,
          status: backupDestination.status,
        })
        .from(backupDestination)
        .where(
          and(
            eq(backupDestination.organizationId, context.activeOrganizationId),
            // Only S3 has an object API. `local` and `sftp` are real backup
            // destinations with nothing to browse, so they are omitted rather
            // than listed and then failing when opened.
            eq(backupDestination.type, "s3"),
          ),
        );

      return {
        buckets: rows.flatMap((row) => {
          const config = configSchema.safeParse(row.config);
          if (!config.success || config.data.bucket === "") return [];
          return [
            {
              id: row.id,
              name: row.name,
              bucket: config.data.bucket,
              region: config.data.region ?? null,
              endpoint: config.data.endpoint ?? null,
              root: normalizeStorageRoot(config.data.prefix ?? undefined),
              status: row.status,
            },
          ];
        }),
      };
    },
  ),

  list: requirePermission({ backup: ["read"] }).storage.list.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        storage: { bucketId: input.bucketId, prefix: input.prefix, grouping: input.grouping },
      });
      const target = await open(context.activeOrganizationId, input.bucketId, errors);
      const listing = await listObjects(target, {
        prefix: input.prefix,
        grouping: input.grouping,
        continuationToken: input.continuationToken,
        maxKeys: input.maxKeys,
      });
      if (listing.isErr()) throw raise(listing.error, errors);
      return listing.value;
    },
  ),

  stats: requirePermission({ backup: ["read"] }).storage.stats.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        storage: { bucketId: input.bucketId, prefix: input.prefix, stats: true },
      });
      const target = await open(context.activeOrganizationId, input.bucketId, errors);
      const stats = await scanStorageStats(target, { prefix: input.prefix, q: input.q });
      if (stats.isErr()) throw raise(stats.error, errors);
      return stats.value;
    },
  ),

  stat: requirePermission({ backup: ["read"] }).storage.stat.handler(
    async ({ input, context, errors }) => {
      const target = await open(context.activeOrganizationId, input.bucketId, errors);
      const detail = await statObject(target, input.key);
      if (detail.isErr()) throw raise(detail.error, errors);
      return detail.value;
    },
  ),

  presign: requirePermission({ backup: ["read"] }).storage.presign.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        storage: { bucketId: input.bucketId, key: input.key, presign: input.method },
      });
      const target = await open(context.activeOrganizationId, input.bucketId, errors);
      const url = presignObject(target, input.key, input.method);
      if (url.isErr()) throw raise(url.error, errors);
      return url.value;
    },
  ),

  remove: requirePermission({ backup: ["delete"] }).storage.remove.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        // Which keys, because a delete is the thing an auditor most needs to
        // reconstruct. Capped so a 1000-key bulk delete cannot flood the row.
        storage: {
          bucketId: input.bucketId,
          deleted: input.keys.length,
          keys: input.keys.slice(0, 50),
        },
      });
      const target = await open(context.activeOrganizationId, input.bucketId, errors);
      const outcome = await deleteObjects(target, input.keys);
      if (outcome.isErr()) throw raise(outcome.error, errors);
      return outcome.value;
    },
  ),
};
