import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import type { IdPrefix } from "@otterdeploy/shared/id";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";

import { db } from "@otterdeploy/db";
import * as schema from "@otterdeploy/db/schema";
import { member, session as sessionTbl } from "@otterdeploy/db/schema/auth";
import { OrganizationInvitationEmail, sendEmail } from "@otterdeploy/email";
import { env } from "@otterdeploy/env/server";
import { betterAuth } from "better-auth";
import { apiKey } from "@better-auth/api-key";
import { log } from "evlog";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, deviceAuthorization, organization } from "better-auth/plugins";

import { ac, roles } from "./permissions";

/**
 * Pick the org to make active on a fresh session. Prefers the org from the
 * user's most recent prior session that is still a current membership;
 * falls back to their oldest membership; returns null if they have none
 * (the /_app layout will route them to onboarding).
 */
async function resolveActiveOrganizationId(
  userId: string,
): Promise<string | null> {
  const [lastActive] = await db
    .select({ orgId: sessionTbl.activeOrganizationId })
    .from(sessionTbl)
    .innerJoin(
      member,
      and(
        eq(member.userId, sessionTbl.userId),
        eq(member.organizationId, sessionTbl.activeOrganizationId),
      ),
    )
    .where(
      and(
        eq(sessionTbl.userId, userId),
        isNotNull(sessionTbl.activeOrganizationId),
      ),
    )
    .orderBy(desc(sessionTbl.updatedAt))
    .limit(1);

  if (lastActive?.orgId) return lastActive.orgId;

  const [firstMembership] = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt))
    .limit(1);

  return firstMembership?.organizationId ?? null;
}

export const auth = betterAuth({
  appName: "otterdeploy",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: schema,
  }),
  rateLimit: {
    enabled: true,
    window: 60, // time window in seconds
    max: 100, // max requests in the window
  },
  // `experimental.joins` would let the Drizzle adapter use the RQB
  // v2 query builder (`db.query.user.findFirst({ with: { session } })`).
  // That requires `relations` passed to drizzle() in
  // packages/db/src/client.ts, which is intentionally not wired today.
  // The adapter falls back to plain selects without it.
  trustedOrigins: env.CORS_ORIGIN,
  emailAndPassword: {
    enabled: true,
  },
  advanced: {
    defaultCookieAttributes: {
      sameSite: "none",
      secure: true,
      httpOnly: true,
    },
    database: {
      // BA's "team" model is backed by the `project` table — emit project_ ids.
      generateId: ({ model }) =>
        createId((model === "team" ? ID_PREFIX.project : model) as IdPrefix),
    },
    ipAddress: {
      ipAddressHeaders: ["cf-connecting-ip"], // Cloudflare specific header example
    },
  },
  hooks: {},
  databaseHooks: {
    session: {
      create: {
        before: async (session) => ({
          data: {
            ...session,
            activeOrganizationId: await resolveActiveOrganizationId(
              session.userId,
            ),
          },
        }),
      },
    },
  },

  plugins: [
    // Honors `Authorization: Bearer <token>` on auth.api.getSession.
    // Required by deviceAuthorization so CLI clients can authenticate.
    bearer(),
    // Workspace-scoped API keys. `references: "organization"` means a key is
    // owned by an org (referenceId = organizationId), not an individual user,
    // so any owner/admin can manage the workspace's keys — matching how every
    // other resource here is org-scoped. Keys are hashed at rest; the plaintext
    // is returned only once from `create`. `enableMetadata` lets us tag keys,
    // and `requireName` forces a human label so the list stays identifiable.
    // The matching `apikey` table lives in db/schema/auth.ts (schema: {} uses
    // the plugin's default field names).
    apiKey({
      references: "organization",
      defaultPrefix: "otter_",
      enableMetadata: true,
      requireName: true,
      schema: {},
    }),
    // OAuth 2.0 Device Authorization Grant (RFC 8628). The CLI requests a
    // user_code, prints it; the user approves it in a browser at the
    // verificationUri; the CLI polls /device/token and receives an
    // access_token used with bearer() above.
    deviceAuthorization({
      // Absolute URL pointed at the WEB origin (where /device is rendered),
      // not the API origin. In prod they're typically the same host; in dev
      // they diverge (api.otterdeploy.localhost vs. web.otterdeploy.localhost),
      // so a relative path would send users to the API server's /device,
      // which doesn't exist. We use the first CORS_ORIGIN as the web host.
      verificationUri: `${(env.CORS_ORIGIN[0] ?? env.BETTER_AUTH_URL).replace(/\/$/, "")}/device`,
      // Accept any client_id for now — the CLI sends "otterdeploy-cli".
      // Tighten when we ship third-party integrations.
      validateClient: async () => true,
      // Required by the plugin's option schema even though the docs
      // example omits it — `schema` is declared without `.optional()`,
      // so leaving it out throws a ZodError at registration. Empty
      // object means "use the plugin's default table + field names"
      // (we hand-rolled the matching deviceCode table in db/schema/auth.ts).
      schema: {},
    }),
    organization({
      allowUserToCreateOrganization: true,
      organizationLimit: 10,
      // Invitations: an invite link expires after 48h if unaccepted; once
      // accepted, membership is permanent until revoked. Re-inviting the same
      // email cancels the prior pending invite so duplicates don't pile up.
      invitationExpiresIn: 60 * 60 * 48,
      cancelPendingInvitationsOnReInvite: true,
      sendInvitationEmail: async (data) => {
        // Build the accept link against the WEB origin (where /accept-invite
        // renders), not the API origin — same resolution as the device flow.
        const webOrigin = (env.CORS_ORIGIN[0] ?? env.BETTER_AUTH_URL).replace(
          /\/$/,
          "",
        );
        const inviteUrl = `${webOrigin}/accept-invite/${data.invitation.id}`;
        // Non-fatal by design: the invitation row is already persisted before
        // this runs, so a failed email send (e.g. missing/placeholder
        // RESEND_API_KEY in dev) must NOT fail inviteMember. Swallow the error
        // and log the accept link for out-of-band delivery; the invite still
        // shows in the org's pending list either way.
        try {
          await sendEmail({
            to: data.email,
            subject: `Join ${data.organization.name} on otterdeploy`,
            react: OrganizationInvitationEmail({
              organizationName: data.organization.name,
              inviterName: data.inviter.user.name,
              inviteUrl,
              role: String(data.role ?? "member"),
            }),
          });
        } catch (error) {
          log.warn({
            invite: {
              status: "email-failed",
              email: data.email,
              // Logged so the operator can deliver the link out-of-band when
              // email isn't configured (e.g. placeholder RESEND_API_KEY in dev).
              inviteUrl,
              detail: error instanceof Error ? error.message : String(error),
            },
          });
        }
      },
      // RBAC: custom access-control statements + owner/admin/member roles
      // (packages/auth/src/permissions.ts). `auth.api.hasPermission` resolves
      // the active member's role against these — no manual member lookups.
      ac,
      roles,
      teams: {
        enabled: true,
        // Don't auto-create a "default project" on org create — our project
        // schema requires slug+environmentId, and projects are created
        // explicitly via the CreateProjectDialog flow (env first, then project).
        defaultTeam: { enabled: false },
      },
      schema: {
        team: {
          modelName: "project",
          additionalFields: {
            slug: { type: "string", required: true },
            environmentId: { type: "string", required: true },
          },
        },
      },
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
