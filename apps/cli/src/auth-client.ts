import { createAuthClient } from "better-auth/client";
import { deviceAuthorizationClient } from "better-auth/client/plugins";

import { fetchFor } from "./lib/local-tls";

// `client_id` we send to /device/code. The server's validateClient is a
// no-op today, but any future restriction can key off this string.
export const CLI_CLIENT_ID = "otterdeploy-cli";

export function createCliAuthClient(baseURL: string) {
  return createAuthClient({
    baseURL: `${baseURL.replace(/\/$/, "")}/api/auth`,
    plugins: [deviceAuthorizationClient()],
    // Trust the dev portless proxy's local cert (Bun's fetch otherwise rejects
    // it); a no-op for remote hosts. See lib/local-tls.ts.
    fetchOptions: { customFetchImpl: fetchFor(baseURL) },
  });
}

export type CliAuthClient = ReturnType<typeof createCliAuthClient>;
