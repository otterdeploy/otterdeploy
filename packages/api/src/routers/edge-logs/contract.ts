/**
 * Edge access logs contract — live tail (event-iterator) + a range query
 * powering the volume histogram and per-host percentile footer. Org-scoped:
 * the server restricts to the caller's own domains; clients never pass hosts.
 */

import { eventIterator, oc } from "@orpc/contract";

import { zId } from "@otterdeploy/shared/id";

import * as z from "zod";

const tag = "edge-logs";

export const edgeLogLineSchema = z.object({
  id: z.string(),
  ts: z.string(),
  method: z.string(),
  host: z.string(),
  path: z.string(),
  status: z.number(),
  latencyMs: z.number(),
  clientIp: z.string(),
  country: z.string().nullable(),
  userAgent: z.string(),
  referer: z.string(),
  tlsVersion: z.string().nullable(),
  tlsCipher: z.string().nullable(),
  upstream: z.string().nullable(),
  cache: z.string().nullable(),
  reqBytes: z.number(),
  resBytes: z.number(),
  requestId: z.string().nullable(),
  headers: z.record(z.string(), z.string()),
});

const timeRange = z.enum(["5m", "1h", "6h", "24h", "7d"]);
const statusBucket = z.enum(["2xx", "3xx", "4xx", "5xx"]);

export const edgeLogQueryInput = z.object({
  /** Restrict to one project's domains; omitted ⇒ all the org's domains. */
  projectId: zId("project").optional(),
  range: timeRange.default("1h"),
  /** Multi-select method/status/host filters; empty/omitted ⇒ no filter. */
  methods: z.array(z.string()).optional(),
  statuses: z.array(statusBucket).optional(),
  hosts: z.array(z.string()).optional(),
  search: z.string().optional(),
  limit: z.number().int().positive().max(1000).optional(),
});

export const edgeLogTailInput = z.object({
  projectId: zId("project").optional(),
  host: z.string().optional(),
});

export const edgeHistogramBucketSchema = z.object({
  t: z.string(),
  c2xx: z.number(),
  c3xx: z.number(),
  c4xx: z.number(),
  c5xx: z.number(),
});

export const edgeHostStatSchema = z.object({
  host: z.string(),
  rps: z.number(),
  errorRate: z.number(),
  p50: z.number(),
  p95: z.number(),
  p99: z.number(),
});

export const edgeLogQueryResultSchema = z.object({
  rows: z.array(edgeLogLineSchema),
  histogram: z.array(edgeHistogramBucketSchema),
  hostStats: z.array(edgeHostStatSchema),
  total: z.number(),
});

export const edgeLogsContract = {
  query: oc
    .meta({ path: "/edge-logs", tag, method: "GET" })
    .input(edgeLogQueryInput)
    .output(edgeLogQueryResultSchema),

  tail: oc
    .meta({ path: "/edge-logs/tail", tag, method: "GET" })
    .input(edgeLogTailInput)
    .output(eventIterator(edgeLogLineSchema)),
};
