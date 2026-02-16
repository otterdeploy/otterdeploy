import { db } from "@otterstack/db";
import * as schema from "@otterstack/db/schema/auth";
import { env } from "@otterstack/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { deviceAuthorization, admin, organization, apiKey, twoFactor } from "better-auth/plugins";
import { getOrgAdapter, type OrganizationOptions } from "better-auth/plugins/organization";

const ORG_SLUG_MAX = 48;
const ORG_CREATE_MAX_ATTEMPTS = 12;

type SessionCreateHookContext = {
  context: {
    logger: {
      warn: (meta: unknown, message?: string) => void;
    };
    internalAdapter: {
      findUserById: (
        userId: string,
      ) => Promise<{
        id: string;
        name: string;
      } | null>;
    };
  };
};

function normalizeOrganizationName(name: string) {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return "My Organization";
  }
  return `${trimmed}'s Organization`;
}

function toSlug(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, ORG_SLUG_MAX)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "organization";
}

function isSessionCreateHookContext(value: unknown): value is SessionCreateHookContext {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (!("context" in value)) {
    return false;
  }
  return true;
}

function getOrganizationOptions(context: SessionCreateHookContext) {
  return (context.context as SessionCreateHookContext["context"] & {
    orgOptions?: OrganizationOptions;
  }).orgOptions;
}

async function ensureDefaultOrganizationForUser(
  context: SessionCreateHookContext,
  user: { id: string; name: string },
) {
  const orgOptions = getOrganizationOptions(context);
  const adapter = getOrgAdapter(context.context as Parameters<typeof getOrgAdapter>[0], orgOptions);
  const existingOrganizations = await adapter.listOrganizations(user.id);

  if (existingOrganizations.length > 0) {
    return existingOrganizations[0]!;
  }

  const organizationName = normalizeOrganizationName(user.name);
  const baseSlug = toSlug(organizationName);

  for (let attempt = 0; attempt < ORG_CREATE_MAX_ATTEMPTS; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const slug = `${baseSlug}${suffix}`.slice(0, ORG_SLUG_MAX).replace(/-+$/g, "");

    const existingBySlug = await adapter.findOrganizationBySlug(slug);
    if (existingBySlug) {
      continue;
    }

    try {
      const createdOrganization = await adapter.createOrganization({
        organization: {
          name: organizationName,
          slug,
          createdAt: new Date(),
        },
      });

      await adapter.createMember({
        organizationId: createdOrganization.id,
        userId: user.id,
        role: orgOptions?.creatorRole ?? "owner",
      });

      return createdOrganization;
    } catch (error) {
      context.context.logger.warn(
        { err: error, userId: user.id, slug },
        "Failed to create default organization, retrying with next slug",
      );
    }
  }

  throw new Error("Unable to auto-create organization for user");
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",

    schema: schema,
  }),
  trustedOrigins: [env.CORS_ORIGIN],
  emailAndPassword: {
    enabled: true,
  },
  advanced: {
    defaultCookieAttributes: {
      sameSite: "none",
      secure: true,
      httpOnly: true,
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session, context) => {
          if (!isSessionCreateHookContext(context)) {
            return;
          }

          if (session.activeOrganizationId) {
            return;
          }

          const user = await context.context.internalAdapter.findUserById(session.userId);
          if (!user) {
            return;
          }

          const organization = await ensureDefaultOrganizationForUser(context, {
            id: user.id,
            name: user.name ?? "My Organization",
          });

          return {
            data: {
              ...session,
              activeOrganizationId: organization.id,
            },
          };
        },
      },
    },
  },
  plugins: [deviceAuthorization(), admin(), organization(), apiKey(), twoFactor()],
});
