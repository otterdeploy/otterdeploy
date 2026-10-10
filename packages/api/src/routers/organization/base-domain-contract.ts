/**
 * Read-only views behind Settings → Domains, split from ./contract for size:
 * the base domain's DNS as it is now, the hostnames a domain change leaves in
 * place, and the connected Cloudflare zone by name.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";

import { organizationIdField } from "../project/contract/shared";

const tag = "organization";
const basePath = "/organizations";

const organizationInput = z.object({ organizationId: organizationIdField });

/** The base domain's DNS right now: see `checkOrganizationBaseDomainDns`. */
const baseDomainDnsOutput = z.object({
  baseDomain: z.string().nullable(),
  serverIp: z.string().nullable(),
  /** What a newly exposed service gets: `<service>-<project>.<suffix>`. */
  publishing: z.object({
    source: z.enum(["org-base", "local-base", "sslip-fallback"]),
    suffix: z.string(),
    certificate: z.enum(["lets-encrypt", "self-signed"]),
  }),
  zone: z.string().nullable(),
  provider: z.enum(["cloudflare", "unknown"]),
  records: z.array(
    z.object({
      type: z.enum(["A", "TXT"]),
      name: z.string(),
      value: z.string(),
      relativeName: z.string().nullable(),
      purpose: z.enum(["wildcard", "verify"]),
    }),
  ),
  /** Null when no base domain is set. */
  wildcard: z
    .object({
      probe: z.string(),
      state: z.enum(["pointing-here", "pointing-elsewhere", "not-resolving", "unknown"]),
      addresses: z.array(z.string()),
      proxied: z.boolean(),
    })
    .nullable(),
  txt: z
    .object({
      name: z.string(),
      state: z.enum(["found", "wrong-value", "not-found", "unknown"]),
      found: z.array(z.string()),
    })
    .nullable(),
});

const cloudflareZoneOutput = z.object({
  zoneId: z.string().nullable(),
  name: z.string().nullable(),
  token: z.enum(["not-connected", "ok", "rejected", "unreachable", "error"]),
  message: z.string().nullable(),
});

const baseDomainHostnamesOutput = z.object({
  baseDomain: z.string().nullable(),
  /** Up to 50, alphabetical. `total` is the full count. */
  hostnames: z.array(z.string()),
  total: z.number().int(),
});

export const baseDomainContract = {
  checkBaseDomainDns: oc
    .meta({
      path: `${basePath}/{organizationId}/settings/base-domain/dns`,
      tag,
      method: "GET",
    })
    .input(organizationInput)
    .output(baseDomainDnsOutput),

  baseDomainHostnames: oc
    .meta({
      path: `${basePath}/{organizationId}/settings/base-domain/hostnames`,
      tag,
      method: "GET",
    })
    .input(organizationInput)
    .output(baseDomainHostnamesOutput),

  cloudflareZone: oc
    .meta({
      path: `${basePath}/{organizationId}/settings/cloudflare/zone`,
      tag,
      method: "GET",
    })
    .input(organizationInput)
    .output(cloudflareZoneOutput),
};
