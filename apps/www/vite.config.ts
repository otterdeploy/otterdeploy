import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import mdx from "fumadocs-mdx/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    allowedHosts: ["*"],
    // oxlint-disable-next-line node/no-process-env
    port: Number(process.env.PORT) || 3002,
  },
  plugins: [
    mdx(),
    tailwindcss(),
    tanstackStart({
      // SSR every route at request time (Vercel Node functions). Build-time
      // prerender is off: the docs source eagerly loads the live OpenAPI spec,
      // which isn't reachable during a Vercel build, and page enumeration for
      // the `/docs/$` splat isn't wired. Revisit once those are addressed.
      prerender: { enabled: false },
    }),
    react(),
    // Nitro auto-selects the `vercel` preset in Vercel's build env (it sets
    // `VERCEL=1`), emitting `.vercel/output` (Build Output API v3). Locally,
    // `vite build` defaults to the node-server preset. compatibilityDate pins
    // Vercel's modern function/runtime features.
    // `noExternals` bundles every dependency into the server output instead of
    // tracing them into `.output/server/node_modules`. The Fumadocs/tslib
    // cluster otherwise traces incompletely (tslib's `modules/index.js` goes
    // missing), and a fully bundled server is self-contained for any Node host.
    nitro({ compatibilityDate: "2025-07-15", noExternals: true }),
  ],
  resolve: {
    tsconfigPaths: true,
    alias: {
      // `aria-hidden` / `react-remove-scroll` (transitive via Fumadocs UI
      // dialogs + scroll-lock) import tslib's `__extends` helper. Nitro's
      // rolldown CJS interop resolves `__toESM(tslib).default` to undefined, so
      // the SSR bundle crashes at `const { __extends } = tslib`. Pin tslib to
      // its ESM build so the named helpers resolve directly.
      tslib: "tslib/tslib.es6.mjs",
    },
  },
  envDir: "../../",
});
