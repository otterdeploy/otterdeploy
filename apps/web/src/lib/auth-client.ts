import { apiKeyClient } from "@better-auth/api-key/client";
import { env } from "@otterdeploy/env/web";
import {
  adminClient,
  deviceAuthorizationClient,
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
    deviceAuthorizationClient(),
  ],
});

export type AuthClient = typeof authClient;
export type Session = NonNullable<
  Awaited<ReturnType<typeof authClient.getSession>>["data"]
>;
export type SessionUser = Session["user"];
