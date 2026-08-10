import { auth } from "@otterdeploy/auth";
import { matchError, Result } from "better-result";

import { orgScopedProcedure, requirePermission } from "../..";

// Mutating org-settings endpoints require the `organization:update` permission
// (owner/admin). Reads stay open to any member.
const orgUpdateProcedure = requirePermission({ organization: ["update"] });

// Member/invitation management maps to better-auth's own org `member`/
// `invitation` statements: owner/admin manage, members can only list. The
// underlying auth.api calls ALSO re-check the session's role, so this is
// defence-in-depth + the API-key cap (keys are capped at the member role).
const orgMemberDelete = requirePermission({ member: ["delete"] });
const orgMemberUpdate = requirePermission({ member: ["update"] });
const orgInviteCancel = requirePermission({ invitation: ["cancel"] });

/** Shape better-auth's member row into the contract view (email/name live on
 *  the nested `user`). */
function toMemberView(m: {
  id: string;
  userId: string;
  role: string;
  createdAt: Date | string;
  user?: { email?: string | null; name?: string | null } | null;
}) {
  return {
    id: m.id,
    userId: m.userId,
    email: m.user?.email ?? "",
    name: m.user?.name ?? "",
    role: m.role,
    createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt),
  };
}

function toInvitationView(i: {
  id: string;
  email: string;
  role?: string | null;
  status: string;
  expiresAt?: Date | string | null;
}) {
  return {
    id: i.id,
    email: i.email,
    role: i.role ?? "member",
    status: i.status,
    expiresAt:
      i.expiresAt == null
        ? null
        : i.expiresAt instanceof Date
          ? i.expiresAt.toISOString()
          : String(i.expiresAt),
  };
}

import {
  autoConfigureBaseDomainViaCloudflare,
  getOrganizationSettings,
  listZonesForToken,
  saveOrganizationCloudflareConfig,
  updateOrganizationBaseDomain,
  verifyOrganizationBaseDomain,
} from "./handlers";
import { platformSettingsRouter } from "./platform-settings-router";

