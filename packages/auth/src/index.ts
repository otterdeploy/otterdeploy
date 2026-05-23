import { db } from "@otterstack/db";
import * as schema from "@otterstack/db/schema";
import { env } from "@otterstack/env/server";
import { createId, ID_PREFIX, type IdPrefix } from "@otterstack/shared/id";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";

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

  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      organizationLimit: 10,
      teams: { enabled: true },
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
