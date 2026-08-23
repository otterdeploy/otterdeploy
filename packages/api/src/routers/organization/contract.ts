/**
 * Organization-scoped settings contract.
 *
 * The `organization` row itself is owned by better-auth (id/name/slug/logo/
 * metadata/createdAt): this router exposes the otterdeploy-specific columns
 * we layered on top: baseDomain (+ verification state), Cloudflare DNS API
 * token, Cloudflare zone id.
 *
 * Per-row updates only. There's no list/get on this contract because the
 * caller already knows their active org (via session) and can read the org
 * fields from the existing auth.* shapes.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";

import { organizationIdField } from "../project/contract/shared";
import {
  runtimeSettingsDraftSchema,
  signInMethodsDraftSchema,
  signInMethodsSchema,
} from "./runtime-settings-schema";

const tag = "organization";
const basePath = "/organizations";

// FQDN regex: lowercase, labels of 1–63 chars, dot-separated, ends in
// a TLD label of ≥2 chars. Matches the standard "user-typed apex" surface;
// rejects schemes / paths / trailing dots. Empty string clears the value.
const FQDN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const fqdnShape = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => v === "" || FQDN_RE.test(v), {
    message: "must be a hostname like acme.com (no scheme, no path)",
  });

const organizationSettingsSchema = z.object({
  id: organizationIdField,
  name: z.string(),
  slug: z.string(),
  baseDomain: z.string().nullable(),
  baseDomainVerifiedAt: z.date().nullable(),
  baseDomainVerifyToken: z.string().nullable(),
  cloudflareZoneId: z.string().nullable(),
  // The token itself is never returned. We send a `cloudflareTokenConfigured`
  // boolean so the UI can render "Connected to Cloudflare" without exposing
  // the secret to the client.
  cloudflareTokenConfigured: z.boolean(),
});

const getOrganizationSettingsInput = z.object({
  organizationId: organizationIdField,
});

const setBaseDomainInput = z.object({
  organizationId: organizationIdField,
  /** Empty string clears the domain. */
  baseDomain: fqdnShape,
});

const verifyBaseDomainInput = z.object({
  organizationId: organizationIdField,
});

const cloudflareZoneSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
});

const listCloudflareZonesInput = z.object({
  /** Token is passed inline (not stored) so the UI can list zones BEFORE
   *  committing: operator can see the zone they'd pick before saving. */
  token: z.string().min(1),
});

const setCloudflareConfigInput = z.object({
  organizationId: organizationIdField,
  /** Empty string clears the integration (also wipes zoneId). */
  token: z.string(),
  zoneId: z.string().nullable(),
});

const autoConfigureDomainInput = z.object({
  organizationId: organizationIdField,
});

const autoConfigureDomainOutput = z.object({
  ok: z.boolean(),
  /** Cloudflare record IDs we created/updated. Surfaced so the operator
   *  knows exactly which records are now under otterdeploy management. */
  txtRecordId: z.string().nullable(),
  aRecordId: z.string().nullable(),
  /** Outcome of the verify step that runs after DNS is in place. Lets
   *  the UI show "Verified" or "DNS created, still propagating" without
   *  a separate roundtrip. */
  verify: z.object({
    ok: z.boolean(),
    reason: z.enum(["ok", "no-record", "value-mismatch", "lookup-failed", "missing-token"]),
  }),
  settings: organizationSettingsSchema,
});

const verifyBaseDomainOutput = z.object({
  ok: z.boolean(),
  /** TXT record name we looked up (e.g. `_otterdeploy-verify.acme.com`).
   *  Surfaced verbatim in the UI so the user knows the exact name to
   *  add to their DNS. */
  recordName: z.string(),
  /** Token the TXT record value must match. */
  expected: z.string(),
  /** TXT values the resolver actually returned. Empty when no record
   *  exists. Drives "we saw X, expected Y" diagnostics. */
  found: z.array(z.string()),
  reason: z.enum(["ok", "no-record", "value-mismatch", "lookup-failed", "missing-token"]),
  errorMessage: z.string().optional(),
  /** Echo back the updated settings on success so the UI doesn't need a
   *  separate refetch. Null on failure (no state change happened). */
  settings: organizationSettingsSchema.nullable(),
});

