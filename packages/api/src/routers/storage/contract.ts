/**
 * `storage.*`: browsing S3-compatible buckets.
 *
 * ONE list procedure, not two. A prefix is a filter — walking into
 * `invoices/2026-08/` and filtering on that prefix are the same S3 call,
 * differing only in whether the delimiter is set. So `grouping` is a rendering
 * choice over one result set rather than a second endpoint, which is what lets
 * a selection survive switching between the folder and flat views.
 *
 * Credentials never reach the client. It gets listings and short-lived
 * presigned URLs; the control plane holds the key.
 */
import { oc } from "@orpc/contract";
import { ID_PREFIX, zId } from "@otterdeploy/shared/id";
import * as z from "zod";

const tag = "storage";
const basePath = "/storage";

const bucketIdField = zId(ID_PREFIX.backupDestination);

const storageErrors = {
  NOT_FOUND: { status: 404 as const, message: "Bucket not found" as const },
  UNSUPPORTED: {
    status: 422 as const,
    message: "This destination has no object API to browse" as const,
    data: z.object({ reason: z.string() }),
  },
  UNREACHABLE: {
    status: 503 as const,
    message: "Could not reach the bucket" as const,
    data: z.object({ reason: z.string() }),
  },
  DENIED: {
    status: 403 as const,
    message: "The bucket refused the request" as const,
    data: z.object({ reason: z.string() }),
  },
  REQUEST_FAILED: {
    status: 422 as const,
    message: "The storage request failed" as const,
    data: z.object({ reason: z.string() }),
  },
};

const objectSchema = z.object({
  /** Key RELATIVE to the destination's configured prefix. */
  key: z.string(),
  size: z.number().int(),
  /** ISO-8601; converted to a Temporal instant at the UI boundary. */
  lastModified: z.string().nullable(),
  storageClass: z.string(),
  eTag: z.string().nullable(),
});

export const storageContract = {
  /** Every S3-compatible destination this org can browse. */
  listBuckets: oc
    .route({ method: "GET", path: `${basePath}/buckets`, tags: [tag] })
    .input(z.object({}))
    .output(
      z.object({
        buckets: z.array(
          z.object({
            id: bucketIdField,
            name: z.string(),
            bucket: z.string(),
            region: z.string().nullable(),
            /** Set for MinIO / R2 / any non-AWS endpoint. */
            endpoint: z.string().nullable(),
            /** The prefix everything is scoped to; "" for the whole bucket. */
            root: z.string(),
          }),
        ),
      }),
    )
    .errors(storageErrors),

  /**
   * One page of a listing.
   *
   * `grouping: "folders"` sets the S3 delimiter, so sibling keys roll up into
   * `prefixes`. `"flat"` drops it and walks the whole keyspace under `prefix`.
   * Same call, same state, two renderings.
   */
  list: oc
    .route({ method: "POST", path: `${basePath}/list`, tags: [tag] })
    .input(
      z.object({
        bucketId: bucketIdField,
        prefix: z.string().max(1024).default(""),
        grouping: z.enum(["folders", "flat"]).default("folders"),
        /** Opaque S3 token. Null starts a fresh listing. */
        continuationToken: z.string().max(4096).nullable().default(null),
        maxKeys: z.number().int().positive().max(1000).default(200),
      }),
    )
    .output(
      z.object({
        prefixes: z.array(z.string()),
        objects: z.array(objectSchema),
        continuationToken: z.string().nullable(),
        truncated: z.boolean(),
      }),
    )
    .errors(storageErrors),

  /** Metadata for one object, for the preview pane. */
  stat: oc
    .route({ method: "GET", path: `${basePath}/stat`, tags: [tag] })
    .input(z.object({ bucketId: bucketIdField, key: z.string().min(1).max(1024) }))
    .output(objectSchema.extend({ contentType: z.string().nullable() }))
    .errors(storageErrors),

  /**
   * A short-lived presigned URL.
   *
   * How the browser reads or writes an object without the control plane
   * proxying the bytes and without ever holding a credential.
   */
  presign: oc
    .route({ method: "POST", path: `${basePath}/presign`, tags: [tag] })
    .input(
      z.object({
        bucketId: bucketIdField,
        key: z.string().min(1).max(1024),
        method: z.enum(["GET", "PUT"]).default("GET"),
      }),
    )
    .output(z.object({ url: z.string(), expiresInSeconds: z.number().int() }))
    .errors(storageErrors),

  /** Delete objects by key. */
  remove: oc
    .route({ method: "POST", path: `${basePath}/remove`, tags: [tag] })
    .input(
      z.object({
        bucketId: bucketIdField,
        keys: z.array(z.string().min(1).max(1024)).min(1).max(1000),
      }),
    )
    .output(z.object({ deleted: z.number().int() }))
    .errors(storageErrors),
};
