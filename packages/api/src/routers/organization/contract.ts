/**
 * Organization-scoped settings contract.
 *
 * The `organization` row itself is owned by better-auth (id/name/slug/logo/
 * metadata/createdAt) — this router exposes the otterdeploy-specific columns
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

const tag = "organization";
const basePath = "/organizations";

// FQDN regex — lowercase, labels of 1–63 chars, dot-separated, ends in
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
  // The token itself is never returned — we send a `cloudflareTokenConfigured`
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
   *  committing — operator can see the zone they'd pick before saving. */
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
  /** Cloudflare record IDs we created/updated — surfaced so the operator
   *  knows exactly which records are now under otterdeploy management. */
  txtRecordId: z.string().nullable(),
  aRecordId: z.string().nullable(),
  /** Outcome of the verify step that runs after DNS is in place. Lets
   *  the UI show "Verified" or "DNS created, still propagating" without
   *  a separate roundtrip. */
  verify: z.object({
    ok: z.boolean(),
    reason: z.enum([
      "ok",
      "no-record",
      "value-mismatch",
      "lookup-failed",
      "missing-token",
    ]),
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
  /** TXT values the resolver actually returned — empty when no record
   *  exists. Drives "we saw X, expected Y" diagnostics. */
  found: z.array(z.string()),
  reason: z.enum([
    "ok",
    "no-record",
    "value-mismatch",
    "lookup-failed",
    "missing-token",
  ]),
  errorMessage: z.string().optional(),
  /** Echo back the updated settings on success so the UI doesn't need a
   *  separate refetch. Null on failure (no state change happened). */
  settings: organizationSettingsSchema.nullable(),
});

// ─── Outbound email transport (platform-wide) ───────────────────────
// Stored on the platform_settings singleton; surfaced here under the org
// settings the operator already manages. Single-tenant beta: any org
// owner/admin edits the one install-wide transport. Secrets are write-only —
// reads return `*Configured` booleans, never the key/password.
const emailProviderEnum = z.enum(["resend", "smtp"]);

const emailSettingsSchema = z.object({
  provider: emailProviderEnum.nullable(),
  from: z.string().nullable(),
  resendConfigured: z.boolean(),
  smtpHost: z.string().nullable(),
  smtpPort: z.number().nullable(),
  smtpSecure: z.boolean().nullable(),
  smtpUser: z.string().nullable(),
  smtpPasswordConfigured: z.boolean(),
  envConfigured: z.boolean(),
});

const getEmailSettingsInput = z.object({
  organizationId: organizationIdField,
});

const setEmailSettingsInput = z.object({
  organizationId: organizationIdField,
  provider: emailProviderEnum.nullable(),
  from: z.string().trim().max(320).nullable(),
  // Write-only secrets: a string sets it, `null` clears it, omitted leaves it.
  resendApiKey: z.string().min(1).nullable().optional(),
  smtpHost: z.string().trim().max(255).nullable(),
  smtpPort: z.number().int().positive().max(65535).nullable(),
  smtpSecure: z.boolean().nullable(),
  smtpUser: z.string().trim().max(255).nullable(),
  smtpPassword: z.string().min(1).nullable().optional(),
});

const testEmailInput = z.object({
  organizationId: organizationIdField,
  to: z.email(),
});

const testEmailOutput = z.object({
  ok: z.boolean(),
  error: z.string().nullable(),
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

  getEmailSettings: oc
    .meta({ path: `${basePath}/{organizationId}/email`, tag, method: "GET" })
    .input(getEmailSettingsInput)
    .output(emailSettingsSchema),

  setEmailSettings: oc
    .meta({ path: `${basePath}/{organizationId}/email`, tag, method: "PATCH" })
    .input(setEmailSettingsInput)
    .output(emailSettingsSchema),

  testEmail: oc
    .meta({ path: `${basePath}/{organizationId}/email/test`, tag, method: "POST" })
    .input(testEmailInput)
    .output(testEmailOutput),

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
