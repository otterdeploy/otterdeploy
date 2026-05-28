import { and, asc, desc, eq, isNotNull } from "drizzle-orm";

import { db } from "@otterdeploy/db";
import * as schema from "@otterdeploy/db/schema";
import { member, session as sessionTbl } from "@otterdeploy/db/schema/auth";
import { env } from "@otterdeploy/env/server";
import { createId, ID_PREFIX, type IdPrefix } from "@otterdeploy/shared/id";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, deviceAuthorization, organization } from "better-auth/plugins";

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
  experimental: {
    joins: true,
  },
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
