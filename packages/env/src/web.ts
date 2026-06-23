import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_SERVER_URL: z.url(),
    // Comma list of enabled social sign-in providers (e.g. "github,google"),
    // mirroring the server's configured socialProviders. Drives which SSO
    // buttons render on the sign-in/up forms. Unset ⇒ no social buttons.
    VITE_AUTH_SOCIAL_PROVIDERS: z.string().optional(),
  },
  runtimeEnv: import.meta.env,
  emptyStringAsUndefined: true,
});
