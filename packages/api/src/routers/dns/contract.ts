/**
 * DNS inspection for the "add a domain" flow.
 *
 * Read-only and deliberately so. It answers the two questions the UI needs
 * before it can be helpful. Who runs DNS for this name, and can we configure
 * it for you, while the WRITING of records stays with the surface that owns
 * the domain (the control-plane router, the service-domains router), because
 * only those know the target's server IP and verification token.
 *
 * There is no "apply these records" input anywhere in this contract on purpose:
 * a connected Cloudflare token must never become a general-purpose API for
 * writing arbitrary records into an operator's zone.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";

const dnsInspectOutput = z.object({
  /** The DNS provider we could identify from the zone's nameservers. */
  provider: z.enum(["cloudflare", "unknown"]),
  /** Zone apex that answered NS: what a Cloudflare zone is keyed on, and the
   *  name the UI should show ("add these records to acme.com"). */
  zone: z.string().nullable(),
  nameservers: z.array(z.string()),
  /**
   * The lookup itself failed (no resolver reachable), as opposed to succeeding
   * with an unrecognised provider. The UI must not render this as
   * "not Cloudflare": it means "we couldn't ask".
   */
  lookupFailed: z.boolean(),
  cloudflare: z.object({
    /** This workspace has a Cloudflare token saved. */
    connected: z.boolean(),
    /** A zone on that token covers this domain, the precondition for
     *  one-click setup. Null when not connected or no zone matches. */
    zoneId: z.string().nullable(),
    /** Detected as Cloudflare AND we hold a token for the matching zone.
     *  Drives the choice between "Configure" and "Connect Cloudflare". */
    canAutoConfigure: z.boolean(),
  }),
  /**
   * Resolves somewhere other than this install. The orange-cloud case.
   * `null` means undetermined (nothing resolves yet, or no origin configured)
   * and must not be shown as "not proxied". A proxied record terminates TLS
   * elsewhere and breaks ACME HTTP-01, which is a failure that otherwise
   * surfaces as an unexplained stuck certificate.
   */
  proxied: z.boolean().nullable(),
  resolvedAddresses: z.array(z.string()),
});

export const dnsContract = {
  inspect: oc
    .meta({ path: "/dns/inspect", tag: "dns", method: "GET" })
    .input(z.object({ domain: z.string().min(1) }))
    .output(dnsInspectOutput),
};

export type DnsInspectResult = z.infer<typeof dnsInspectOutput>;
