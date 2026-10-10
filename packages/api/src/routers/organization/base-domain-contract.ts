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
const pointingSchema = z
  .object({
    probe: z.string(),
    state: z.enum(["pointing-here", "pointing-elsewhere", "not-resolving", "unknown"]),
    /** Never includes the server's own address unless the caller may see it. */
    addresses: z.array(z.string()),
    proxied: z.boolean(),
  })
  .nullable();

const baseDomainDnsOutput = z.object({
  baseDomain: z.string().nullable(),
  /** Install admins only: the server IP is sensitive. Null for everyone else. */
  serverIp: z.string().nullable(),
  /** The install has an address, but this caller may not see it. */
  serverIpHidden: z.boolean(),
  /** What a newly exposed service gets: `<service>-<project>.<suffix>`, or
   *  `<service>-<project>.<server ip>.<suffix>` when `onServerIp`. */
  publishing: z.object({
    source: z.enum(["org-base", "local-base", "sslip-fallback"]),
    suffix: z.string(),
    onServerIp: z.boolean(),
    certificate: z.enum(["lets-encrypt", "self-signed"]),
  }),
  zone: z.string().nullable(),
  provider: z.enum(["cloudflare", "unknown"]),
  records: z.array(
    z.object({
      type: z.enum(["A", "TXT"]),
      name: z.string(),
      /** Null when redacted (the A record's value is the server IP). */
      value: z.string().nullable(),
      relativeName: z.string().nullable(),
      purpose: z.enum(["wildcard", "verify"]),
    }),
  ),
  /** Null when no base domain is set. */
  wildcard: pointingSchema,
  /** Where the bare domain points. Services don't use it. */
  apex: pointingSchema,
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
