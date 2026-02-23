import { env } from "@otterdeploy/env/web";
import { createAuthClient } from "better-auth/react";
import { organizationClient, deviceAuthorizationClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: env.VITE_SERVER_URL,
  plugins: [organizationClient(), deviceAuthorizationClient()],
});
