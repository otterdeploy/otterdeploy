/** Row shapes the storage views render. Mirrors the `storage.*` contract. */
export interface StorageObjectRow {
  /** Key relative to the destination's configured prefix. */
  key: string;
  size: number;
  /** ISO-8601 off the wire; formatted through `@/shared/lib/clock`. */
  lastModified: string | null;
  storageClass: string;
  eTag: string | null;
}
