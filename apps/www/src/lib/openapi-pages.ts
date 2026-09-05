/** One discoverable page per operation; the oRPC document has too few tags to
 * use tag grouping without silently dropping untagged procedures. */
export const OPENAPI_PAGE_OPTIONS = {
  baseDir: "openapi",
  per: "operation",
  groupBy: "route",
} as const;