// ─── Control-plane domain (platform-wide) ────────────────────────────
// The domain this dashboard itself answers on, stored on the
// platform_settings singleton, surfaced under org settings alongside the
// (per-org) base domain so operators find both in one place.
const controlPlaneDomainSchema = z.object({
  domain: z.string().nullable(),
  verifiedAt: z.date().nullable(),
  verifyToken: z.string().nullable(),
  /** Where the A record should point (platform serverIp), for UI hints. */
  serverIp: z.string().nullable(),
});

const setControlPlaneDomainInput = z.object({
  organizationId: organizationIdField,
  /** Empty string clears the domain (and removes the edge site block). */
  domain: fqdnShape,
});

const verifyControlPlaneDomainOutput = z.object({
  ok: z.boolean(),
  recordName: z.string(),
  expected: z.string(),
  found: z.array(z.string()),
  reason: z.enum(["ok", "no-record", "value-mismatch", "lookup-failed", "missing-token"]),
  errorMessage: z.string().optional(),
  settings: controlPlaneDomainSchema,
});

const autoConfigureControlPlaneOutput = z.object({
  ok: z.boolean(),
  txtRecordId: z.string().nullable(),
  aRecordId: z.string().nullable(),
  verify: z.object({
    ok: z.boolean(),
    reason: z.enum(["ok", "no-record", "value-mismatch", "lookup-failed", "missing-token"]),
  }),
  settings: controlPlaneDomainSchema,
});

// ─── Instance network + edge defaults (platform-wide) ────────────────
// The public IP behind sslip.io fallback domains + Cloudflare A records,
// and the install-wide edge-proxy options (ACME email, HTTPS redirect).
// All live on the platform_settings singleton; surfaced on the Instance page.
const serverIpSchema = z.object({
  serverIp: z.string().nullable(),
  /** True when env SERVER_IP is set. It re-applies on every boot, so a UI
   *  edit would be overwritten. The UI disables the input and says so. */
  envOverride: z.boolean(),
  /** The host's public IPv6, or null when it hasn't got one. Null is a
   *  legitimate steady state (IPv4-only VPS), not a pending detection. */
  serverIpv6: z.string().nullable(),
  /** Same env-pinning story as `envOverride`, for SERVER_IPV6. Tracked
   *  separately because the two can be pinned independently. */
  envOverrideIpv6: z.boolean(),
});

// Zod's own address formats (same primitives as `ipOrCidrField` in
// runtime-settings-schema) rather than a hand-rolled regex: one parser for
// what counts as an address, so the field can't drift from the rest of the
// codebase. Trim first, then validate; empty string clears the field.
const setServerIpInput = z.object({
  organizationId: organizationIdField,
  serverIp: z
    .string()
    .trim()
    .pipe(
      z.union([z.literal(""), z.ipv4(), z.ipv6()], {
        error: "must be an IPv4 or IPv6 address",
      }),
    ),
  /** v6-only on purpose: accepting a dotted quad here would let the same
   *  address sit in both columns, and every consumer (AAAA records, the
   *  Instance card) would then publish a v4 address as this host's IPv6.
   *  Absent ⇒ leave the stored v6 untouched (so a v4-only save can't wipe
   *  it); empty string ⇒ clear it deliberately. */
  serverIpv6: z
    .string()
    .trim()
    .pipe(z.union([z.literal(""), z.ipv6()], { error: "must be an IPv6 address" }))
    .optional(),
});

const edgeOptionsSchema = z.object({
  acmeEmail: z.string().nullable(),
  httpsAutoRedirect: z.boolean(),
});

const setEdgeOptionsInput = z.object({
  organizationId: organizationIdField,
  acmeEmail: z.email().nullable(),
  httpsAutoRedirect: z.boolean(),
});

