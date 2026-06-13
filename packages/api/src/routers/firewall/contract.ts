/**
 * Firewall contract — surfaces CrowdSec's active decisions (blocked IPs) and
 * reachability for the Firewall page. CrowdSec is identity-blind and
 * cluster-wide, so this is org-admin context, not per-project. See
 * docs/designs/deployment-protection.md §10.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";

const tag = "firewall";

export const firewallDecisionSchema = z.object({
  origin: z.string(),
  /** ban | captcha | throttle … */
  type: z.string(),
  /** Ip | Range | Country | AS … */
  scope: z.string(),
  /** The blocked IP / range / country. */
  value: z.string(),
  duration: z.string(),
  scenario: z.string(),
});

export const firewallStatusSchema = z.object({
  /** Both LAPI url + bouncer key are configured. */
  configured: z.boolean(),
  /** LAPI answered. */
  reachable: z.boolean(),
  decisionCount: z.number(),
});

export const firewallContract = {
  status: oc
    .meta({ path: "/firewall/status", tag, method: "GET" })
    .output(firewallStatusSchema),
  decisions: oc
    .meta({ path: "/firewall/decisions", tag, method: "GET" })
    .output(z.array(firewallDecisionSchema)),
};
