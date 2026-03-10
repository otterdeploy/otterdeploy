import { createAuthClient } from "better-auth/client";
import {
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [organizationClient(), twoFactorClient()],
});

export type AuthClient = typeof authClient;