// Every handler below derives the org it acts on from `context.activeOrganizationId`
// (the caller's own session/API-key org), NEVER from `input.organizationId`.
// The path/input still carries `organizationId` (REST needs it in the URL,
// and the contract types it as required) but it is intentionally unused for
// authorization or data access, trusting it let one org's owner/admin
// read or mutate ANY other org's base domain, Cloudflare config, or member
// list just by editing the id in the request. See od-5j8.8.
export const organizationRouter = {
  settings: orgScopedProcedure.organization.settings.handler(async ({ context }) => {
    context.log.set({
      target: { type: "organization", id: context.activeOrganizationId },
    });
    const result = await getOrganizationSettings(context.activeOrganizationId);
    if (result.isErr()) throw result.error;
    return result.value;
  }),

  setBaseDomain: orgUpdateProcedure.organization.setBaseDomain.handler(
    async ({ input, context }) => {
      context.log.set({
        target: { type: "organization", id: context.activeOrganizationId },
        domain: { baseDomain: input.baseDomain },
      });
      const result = await updateOrganizationBaseDomain({
        organizationId: context.activeOrganizationId,
        baseDomain: input.baseDomain,
      });
      if (result.isErr()) throw result.error;
      return result.value;
    },
  ),

  verifyBaseDomain: orgUpdateProcedure.organization.verifyBaseDomain.handler(
    async ({ context }) => {
      context.log.set({
        target: { type: "organization", id: context.activeOrganizationId },
      });
      const result = await verifyOrganizationBaseDomain(context.activeOrganizationId);
      if (result.isErr()) throw result.error;
      context.log.set({
        verify: { ok: result.value.ok, reason: result.value.reason },
      });
      return result.value;
    },
  ),

  cloudflareListZones: orgScopedProcedure.organization.cloudflareListZones.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "organization" } });
      const result = await listZonesForToken(input.token);
      if (result.isErr()) {
        throw matchError(result.error, {
          CloudflareConfigError: (err) => errors.INVALID_INPUT({ message: err.message }),
        });
      }
      return result.value;
    },
  ),

  setCloudflareConfig: orgUpdateProcedure.organization.setCloudflareConfig.handler(
    async ({ input, context }) => {
      context.log.set({
        target: { type: "organization", id: context.activeOrganizationId },
        cloudflare: {
          zoneId: input.zoneId,
          tokenConfigured: input.token.length > 0,
        },
      });
      const result = await saveOrganizationCloudflareConfig({
        organizationId: context.activeOrganizationId,
        token: input.token,
        zoneId: input.zoneId,
      });
      if (result.isErr()) throw result.error;
      return result.value;
    },
  ),

  autoConfigureBaseDomain: orgUpdateProcedure.organization.autoConfigureBaseDomain.handler(
    async ({ context, errors }) => {
      context.log.set({
        target: { type: "organization", id: context.activeOrganizationId },
      });
      const result = await autoConfigureBaseDomainViaCloudflare(context.activeOrganizationId);
      if (result.isErr()) {
        throw matchError(result.error, {
          CloudflareConfigError: (err) => errors.INVALID_INPUT({ message: err.message }),
          OrganizationNotFoundError: (err) => err,
        });
      }
      context.log.set({
        autoConfigure: {
          ok: result.value.ok,
          verifyReason: result.value.verify.reason,
        },
      });
      return result.value;
    },
  ),

  // ─── Platform-wide settings (control-plane domain + email transport):
  //     see ./platform-settings-router
  ...platformSettingsRouter,

  // ─── Members + invitations (better-auth org plugin) ───────────────
  // organizationId passed to auth.api.* below is always context.activeOrganizationId,
  // never input.organizationId: better-auth's own handlers additionally
  // re-derive/re-check the caller's membership in that org, but we don't
  // rely on that alone: this router's own scope guard must hold on its own.
  listMembers: orgScopedProcedure.organization.listMembers.handler(async ({ context }) => {
    context.log.set({
      target: { type: "organization", id: context.activeOrganizationId },
    });
    const res = await Result.tryPromise({
      try: () =>
        auth.api.listMembers({
          query: { organizationId: context.activeOrganizationId },
          headers: context.headers,
        }),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    });
    if (res.isErr()) throw res.error;
    return (res.value.members ?? []).map(toMemberView);
  }),

  removeMember: orgMemberDelete.organization.removeMember.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "organization", id: context.activeOrganizationId },
      });
      const res = await Result.tryPromise({
        try: () =>
          auth.api.removeMember({
            body: {
              memberIdOrEmail: input.memberIdOrEmail,
              organizationId: context.activeOrganizationId,
            },
            headers: context.headers,
          }),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      });
      if (res.isErr()) throw errors.NOT_FOUND({ message: res.error.message });
      return { ok: true };
    },
  ),

  updateMemberRole: orgMemberUpdate.organization.updateMemberRole.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "organization", id: context.activeOrganizationId },
      });
      const res = await Result.tryPromise({
        try: () =>
          auth.api.updateMemberRole({
            body: {
              memberId: input.memberId,
              role: input.role,
              organizationId: context.activeOrganizationId,
            },
            headers: context.headers,
          }),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      });
      if (res.isErr()) throw errors.NOT_FOUND({ message: res.error.message });
      return toMemberView(res.value as Parameters<typeof toMemberView>[0]);
    },
  ),

  listInvitations: orgScopedProcedure.organization.listInvitations.handler(async ({ context }) => {
    context.log.set({
      target: { type: "organization", id: context.activeOrganizationId },
    });
    const res = await Result.tryPromise({
      try: () =>
        auth.api.listInvitations({
          query: { organizationId: context.activeOrganizationId },
          headers: context.headers,
        }),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    });
    if (res.isErr()) throw res.error;
    // Surface only still-actionable invites (pending), not accepted/expired.
    const list = (res.value ?? []) as Parameters<typeof toInvitationView>[0][];
    return list.filter((i) => i.status === "pending").map(toInvitationView);
  }),

  cancelInvitation: orgInviteCancel.organization.cancelInvitation.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "organization", id: context.activeOrganizationId },
      });
      const res = await Result.tryPromise({
        try: () =>
          auth.api.cancelInvitation({
            body: { invitationId: input.invitationId },
            headers: context.headers,
          }),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      });
      if (res.isErr()) throw errors.NOT_FOUND({ message: res.error.message });
      return { ok: true };
    },
  ),
};
