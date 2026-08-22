import { apiKeyClient } from "@better-auth/api-key/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { ssoClient } from "@better-auth/sso/client";
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
    // WebAuthn passkeys. Provides `signIn.passkey()` for the sign-in page and
    // the `passkey.*` management calls (add/list/rename/delete) the account
    // security page uses. The WebAuthn ceremony runs in the browser; the
    // server only ever sees public keys: see db/schema/auth.ts `passkey`.
    passkeyClient(),
    // Enterprise SSO. Provides `signIn.sso({ providerId })` for the sign-in
    // page's per-provider buttons (it also accepts an email domain, which the
    // page no longer uses: see features/auth/components/enterprise-sso-sign-in
    // for why a button beats an address field), plus the `sso.*`
    // provider-management calls the workspace settings page uses.
    // The list endpoint returns an already-redacted view (no client secret), so
    // the UI can read it directly. See db/schema/auth.ts `ssoProvider`.
    ssoClient(),
  ],
});

export type AuthClient = typeof authClient;
export type Session = NonNullable<Awaited<ReturnType<typeof authClient.getSession>>["data"]>;
export type SessionUser = Session["user"];
