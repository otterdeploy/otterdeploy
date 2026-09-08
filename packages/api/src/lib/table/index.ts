/**
 * Server-side data table: filters compiled to SQL, facets, cursor pagination
 * and the time histogram, all driven by the same declaration the client
 * filters with (`@otterdeploy/shared/table-filters`).
 *
 * The barrel carries what a LIST ENDPOINT needs and nothing else. The pieces
 * behind it — the SQL compiler, the cursor planner, the facet queries — are
 * imported from their own modules by the handler that assembles them, and
 * re-exporting them here only made a second name for each with nothing on the
 * other end of it.
 */

export { createFeedHandler } from "./feed";
export { computeHistogram, discoverRange } from "./histogram";
export type { ColumnMap } from "./sql";
