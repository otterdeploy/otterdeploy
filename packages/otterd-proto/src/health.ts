/** Health checks and probe results; mirror of `health.rs`. */
import * as z from "zod";

import { u32, u53, u8, u16, wireId } from "./primitives";

export const ROUND_OVERHEAD_MS = 4_000;

export const checkRole = z.enum(["readiness", "liveness", "uptime"]);
export const vantage = z.enum(["local-netns", "serving-path", "fleet", "hairpin", "outside"]);

const execCommand = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("argv"), argv: z.array(z.string()) }),
  z.strictObject({ kind: z.literal("shell"), script: z.string() }),
]);

/** Structured HTTP assertions; all must hold. */
export const httpAssertion = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("status-range"), min: u16, max: u16 }),
  z.strictObject({ kind: z.literal("header-contains"), name: z.string(), value: z.string() }),
  z.strictObject({ kind: z.literal("body-contains"), value: z.string() }),
  z.strictObject({ kind: z.literal("json-equals"), pointer: z.string(), value: z.json() }),
]);

/** What a DNS check expects from the resolver under test. */
export const dnsExpect = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("answer"), contains: z.string().optional() }),
  z.strictObject({ kind: z.literal("nxdomain") }),
  z.strictObject({ kind: z.literal("servfail") }),
]);

export const probe = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("exec"),
    command: execCommand,
    user: z.string().optional(),
    workdir: z.string().optional(),
    envRefs: z.array(z.string()).optional(),
  }),
  z.strictObject({ kind: z.literal("tcp"), host: z.string(), port: u16 }),
  z.strictObject({
    kind: z.literal("http"),
    url: z.string(),
    method: z.string(),
    headerRefs: z.array(z.string()).optional(),
    bodyRef: z.string().optional(),
    assertions: z.array(httpAssertion).optional(),
    followRedirects: z.boolean(),
    maxRedirects: u8,
    tlsVerify: z.boolean(),
    caBundleRef: z.string().optional(),
  }),
  z.strictObject({
    kind: z.literal("grpc"),
    host: z.string(),
    port: u16,
    service: z.string().optional(),
    tls: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("dns"),
    name: z.string(),
    recordType: z.string(),
    server: z.string().optional(),
    expect: dnsExpect,
  }),
  z.strictObject({
    kind: z.literal("tls"),
    host: z.string(),
    port: u16,
    serverName: z.string().optional(),
    tlsVerify: z.boolean(),
    caBundleRef: z.string().optional(),
    minDaysValid: u32,
  }),
  z.strictObject({ kind: z.literal("icmp"), host: z.string() }),
]);

/** A versioned check definition, pushed to executors with `health.configure`. */
export const healthCheck = z.strictObject({
  installId: wireId,
  orgId: wireId,
  id: wireId,
  revision: u53,
  subjectId: wireId,
  resourceId: wireId.optional(),
  generation: u53.optional(),
  attemptId: wireId.optional(),
  role: checkRole,
  vantage,
  probe,
  intervalMs: u53,
  attemptTimeoutMs: u53,
  retries: u32,
  retryBackoffMs: u53,
  roundBudgetMs: u53,
  startPeriodMs: u53,
  failureThreshold: u32,
  successThreshold: u32,
  readyHoldMs: u53,
  degradedAfterMs: u53,
  healthAction: z.enum(["none", "restart"]),
  outcomePolicyRevision: u53,
});
export type HealthCheck = z.infer<typeof healthCheck>;

export type CheckIssue =
  | "RESTART_REQUIRES_LIVENESS"
  | "ROUND_BUDGET_TOO_SHORT"
  | "ROUND_BUDGET_NOT_BELOW_INTERVAL"
  | "UPTIME_INTERVAL_OUT_OF_RANGE"
  | "THRESHOLD_ZERO";

/** `a*t + (a−1)*b + o`. */
export function minimumRoundBudgetMs(check: HealthCheck): number {
  const attempts = check.retries + 1;
  return (
    attempts * check.attemptTimeoutMs + (attempts - 1) * check.retryBackoffMs + ROUND_OVERHEAD_MS
  );
}

