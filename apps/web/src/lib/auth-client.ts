import { apiKeyClient } from "@better-auth/api-key/client";
import { env } from "@otterdeploy/env/web";
import {
  adminClient,
  deviceAuthorizationClient,
  magicLinkClient,
  organizationClient,
  twoFactorClient,
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
    // TOTP two-factor. On a 2FA-enabled sign-in, the server returns
    // `twoFactorRedirect`; the sign-in form handles the challenge inline rather
    // than via `onTwoFactorRedirect`, so no redirect callback is configured.
    twoFactorClient(),
  ],
});

export type AuthClient = typeof authClient;
export type Session = NonNullable<
  Awaited<ReturnType<typeof authClient.getSession>>["data"]
>;
export type SessionUser = Session["user"];
