/**
 * od-5j8.24 / od-5j8.23 — the single place that decides, for a parsed
 * compose file, which unsupported-or-transformed fields are safe enough to
 * proceed with a warning and which ones must block the deploy outright.
 *
 * This is deliberately the ONE mechanism: `normalize.ts` captures every
 * field the platform can't fully honor (see `types.ts`) without judging it;
 * this module judges it. The swarm spec layer (`swarm/container-security.ts`)
 * enforces the actual runtime policy (drop-all + safe re-add, no
 * `Privileged` field, no `Devices` field). Nothing here grants a tenant
 * compose file extra capabilities or device access — every FAIL-classified
 * escalation is rejected, never silently downgraded into a grant.
 *
 * Used at every point a compose file is about to become — or already is —
 * running workload: the stateless wizard preview, inline create, and the
 * shared `deployCompose` orchestrator that both direct deploys AND every
 * redeploy/reconcile of an existing (including git-sourced) stack funnel
 * through. That last point is what makes this "pre-apply on every
 * reconcile, not just initial create" — `deployCompose` is the one function
 * both paths call.
 */
import type { ParsedCompose, ParsedComposeService } from "./types";

export type CompatSeverity = "fail" | "warn";

export interface CompatIssue {
  service: string;
  field: string;
  severity: CompatSeverity;
  message: string;
}

export interface CompatibilityReport {
  fails: CompatIssue[];
  warnings: CompatIssue[];
  /** `true` iff there are no FAIL-severity issues — i.e. the deploy is safe
   *  to proceed (though it may still carry warnings). */
  ok: boolean;
}

export interface CompatibilityContext {
  /** Whether a bind mount's host-path source can actually be resolved and
   *  materialized for this deploy — true only for a multi-file inline stack
   *  (see `routers/compose/deploy.ts#materializeInlineTree`). A git-sourced
   *  stack or a single pasted file has no working tree to bind from, so a
   *  bind mount there can never be honored — see `reconcile-map.ts#toBindMounts`,
   *  which already skips it (that "already skips" is exactly the silent-drop
   *  this issue exists to close: it must be a reported failure, not a no-op). */
  bindMountsSupported: boolean;
}

/** `security_opt` values that WEAKEN the sandbox relative to the platform
 *  baseline — always a hard failure, matched case-insensitively against
 *  both `:` and `=` separator forms compose accepts. */
const ESCALATING_SECURITY_OPTS = [
  "seccomp:unconfined",
  "seccomp=unconfined",
  "apparmor:unconfined",
  "apparmor=unconfined",
  "no-new-privileges:false",
  "no-new-privileges=false",
  "label:disable",
  "label=disable",
];

function isEscalatingSecurityOpt(opt: string): boolean {
  const normalized = opt.trim().toLowerCase();
  return ESCALATING_SECURITY_OPTS.some((bad) => normalized === bad);
}

/** `network_mode` values that reference a foreign namespace ("host" or a
 *  sibling container/service's) — always a hard failure, same as any other
 *  explicit `network_mode` (Swarm services can't honor ANY override, but
 *  these are called out because they're the most dangerous: full host
 *  network visibility, or piggy-backing another container's identity). */
function isNamespaceSharingMode(mode: string): boolean {
  const normalized = mode.trim().toLowerCase();
  return normalized === "host" || normalized.startsWith("container:") || normalized.startsWith("service:");
}

interface Reporter {
  fail(field: string, message: string): void;
  warn(field: string, message: string): void;
}

function checkPrivilegedAndCaps(svc: ParsedComposeService, r: Reporter): void {
  if (svc.privileged) {
    r.fail(
      "privileged",
      `service "${svc.name}": \`privileged: true\` is rejected — Docker Swarm services can't run privileged, and the platform never grants it`,
    );
  }
  if (svc.capAdd.length > 0) {
    r.fail(
      "cap_add",
      `service "${svc.name}": \`cap_add: [${svc.capAdd.join(", ")}]\` is rejected — granting extra Linux capabilities has no admin-review path yet`,
    );
  }
  if (svc.capDrop.length > 0) {
    r.warn(
      "cap_drop",
      `service "${svc.name}": \`cap_drop\` is redundant — the platform already drops all capabilities and re-adds only its safe default set`,
    );
  }
  if (svc.devices.length > 0) {
    r.fail(
      "devices",
      `service "${svc.name}": \`devices: [${svc.devices.join(", ")}]\` is rejected — Docker Swarm services have no host-device passthrough`,
    );
  }
}

