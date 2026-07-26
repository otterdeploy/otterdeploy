/**
 * Firewall-drift state mapping for the Servers table (od-5j8.34). Pure logic
 * split from `servers-firewall.tsx` so the honesty-critical mapping —
 * `unknown` must never read as protected — is unit-testable without
 * mounting React.
 *
 * Reuses the server's own `isFirewallDrifted()` (packages/api) rather than
 * re-deriving the drift rule client-side, so the UI and the backend that
 * gates remediation can never disagree about what counts as drift.
 */
import {
  isFirewallDrifted,
  type FirewallStatusValue,
} from "@otterdeploy/api/routers/server/host-firewall";

export type { FirewallStatusValue };

export interface FirewallFacts {
  firewallStatus: FirewallStatusValue;
  firewallBouncerActive: boolean;
}

/**
 * Three honest states for the headline badge — kept separate from the
 * bouncer fact (see `FirewallSummary`) rather than folding everything into
 * one opaque badge.
 *
 * - `unknown`: the baseline has never been established (or predates this
 *   feature) — must never render as green/healthy.
 * - `enforced`: the server-side drift check passed AND a baseline actually
 *   ran (`applied` or `unsupported`, i.e. not `unknown`).
 * - `drifted`: everything else — a failed apply, an unsupported host whose
 *   bouncer isn't covering it either, or an applied baseline whose bouncer
 *   died since.
 */
export type FirewallState = "unknown" | "enforced" | "drifted";

export function firewallState(facts: FirewallFacts): FirewallState {
  if (facts.firewallStatus === "unknown") return "unknown";
  return isFirewallDrifted(facts) ? "drifted" : "enforced";
}

export interface FirewallSummary {
  state: FirewallState;
  /** Raw persisted status, for the badge's secondary label. */
  status: FirewallStatusValue;
  /** CrowdSec native bouncer — a separate fact from the nftables baseline. */
  bouncerActive: boolean;
  /** Drives whether "Reapply firewall" is offered at all. */
  drifted: boolean;
}

export function summarizeFirewall(facts: FirewallFacts): FirewallSummary {
  return {
    state: firewallState(facts),
    status: facts.firewallStatus,
    bouncerActive: facts.firewallBouncerActive,
    drifted: isFirewallDrifted(facts),
  };
}

const STATE_LABEL: Record<FirewallState, string> = {
  unknown: "unknown",
  enforced: "enforced",
  drifted: "drifted",
};

export function firewallStateLabel(state: FirewallState): string {
  return STATE_LABEL[state];
}
