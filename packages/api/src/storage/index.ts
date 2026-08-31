/**
 * Object-storage runtime: listing, reading and presigning S3-compatible buckets.
 *
 * Pairs with `routers/storage`. Credentials are resolved and used HERE; the
 * browser only ever receives listings and short-lived presigned URLs.
 */
export {
  deleteObjects,
  listObjects,
  MAX_KEYS,
  presignObject,
  statObject,
  type ListInput,
  type ObjectDetail,
  type StorageListing,
  type StorageObject,
} from "./objects";
export {
  SCAN_KEY_LIMIT,
  scanStorageStats,
  type ClassStat,
  type ExtensionStat,
  type PrefixStat,
  type StorageStats,
} from "./stats";
export { resolveKey, resolveStorageTarget, StorageError, type StorageTarget } from "./target";
