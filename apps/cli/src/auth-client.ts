import { createAuthClient } from "better-auth/client";
import { deviceAuthorizationClient } from "better-auth/client/plugins";

// `client_id` we send to /device/code. The server's validateClient is a
// no-op today, but any future restriction can key off this string.
export const CLI_CLIENT_ID = "otterdeploy-cli";

export function createCliAuthClient(baseURL: string) {
  return createAuthClient({
    baseURL: `${baseURL.replace(/\/$/, "")}/api/auth`,
    plugins: [deviceAuthorizationClient()],
  });
}

export type CliAuthClient = ReturnType<typeof createCliAuthClient>;