/** Same checks, same order as `HealthCheck::validate`. */
export function checkIssue(check: HealthCheck): CheckIssue | null {
  if (check.healthAction === "restart" && check.role !== "liveness") {
    return "RESTART_REQUIRES_LIVENESS";
  }
  if (check.failureThreshold === 0 || check.successThreshold === 0) return "THRESHOLD_ZERO";
  if (check.roundBudgetMs < minimumRoundBudgetMs(check)) return "ROUND_BUDGET_TOO_SHORT";
  if (check.roundBudgetMs >= check.intervalMs) return "ROUND_BUDGET_NOT_BELOW_INTERVAL";
  if (check.role === "uptime" && (check.intervalMs < 30_000 || check.intervalMs > 3_600_000)) {
    return "UPTIME_INTERVAL_OUT_OF_RANGE";
  }
  return null;
}

export const OUTCOMES = ["success", "target-failure", "unknown", "configuration-error"] as const;
export const outcome = z.enum(OUTCOMES);
export type Outcome = z.infer<typeof outcome>;

export const CAUSES = [
  "ok",
  "target_timeout",
  "connection_refused",
  "target_unreachable",
  "assertion_failed",
  "tls_invalid",
  "cert_expiring",
  "target_dns_failure",
  "check_exit",
  "check_timeout",
  "probe_capacity",
  "executor_failure",
  "local_resolver_failure",
  "permission_missing",
  "unsupported_configuration",
  "missing_shell",
  "vantage_missing",
  "connection_reset",
  "protocol_error",
  "dns_servfail",
  "dns_nxdomain",
  "round_budget_exceeded",
  "executor_overloaded",
  "ca_material_missing",
  "invalid_target",
] as const;
export const cause = z.enum(CAUSES);

const phase = z.enum([
  "schedule",
  "resolve",
  "connect",
  "tls",
  "request",
  "response",
  "assert",
  "exec",
]);

export const observationIdentity = z.object({
  installId: wireId,
  orgId: wireId,
  checkId: wireId,
  checkRevision: u53,
  subjectId: wireId,
  generation: u53.optional(),
  attemptId: wireId.optional(),
  vantage,
  observerNodeId: wireId,
  nodeEpoch: u53,
  bootId: wireId,
  sampleSeq: u53,
});

const attemptResult = z.object({
  outcome,
  cause,
  phase,
  elapsedMs: u53,
  latencyUs: u53.optional(),
});
type AttemptResult = z.infer<typeof attemptResult>;

export const probeResult = z.object({
  identity: observationIdentity,
  scheduledRound: u53,
  attempts: z.array(attemptResult),
  finalOutcome: outcome,
  cause,
  failureDomain: z.enum(["target", "executor", "configuration"]),
  phase,
  outcomePolicyRevision: u53,
  qualification: z.discriminatedUnion("state", [
    z.object({ state: z.literal("qualified") }),
    z.object({ state: z.literal("unqualified"), cause }),
  ]),
  observedAtUnixMs: u53,
  elapsedMonotonicMs: u53,
  clockUncertaintyMs: u53,
  ttlMs: u53,
  latency: z
    .object({
      resolveUs: u53.optional(),
      connectUs: u53.optional(),
      tlsUs: u53.optional(),
      firstByteUs: u53.optional(),
      totalUs: u53.optional(),
    })
    .default({}),
  certificateExpiryUnixMs: u53.optional(),
});
export type ProbeResult = z.infer<typeof probeResult>;

/**
 * One round, one vote; mirror of `round_outcome`. `configured`
 * is `retries + 1`: a round that ran fewer attempts without a success is Unknown.
 */
export function roundOutcome(
  attempts: readonly Pick<AttemptResult, "outcome">[],
  configured: number,
): Outcome {
  if (attempts.some((a) => a.outcome === "success")) return "success";
  if (attempts.some((a) => a.outcome === "configuration-error")) return "configuration-error";
  const complete = attempts.length > 0 && attempts.length >= configured;
  if (complete && attempts.every((a) => a.outcome === "target-failure")) return "target-failure";
  return "unknown";
}
