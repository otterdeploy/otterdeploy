import { and, asc, desc, eq, isNotNull } from "drizzle-orm";

import { db } from "@otterstack/db";
import * as schema from "@otterstack/db/schema";
import { member, session as sessionTbl } from "@otterstack/db/schema/auth";
import { env } from "@otterstack/env/server";
import { createId, ID_PREFIX, type IdPrefix } from "@otterstack/shared/id";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";

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
  appName: "otterstack",
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
