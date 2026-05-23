import { db } from "@otterstack/db";
import * as schema from "@otterstack/db/schema/auth";
import { env } from "@otterstack/env/server";
import { createId, type IdPrefix } from "@otterstack/shared/id";
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
      generateId: ({ model }) => createId(model as IdPrefix),
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
      teams: { enabled: false },
    }),
  ],
});