function checkSecurityOpt(svc: ParsedComposeService, r: Reporter): void {
  for (const opt of svc.securityOpt) {
    if (isEscalatingSecurityOpt(opt)) {
      r.fail(
        "security_opt",
        `service "${svc.name}": \`security_opt: ${opt}\` is rejected — it would weaken the platform's default sandbox`,
      );
    } else {
      r.warn(
        "security_opt",
        `service "${svc.name}": \`security_opt: ${opt}\` is not applied — review whether it's still needed`,
      );
    }
  }
}

function checkNamespaces(svc: ParsedComposeService, r: Reporter): void {
  if (svc.networkMode) {
    const detail = isNamespaceSharingMode(svc.networkMode)
      ? "it shares a host or foreign container's network namespace, which Swarm services can't do"
      : "Swarm services always attach to the project overlay network";
    r.fail(
      "network_mode",
      `service "${svc.name}": \`network_mode: ${svc.networkMode}\` is rejected — ${detail}`,
    );
  }

  if (svc.pid) {
    const normalizedPid = svc.pid.trim().toLowerCase();
    const sharesForeignPid =
      normalizedPid === "host" ||
      normalizedPid.startsWith("container:") ||
      normalizedPid.startsWith("service:");
    if (sharesForeignPid) {
      r.fail(
        "pid",
        `service "${svc.name}": \`pid: ${svc.pid}\` is rejected — sharing a foreign PID namespace isn't supported`,
      );
    } else {
      r.warn("pid", `service "${svc.name}": \`pid: ${svc.pid}\` is not applied`);
    }
  }
}

function checkUnappliedFields(svc: ParsedComposeService, r: Reporter): void {
  if (Object.keys(svc.sysctls).length > 0) {
    r.warn(
      "sysctls",
      `service "${svc.name}": \`sysctls\` is not applied yet — set at the host/network level if required`,
    );
  }
  if (svc.hasUlimits) {
    r.warn("ulimits", `service "${svc.name}": \`ulimits\` is not applied yet`);
  }
  if (svc.secrets.length > 0) {
    r.warn(
      "secrets",
      `service "${svc.name}": per-service \`secrets\` (${svc.secrets.join(", ")}) aren't supported yet`,
    );
  }
  if (svc.configs.length > 0) {
    r.warn(
      "configs",
      `service "${svc.name}": per-service \`configs\` (${svc.configs.join(", ")}) aren't supported yet`,
    );
  }
}

function checkBindMounts(svc: ParsedComposeService, ctx: CompatibilityContext, r: Reporter): void {
  for (const v of svc.volumes) {
    if (v.type !== "bind") continue;
    if (ctx.bindMountsSupported) {
      r.warn(
        "volumes",
        `service "${svc.name}": bind mount ${v.source ?? "?"}:${v.target} will be applied from the materialized file tree`,
      );
    } else {
      r.fail(
        "volumes",
        `service "${svc.name}": bind mount ${v.source ?? "?"}:${v.target} can't be honored — no materialized file tree for this stack (single-file or git-sourced stacks don't retain a host path to bind from)`,
      );
    }
  }
}

function checkService(
  svc: ParsedComposeService,
  ctx: CompatibilityContext,
  fails: CompatIssue[],
  warnings: CompatIssue[],
): void {
  const r: Reporter = {
    fail: (field, message) => fails.push({ service: svc.name, field, severity: "fail", message }),
    warn: (field, message) => warnings.push({ service: svc.name, field, severity: "warn", message }),
  };
  checkPrivilegedAndCaps(svc, r);
  checkSecurityOpt(svc, r);
  checkNamespaces(svc, r);
  checkUnappliedFields(svc, r);
  checkBindMounts(svc, ctx, r);
}

export function checkComposeCompatibility(
  parsed: Pick<ParsedCompose, "services">,
  ctx: CompatibilityContext,
): CompatibilityReport {
  const fails: CompatIssue[] = [];
  const warnings: CompatIssue[] = [];
  for (const svc of parsed.services) {
    checkService(svc, ctx, fails, warnings);
  }
  return { fails, warnings, ok: fails.length === 0 };
}

/** One human-readable line per fail, for a deploy-blocking error message. */
export function summarizeFails(report: CompatibilityReport): string {
  return report.fails.map((f) => f.message).join("; ");
}
