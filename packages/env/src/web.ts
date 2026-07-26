import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    // API base URL. Optional at build time — a self-hosted install's public URL
    // isn't known when `vite build` bakes this in, and the server serves the
    // built SPA from the SAME origin (apps/server/Dockerfile stages it at
    // ./public). So when it's unset we resolve to the page's own origin at
    // runtime, right here in the schema, and every reader gets a ready-to-use
    // string from `env.VITE_SERVER_URL` (never undefined). The transform runs
    // when this module first loads: in the browser that's runtime, so
    // `globalThis.location` exists; the optional access keeps a non-browser
    // build/eval from throwing (the "" it yields is never used off-browser).
    // Set the env only when the web and
    // API are on different origins — dev (web :3001 / server :3000) or any
    // split-origin deploy.
    VITE_SERVER_URL: z
      .url()
      .optional()
      .transform(
        (v) => v ?? (globalThis as { location?: { origin?: string } }).location?.origin ?? "",
      ),
    // NOTE: VITE_AUTH_SOCIAL_PROVIDERS used to live here, listing the enabled
    // SSO providers so the sign-in form knew which buttons to render. It was
    // removed because it was baked in at `vite build`: a self-hoster running
    // the published image could not turn SSO on without rebuilding the SPA.
    // The sign-in page now reads the live provider list at runtime from
    // /api/auth/public-config. Configure providers in Settings → Instance.
  },
  runtimeEnv: import.meta.env,
  emptyStringAsUndefined: true,
});
