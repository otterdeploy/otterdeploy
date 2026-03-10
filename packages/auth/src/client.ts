import { createAuthClient } from "better-auth/client";
import {
  organizationClient,
  twoFactorClient,
  apiKeyClient,
} from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [organizationClient(), twoFactorClient(), apiKeyClient()],
});

export type AuthClient = typeof authClient;
