/**
 * Firewall router — reads CrowdSec's active decisions from LAPI for the
 * Firewall page. Org-scoped for access control, but the data is cluster-wide
 * (CrowdSec is identity-blind). Returns empty/unconfigured gracefully so the
 * page renders a clear "not set up" state instead of erroring.
 */

import { Result } from "better-result";

import { env } from "@otterdeploy/env/server";

import { orgScopedProcedure } from "../..";

interface Decision {
  origin: string;
  type: string;
  scope: string;
  value: string;
  duration: string;
  scenario: string;
}

function configured(): boolean {
  return Boolean(env.CROWDSEC_LAPI_URL && env.CROWDSEC_BOUNCER_KEY);
}

/** GET LAPI /v1/decisions. Returns null on any failure (treated as
 *  unreachable); LAPI returns JSON `null` when there are no decisions. */
async function fetchDecisions(): Promise<Decision[] | null> {
  if (!configured()) return null;
  const res = await Result.tryPromise({
    try: async () => {
      const r = await fetch(new URL("/v1/decisions", env.CROWDSEC_LAPI_URL), {
        headers: { "X-Api-Key": env.CROWDSEC_BOUNCER_KEY as string },
      });
      if (!r.ok) throw new Error(`LAPI responded ${r.status}`);
      return (await r.json()) as unknown;
    },
    catch: (cause) => cause,
  });
  if (res.isErr()) return null;
  const data = res.value;
  if (!Array.isArray(data)) return []; // null = no decisions
  return data.map((d) => {
    const o = d as Record<string, unknown>;
    return {
      origin: String(o.origin ?? "crowdsec"),
      type: String(o.type ?? "ban"),
      scope: String(o.scope ?? "Ip"),
      value: String(o.value ?? ""),
      duration: String(o.duration ?? ""),
      scenario: String(o.scenario ?? ""),
    };
  });
}

export const firewallRouter = {
  status: orgScopedProcedure.firewall.status.handler(async () => {
    const decisions = await fetchDecisions();
    return {
      configured: configured(),
      reachable: decisions !== null,
      decisionCount: decisions?.length ?? 0,
    };
  }),

  decisions: orgScopedProcedure.firewall.decisions.handler(async () => {
    return (await fetchDecisions()) ?? [];
  }),
};
