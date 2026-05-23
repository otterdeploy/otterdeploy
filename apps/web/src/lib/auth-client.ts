import { apiKeyClient } from "@better-auth/api-key/client";
import { env } from "@otterstack/env/web";
import {
  adminClient,
  magicLinkClient,
  organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: env.VITE_SERVER_URL,
  plugins: [
    organizationClient(),
    adminClient(),
    magicLinkClient(),
    apiKeyClient(),
  ],
});

export type AuthClient = typeof authClient;
export type Session = NonNullable<
  Awaited<ReturnType<typeof authClient.getSession>>["data"]
>;
export type SessionUser = Session["user"];
