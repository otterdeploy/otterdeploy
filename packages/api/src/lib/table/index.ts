/**
 * Server-side data table: filters compiled to SQL, facets, cursor pagination
 * and the time histogram, all driven by the same declaration the client
 * filters with (`@otterdeploy/shared/table-filters`).
 */

export { computeFacets, type Facet, type Facets } from "./facets";
export {
  createFeedHandler,
  type ExtraSelect,
  type FeedConfig,
  type FeedMeta,
  type FeedRequest,
  type FeedSort,
} from "./feed";
export {
  bucketMsFor,
  computeHistogram,
  discoverRange,
  type HistogramBucket,
  type TimeRange,
} from "./histogram";
export { overfetch, planCursor, snapPage, type FeedDirection } from "./pagination";
export { allOf, buildWhere, isArrayColumn, sqlTypeOf, toSql, type ColumnMap } from "./sql";
export type { FeedDatabase } from "./types";
