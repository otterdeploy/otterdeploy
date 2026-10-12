/** Protocol and schema versions, and their negotiation (mirror of `version.rs`). */
import { Result } from "better-result";
import { z } from "zod";

import { u16 } from "./primitives";

export const PROTOCOL_VERSION = 1;
export const MIN_PROTOCOL_VERSION = 1;
export const JOURNAL_FORMAT = 1;
export const SERVICE_SPEC_SCHEMA = 1;
export const EVALUATOR_REVISION = 1;
export const METRIC_SCHEMA = 1;

export const versionRange = z.strictObject({ min: u16, max: u16 });
export type VersionRange = z.infer<typeof versionRange>;

export const CURRENT_RANGE: VersionRange = { min: MIN_PROTOCOL_VERSION, max: PROTOCOL_VERSION };

export const FEATURES = [
  "bulk",
  "realtime-metrics",
  "probe-executor",
  "discovery-relay",
  "platform-bootstrap",
] as const;
export const feature = z.enum(FEATURES);
export type Feature = z.infer<typeof feature>;

export type NegotiationError = "malformed" | "node-too-old" | "control-plane-too-old";

const isValid = (r: VersionRange) => r.min >= 1 && r.min <= r.max;

/** Highest version both ranges contain; names the side that must upgrade otherwise. */
export function negotiate(node: VersionRange, cp: VersionRange): Result<number, NegotiationError> {
  if (!isValid(node) || !isValid(cp)) return Result.err("malformed");
  const high = Math.min(node.max, cp.max);
  const low = Math.max(node.min, cp.min);
  if (low <= high) return Result.ok(high);
  return Result.err(node.max < cp.min ? "node-too-old" : "control-plane-too-old");
}

/** Features both sides listed, in declaration order. */
export function commonFeatures(a: readonly Feature[], b: readonly Feature[]): Feature[] {
  return FEATURES.filter((f) => a.includes(f) && b.includes(f));
}
