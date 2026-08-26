/**
 * Web-analytics ingest plane (docs/designs/web-analytics.md). The tracker /
 * query modules have their own entry points; this barrel is what the server
 * wires up: the collect pipeline, the batched writer and the site cache.
 */

export { handleCollect } from "./collect";
export type { CollectDeps, CollectInput, CollectStatus } from "./collect";
export { parseCollectBody, sanitizeProps } from "./collect-schema";
export {
  dropOldAnalyticsPartitions,
  ensureAnalyticsEventTable,
  ensureAnalyticsPartitions,
} from "./partition";
export { invalidateSiteCache, resolveSiteByKey } from "./site-cache";
export type { SiteContext } from "./site-cache";
export { collectStats } from "./stats";
export type { CollectStats } from "./stats";
export {
  analyticsIngestEnabled,
  enqueueEvent,
  noteEventDefinition,
  noteFirstEvent,
  startAnalyticsIngest,
  stopAnalyticsIngest,
} from "./writer";
