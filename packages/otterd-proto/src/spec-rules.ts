/**
 * ServiceSpec defaults and admission checks; mirror of
 * `ServiceSpecInput::normalize` and `ServiceSpec::validate` in `spec.rs`.
 * Both must agree on every case in `fixtures/spec-normalize.json`.
 */
import {
  DEFAULT_FAILOVER_DELAY_MS,
  DEFAULT_MEMORY_RESERVATION_BYTES,
  DEFAULT_NANO_CPU_RESERVATION,
  LIFECYCLE_FIELDS,
  MIN_FAILOVER_DELAY_MS,
  RESERVATION_KINDS,
  SPEC_ISSUE_CODES,
  type DisconnectAction,
  type EndpointSpec,
  type FailoverPolicy,
  type LifecycleField,
  type Mount,
  type ServiceMode,
  type ServiceSpec,
  type ServiceSpecInput,
  type SpecIssue,
  type TaskSpec,
  type UpdateConfig,
  type UpdateConfigInput,
  type UpdateOrder,
} from "./spec";
import { SERVICE_SPEC_SCHEMA } from "./version";

type Basis = ServiceSpec["lifecycle"]["basis"];

interface LifecycleDefaults {
  policy: FailoverPolicy;
  exclusive: boolean;
  disconnect: DisconnectAction;
}

const DEFAULTS_BY_BASIS: Record<Basis, LifecycleDefaults> = {
  mounted: { policy: "stay", exclusive: true, disconnect: "continue-existing" },
  "mount-free": { policy: "reschedule", exclusive: false, disconnect: "stop" },
  job: { policy: "stay", exclusive: true, disconnect: "stop" },
};

const isData = (m: Mount) => m.kind === "volume" || m.kind === "bind";
const isWritableData = (m: Mount) => isData(m) && m.readOnly !== true;

function hasHostPorts(endpoint: EndpointSpec): boolean {
  return (endpoint.ports ?? []).some((p) => p.publish === "host" && p.publishedPort !== undefined);
}

function mayRunMany(mode: ServiceMode): boolean {
  switch (mode.kind) {
    case "replicated":
      return mode.replicas > 1;
    case "global":
      return true;
    case "job":
      return mode.maxConcurrent > 1;
  }
}

function basisOf(input: ServiceSpecInput): Basis {
  if (input.mode.kind === "job") return "job";
  return (input.task.mounts ?? []).some(isData) ? "mounted" : "mount-free";
}

function updateFrom(input: UpdateConfigInput, order: UpdateOrder): UpdateConfig {
  return {
    parallelism: input.parallelism ?? 1,
    delayMs: input.delayMs ?? 0,
    monitorMs: input.monitorMs ?? 5_000,
    maxFailureRatioPermille: input.maxFailureRatioPermille ?? 0,
    failureAction: input.failureAction ?? "pause",
    order: input.order ?? order,
  };
}

const differs = <T>(set: T | undefined, fallback: T) => set !== undefined && set !== fallback;

function overridesOf(
  input: ServiceSpecInput,
  defaults: LifecycleDefaults,
  order: UpdateOrder,
): LifecycleField[] {
  const li = input.lifecycle;
  const changed: Record<LifecycleField, boolean> = {
    "failover-policy": differs(li.failoverPolicy, defaults.policy),
    "failover-delay": differs(li.failoverDelayMs, DEFAULT_FAILOVER_DELAY_MS),
    exclusive: differs(li.exclusive, defaults.exclusive),
    "disconnect-action": differs(li.disconnectAction, defaults.disconnect),
    "update-order": differs(input.update.order, order),
    "rollback-order": differs(input.rollback.order, order),
  };
  return LIFECYCLE_FIELDS.filter((f) => changed[f]);
}

function resourcesWithDefaults(task: TaskSpec): TaskSpec["resources"] {
  const reservations = { ...task.resources.reservations };
  const defaulted = new Set(task.resources.defaulted ?? []);
  if (reservations.memoryBytes === undefined) {
    reservations.memoryBytes = DEFAULT_MEMORY_RESERVATION_BYTES;
    defaulted.add("memory");
  }
  if (reservations.nanoCpus === undefined) {
    reservations.nanoCpus = DEFAULT_NANO_CPU_RESERVATION;
    defaulted.add("cpu");
  }
  const list = RESERVATION_KINDS.filter((k) => defaulted.has(k));
  return {
    limits: task.resources.limits,
    reservations,
    ...(list.length > 0 ? { defaulted: list } : {}),
  };
}

/** Fill every default. Pure. */
export function normalizeServiceSpec(input: ServiceSpecInput): ServiceSpec {
  const basis = basisOf(input);
  const defaults = DEFAULTS_BY_BASIS[basis];
  const li = input.lifecycle;
  const exclusive = li.exclusive ?? defaults.exclusive;
  const order: UpdateOrder =
    exclusive || hasHostPorts(input.endpoint) ? "stop-first" : "start-first";
  const overrides = overridesOf(input, defaults, order);
  return {
    schema: SERVICE_SPEC_SCHEMA,
    resourceId: input.resourceId,
    mode: input.mode,
    task: { ...input.task, resources: resourcesWithDefaults(input.task) },
    update: updateFrom(input.update, order),
    rollback: updateFrom(input.rollback, order),
    endpoint: input.endpoint,
    lifecycle: {
      failover: {
        policy: li.failoverPolicy ?? defaults.policy,
        delayMs: li.failoverDelayMs ?? DEFAULT_FAILOVER_DELAY_MS,
      },
      exclusive,
      disconnectAction: li.disconnectAction ?? defaults.disconnect,
      ...(li.concurrencyGroup === undefined ? {} : { concurrencyGroup: li.concurrencyGroup }),
      ...(li.concurrentSafe === undefined ? {} : { concurrentSafe: li.concurrentSafe }),
      basis,
      ...(overrides.length > 0 ? { overrides } : {}),
    },
  };
}

