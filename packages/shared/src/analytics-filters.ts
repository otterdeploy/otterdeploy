/**
 * The web-analytics filter vocabulary (docs/designs/web-analytics.md §6):
 * which dimensions a dashboard filter can name, which operators it can apply,
 * and which dimensions a breakdown can group by. One tuple each, shared by
 * the oRPC contract (zod enums), the SQL compiler and the dashboard's URL
 * codec, so the three can never drift apart.
 */

export const FILTER_DIMENSIONS = [
  "path",
  "entryPath",
  "exitPath",
  "host",
  "referrer",
  "channel",
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmTerm",
  "utmContent",
  "country",
  "device",
  "browser",
  "os",
  "language",
  "event",
  "screen",
] as const;

export type FilterDimension = (typeof FILTER_DIMENSIONS)[number];

export const FILTER_OPS = ["is", "isNot", "contains"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

/** Everything filterable is also breakdownable, plus `goal` (conversion
 *  definitions only). */
export const BREAKDOWN_DIMENSIONS = [...FILTER_DIMENSIONS, "goal"] as const;
export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];
