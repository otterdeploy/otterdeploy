/**
 * Resource metrics — public surface for the server bootstrap. The read API
 * lives in `routers/metrics`; this module owns the sampler.
 */
export { startMetricsSampler, sampleAllContainers } from "./sampler";
export { queryResourceMetrics } from "./query";
export type { MetricPoint } from "./query";