const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/;

function orderIssues(spec: ServiceSpec): SpecIssue[] {
  const out: SpecIssue[] = [];
  const hostPorts = hasHostPorts(spec.endpoint);
  const configs = [
    [spec.update, "/update"],
    [spec.rollback, "/rollback"],
  ] as const;
  for (const [cfg, path] of configs) {
    const startFirst = cfg.order === "start-first";
    if (startFirst && spec.lifecycle.exclusive) {
      out.push({ code: "EXCLUSIVE_REQUIRES_STOP_FIRST", severity: "error", path: `${path}/order` });
    }
    if (startFirst && hostPorts) {
      out.push({ code: "HOST_PORT_REQUIRES_STOP_FIRST", severity: "error", path: `${path}/order` });
    }
    if (cfg.maxFailureRatioPermille > 1000) {
      const at = `${path}/maxFailureRatioPermille`;
      out.push({ code: "FAILURE_RATIO_OUT_OF_RANGE", severity: "error", path: at });
    }
  }
  return out;
}

function lifecycleIssues(spec: ServiceSpec): SpecIssue[] {
  const out: SpecIssue[] = [];
  const lc = spec.lifecycle;
  const writable = (spec.task.mounts ?? []).some(isWritableData);
  if (lc.failover.delayMs < MIN_FAILOVER_DELAY_MS) {
    const path = "/lifecycle/failover/delayMs";
    out.push({ code: "FAILOVER_DELAY_BELOW_MINIMUM", severity: "error", path });
  }
  if (mayRunMany(spec.mode) && writable && lc.concurrentSafe === undefined) {
    out.push({ code: "SHARED_WRITABLE_MOUNT", severity: "error", path: "/mode" });
  }
  if (spec.mode.kind === "job" && !lc.exclusive) {
    out.push({ code: "JOB_REQUIRES_EXCLUSIVE", severity: "error", path: "/lifecycle/exclusive" });
  }
  if (lc.failover.policy === "reschedule" && writable) {
    const path = "/lifecycle/failover/policy";
    out.push({ code: "RESCHEDULE_LEAVES_DATA_BEHIND", severity: "warning", path });
  }
  return out;
}

function mountIssues(mounts: readonly Mount[]): SpecIssue[] {
  const out: SpecIssue[] = [];
  const targets = new Set<string>();
  mounts.forEach((m, i) => {
    const source = `/task/mounts/${i}/source`;
    if (isData(m) && m.source === undefined) {
      out.push({ code: "MOUNT_SOURCE_REQUIRED", severity: "error", path: source });
    }
    if (m.kind === "tmpfs" && m.source !== undefined) {
      out.push({ code: "TMPFS_HAS_SOURCE", severity: "error", path: source });
    }
    if (targets.has(m.target)) {
      const path = `/task/mounts/${i}/target`;
      out.push({ code: "DUPLICATE_MOUNT_TARGET", severity: "error", path });
    }
    targets.add(m.target);
  });
  return out;
}

function imageAndEndpointIssues(spec: ServiceSpec): SpecIssue[] {
  const out: SpecIssue[] = [];
  const digest = spec.task.container.image.digest;
  if (digest !== undefined && !IMAGE_DIGEST.test(digest)) {
    const path = "/task/container/image/digest";
    out.push({ code: "IMAGE_DIGEST_INVALID", severity: "error", path });
  }
  if (spec.endpoint.mode === "dnsrr") {
    out.push({ code: "DNSRR_CLIENT_LIMITATIONS", severity: "warning", path: "/endpoint/mode" });
  }
  return out;
}

function compareIssues(a: SpecIssue, b: SpecIssue): number {
  const sev = Number(a.severity === "warning") - Number(b.severity === "warning");
  if (sev !== 0) return sev;
  const code = SPEC_ISSUE_CODES.indexOf(a.code) - SPEC_ISSUE_CODES.indexOf(b.code);
  if (code !== 0) return code;
  if (a.path === b.path) return 0;
  return a.path < b.path ? -1 : 1;
}

/** All issues, errors first, in a stable order. Never rewrites a choice. */
export function validateServiceSpec(spec: ServiceSpec): SpecIssue[] {
  const schema: SpecIssue[] =
    spec.schema === SERVICE_SPEC_SCHEMA
      ? []
      : [{ code: "SCHEMA_UNSUPPORTED", severity: "error", path: "/schema" }];
  return [
    ...schema,
    ...orderIssues(spec),
    ...lifecycleIssues(spec),
    ...mountIssues(spec.task.mounts ?? []),
    ...imageAndEndpointIssues(spec),
  ].toSorted(compareIssues);
}

/** Admissible = no error-severity issue. */
export function isAdmissible(spec: ServiceSpec): boolean {
  return validateServiceSpec(spec).every((i) => i.severity !== "error");
}
