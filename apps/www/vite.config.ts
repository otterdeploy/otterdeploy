import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import mdx from "fumadocs-mdx/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite-plus";

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
      // SSR every route at request time. Build-time prerender is off: the docs
      // source eagerly loads the live OpenAPI spec, which isn't reachable
      // during a build, and page enumeration for the `/docs/$` splat isn't
      // wired. Revisit once those are addressed.
      prerender: { enabled: false },
    }),
    react(),
    // Pinned to `cloudflare-module` rather than left to auto-detection: the
    // site deploys to Workers on every path (CI, `bun run deploy`, a local
    // `vite build`), so what you build locally is what ships. The preset emits
    // `.output/server/index.mjs` + `.output/public`, merges apps/www/
    // wrangler.jsonc into `.output/server/wrangler.json`, and enables the
    // `nodejs_compat` flag.
    // `noExternals` bundles every dependency into the server output instead of
    // tracing them into `.output/server/node_modules` — required on Workers,
    // which has no node_modules at runtime. It also fixes the Fumadocs/tslib
    // cluster, which traces incompletely (tslib's `modules/index.js` goes
    // missing) and 500s every SSR route.
    nitro({
      // `cloudflare-module`, not its std alias `cloudflare_workers` — nitro
      // 3.0.260603-beta fails to resolve the alias at any compatibilityDate.
      preset: "cloudflare-module",
      compatibilityDate: "2026-05-28",
      noExternals: true,
    }),
  ],
  resolve: {
    tsconfigPaths: true,
    // Force every tslib import (bare *and* deep subpaths) to its ESM build.
    // Two failures this prevents, both of which 500 every SSR route — landing
    // page included:
    //   1. Bare `tslib`: rolldown's CJS-interop wrapper makes the named helpers
    //      (`__extends`, `__assign`, …) come back undefined → "Cannot
    //      destructure property '__extends'".
    //   2. Deep `tslib/modules/index.js` (from @fumadocs/api-docs): left
    //      external, nitro traces only a subset of tslib's files so it resolves
    //      to a missing module at runtime.
    // `tslib.es6.mjs` re-exports all helpers as real named exports, so pointing
    // every specifier at it bundles them and skips the interop wrapper. The
    // regex captures the subpath but the replacement intentionally drops it.
    alias: [{ find: /^tslib(\/.*)?$/, replacement: "tslib/tslib.es6.mjs" }],
  },
  envDir: "../../",
});
