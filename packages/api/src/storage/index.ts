/**
 * Object-storage runtime: listing, reading and presigning S3-compatible buckets.
 *
 * Pairs with `routers/storage`. Credentials are resolved and used HERE; the
 * browser only ever receives listings and short-lived presigned URLs.
 */
export { deleteObjects, listObjects, presignObject, statObject } from "./objects";
export {
  normalizeStorageRoot,
  resolveStorageTarget,
  StorageError,
  type StorageTarget,
} from "./target";