// ─── Runtime configuration (platform-wide, od-gfg) ───────────────────
// Settings that used to be env-only but are runtime policy rather than
// boot-time infrastructure. All live on the platform_settings singleton with
// the env var as the seed/fallback; see
// packages/api/src/lib/platform-runtime-settings.ts for the resolution rule.
// Secrets are write-only here exactly like the email transport: a string sets
// it, null clears it, omitting it leaves it. Reads return `*Configured`.

const registrationModeEnum = z.enum(["invite-only", "open"]);

const accessSettingsSchema = z.object({
  registrationMode: registrationModeEnum,
  /** True once an account exists. Before that the install is still in
   *  bootstrap and the mode is moot, which the card explains. */
  bootstrapComplete: z.boolean(),
});

const setAccessSettingsInput = z.object({
  organizationId: organizationIdField,
  registrationMode: registrationModeEnum,
});

const setSignInMethodsInput = signInMethodsDraftSchema.extend({
  organizationId: organizationIdField,
});

const socialProviderIdEnum = z.enum(["github", "google", "gitlab"]);

const socialProviderSchema = z.object({
  id: socialProviderIdEnum,
  /** Operator's explicit toggle. Null = never set ⇒ treated as enabled when
   *  credentials exist, which is what keeps env-only installs working. */
  enabled: z.boolean().nullable(),
  clientId: z.string().nullable(),
  secretConfigured: z.boolean(),
  /** GitLab only. */
  issuer: z.string().nullable(),
  /** Both halves come from env, so the provider works with nothing stored. */
  envConfigured: z.boolean(),
  /** Registered on the live auth instance right now. The single honest
   *  answer to "is this button on the sign-in page?". */
  live: z.boolean(),
});

const setSocialProviderInput = z.object({
  organizationId: organizationIdField,
  id: socialProviderIdEnum,
  enabled: z.boolean(),
  clientId: z.string().trim().max(255).nullable(),
  clientSecret: z.string().min(1).nullable().optional(),
  issuer: z.url().nullable().optional(),
});

const crowdsecSettingsSchema = z.object({
  enabled: z.boolean(),
  lapiUrl: z.string().nullable(),
  bouncerKeyConfigured: z.boolean(),
  envConfigured: z.boolean(),
  /** Whether credentials resolve AND the toggle is on. I.e. whether the next
   *  reconcile will actually render the edge gate. */
  effective: z.boolean(),
});

const setCrowdsecSettingsInput = z.object({
  organizationId: organizationIdField,
  enabled: z.boolean(),
  lapiUrl: z.url().nullable(),
  bouncerKey: z.string().min(1).nullable().optional(),
});

const runtimeSettingsSchema = z.object({
  /** Comma-separated; empty string = explicitly allow nothing. */
  egressAllowlist: z.string(),
  /** True when the value shown is the env fallback rather than a stored one. */
  egressFromEnv: z.boolean(),
  previewIdleTeardownHours: z.number(),
  edgeLogPersist: z.boolean(),
  edgeLogRetentionDays: z.number(),
  edgeLogGeoipUrl: z.string(),
  edgeLogGeoipAsnUrl: z.string(),
  builderConcurrency: z.number(),
  /** Edge logging is off entirely unless EDGE_LOG_SINK is set, so the card can
   *  say why its toggles are inert instead of silently doing nothing. */
  edgeLogSinkConfigured: z.boolean(),
  /** The two levels every meter colours against and every threshold alert
   *  fires on. One pair, so the UI and the pager cannot disagree. */
  alertWarnPct: z.number(),
  alertCritPct: z.number(),
});

// The field rules live in ./runtime-settings-schema so the settings form can
// import and run the SAME schema inline as the operator types, instead of
// discovering a malformed IP only after a round trip returns "Input validation
// failed". The server stays the authority; the client just stops being the
// last to know.
const setRuntimeSettingsInput = runtimeSettingsDraftSchema.extend({
  organizationId: organizationIdField,
});

// ─── Members + invitations (delegated to better-auth's org plugin) ────────
const orgRef = z.object({ organizationId: organizationIdField });

const memberViewSchema = z.object({
  id: z.string(),
  userId: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.string(),
  createdAt: z.string(),
});

const invitationViewSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string(),
  status: z.string(),
  expiresAt: z.string().nullable(),
});

const removeMemberInput = z.object({
  organizationId: organizationIdField,
  // better-auth accepts a member id or the member's email.
  memberIdOrEmail: z.string().min(1),
});

const updateMemberRoleInput = z.object({
  organizationId: organizationIdField,
  memberId: z.string().min(1),
  role: z.enum(["admin", "member"]),
});

const cancelInvitationInput = z.object({
  organizationId: organizationIdField,
  invitationId: z.string().min(1),
});

export const organizationContract = {
  settings: oc
    .meta({
      path: `${basePath}/{organizationId}/settings`,
      tag,
      method: "GET",
    })
    .input(getOrganizationSettingsInput)
    .output(organizationSettingsSchema),

  setBaseDomain: oc
    .meta({
      path: `${basePath}/{organizationId}/settings/base-domain`,
      tag,
      method: "PATCH",
    })
    .input(setBaseDomainInput)
    .output(organizationSettingsSchema),

  verifyBaseDomain: oc
    .meta({
      path: `${basePath}/{organizationId}/settings/base-domain/verify`,
      tag,
      method: "POST",
    })
    .input(verifyBaseDomainInput)
    .output(verifyBaseDomainOutput),

  cloudflareListZones: oc
    .errors({
      INVALID_INPUT: { status: 400, message: "Invalid Cloudflare token" as const },
    })
    .meta({
      path: `${basePath}/cloudflare/zones`,
      tag,
      method: "POST",
    })
    .input(listCloudflareZonesInput)
    .output(z.array(cloudflareZoneSchema)),

  setCloudflareConfig: oc
    .meta({
      path: `${basePath}/{organizationId}/settings/cloudflare`,
      tag,
      method: "PATCH",
    })
    .input(setCloudflareConfigInput)
    .output(organizationSettingsSchema),

  autoConfigureBaseDomain: oc
    .errors({
      INVALID_INPUT: {
        status: 400,
        message: "Cloudflare token / zone / base domain not configured" as const,
      },
    })
    .meta({
      path: `${basePath}/{organizationId}/settings/base-domain/auto-configure`,
      tag,
      method: "POST",
    })
    .input(autoConfigureDomainInput)
    .output(autoConfigureDomainOutput),

  // ── Control-plane domain ───────────────────────────────────────────
  controlPlaneDomain: oc
    .meta({
      path: `${basePath}/{organizationId}/control-plane-domain`,
      tag,
      method: "GET",
    })
    .input(getOrganizationSettingsInput)
    .output(controlPlaneDomainSchema),

  setControlPlaneDomain: oc
    .meta({
      path: `${basePath}/{organizationId}/control-plane-domain`,
      tag,
      method: "PATCH",
    })
    .input(setControlPlaneDomainInput)
    .output(controlPlaneDomainSchema),

  verifyControlPlaneDomain: oc
    .meta({
      path: `${basePath}/{organizationId}/control-plane-domain/verify`,
      tag,
      method: "POST",
    })
    .input(verifyBaseDomainInput)
    .output(verifyControlPlaneDomainOutput),

  autoConfigureControlPlaneDomain: oc
    .errors({
      INVALID_INPUT: {
        status: 400,
        message: "Cloudflare / control-plane domain / server IP not configured" as const,
      },
    })
    .meta({
      path: `${basePath}/{organizationId}/control-plane-domain/auto-configure`,
      tag,
      method: "POST",
    })
    .input(autoConfigureDomainInput)
    .output(autoConfigureControlPlaneOutput),

  // ── Instance network + edge defaults ───────────────────────────────
  getServerIp: oc
    .meta({ path: `${basePath}/{organizationId}/instance/server-ip`, tag, method: "GET" })
    .input(getOrganizationSettingsInput)
    .output(serverIpSchema),

  setServerIp: oc
    .meta({ path: `${basePath}/{organizationId}/instance/server-ip`, tag, method: "PATCH" })
    .input(setServerIpInput)
    .output(serverIpSchema),

  getEdgeOptions: oc
    .meta({ path: `${basePath}/{organizationId}/instance/edge-options`, tag, method: "GET" })
    .input(getOrganizationSettingsInput)
    .output(edgeOptionsSchema),

  setEdgeOptions: oc
    .meta({ path: `${basePath}/{organizationId}/instance/edge-options`, tag, method: "PATCH" })
    .input(setEdgeOptionsInput)
    .output(edgeOptionsSchema),

  // ── Runtime configuration ──────────────────────────────────────────
  getAccessSettings: oc
    .meta({ path: `${basePath}/{organizationId}/instance/access`, tag, method: "GET" })
    .input(getOrganizationSettingsInput)
    .output(accessSettingsSchema),

  setAccessSettings: oc
    .meta({ path: `${basePath}/{organizationId}/instance/access`, tag, method: "PATCH" })
    .input(setAccessSettingsInput)
    .output(accessSettingsSchema),

  getSignInMethods: oc
    .meta({ path: `${basePath}/{organizationId}/instance/sign-in-methods`, tag, method: "GET" })
    .input(getOrganizationSettingsInput)
    .output(signInMethodsSchema),

  setSignInMethods: oc
    .meta({ path: `${basePath}/{organizationId}/instance/sign-in-methods`, tag, method: "PATCH" })
    .input(setSignInMethodsInput)
    .output(signInMethodsSchema),

  listSocialProviders: oc
    .meta({ path: `${basePath}/{organizationId}/instance/social-providers`, tag, method: "GET" })
    .input(getOrganizationSettingsInput)
    .output(z.array(socialProviderSchema)),

  setSocialProvider: oc
    .meta({ path: `${basePath}/{organizationId}/instance/social-providers`, tag, method: "PATCH" })
    .input(setSocialProviderInput)
    .output(z.array(socialProviderSchema)),

  getCrowdsecSettings: oc
    .meta({ path: `${basePath}/{organizationId}/instance/crowdsec`, tag, method: "GET" })
    .input(getOrganizationSettingsInput)
    .output(crowdsecSettingsSchema),

  setCrowdsecSettings: oc
    .meta({ path: `${basePath}/{organizationId}/instance/crowdsec`, tag, method: "PATCH" })
    .input(setCrowdsecSettingsInput)
    .output(crowdsecSettingsSchema),

  getRuntimeSettings: oc
    .meta({ path: `${basePath}/{organizationId}/instance/runtime`, tag, method: "GET" })
    .input(getOrganizationSettingsInput)
    .output(runtimeSettingsSchema),

  setRuntimeSettings: oc
    .meta({ path: `${basePath}/{organizationId}/instance/runtime`, tag, method: "PATCH" })
    .input(setRuntimeSettingsInput)
    .output(runtimeSettingsSchema),

  // ── Members + invitations ──────────────────────────────────────────
  listMembers: oc
    .meta({ path: `${basePath}/{organizationId}/members`, tag, method: "GET" })
    .input(orgRef)
    .output(z.array(memberViewSchema)),

  removeMember: oc
    .errors({ NOT_FOUND: { status: 404, message: "Member not found" as const } })
    .meta({ path: `${basePath}/{organizationId}/members`, tag, method: "DELETE" })
    .input(removeMemberInput)
    .output(z.object({ ok: z.boolean() })),

  updateMemberRole: oc
    .errors({ NOT_FOUND: { status: 404, message: "Member not found" as const } })
    .meta({ path: `${basePath}/{organizationId}/members/role`, tag, method: "PATCH" })
    .input(updateMemberRoleInput)
    .output(memberViewSchema),

  listInvitations: oc
    .meta({ path: `${basePath}/{organizationId}/invitations`, tag, method: "GET" })
    .input(orgRef)
    .output(z.array(invitationViewSchema)),

  cancelInvitation: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Invitation not found" as const },
    })
    .meta({
      path: `${basePath}/{organizationId}/invitations/cancel`,
      tag,
      method: "POST",
    })
    .input(cancelInvitationInput)
    .output(z.object({ ok: z.boolean() })),
};
