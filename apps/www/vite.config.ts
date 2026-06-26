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
    // Prerender is intentionally OFF: the OpenAPI reference fetches the live
    // server spec (OTTERSTACK_OPENAPI_SPEC_URL) at render time, which isn't
    // reachable during a Vercel/CI build. Pages SSR on-demand at runtime.
    tanstackStart(),
    react(),
    // Bundle tslib into the server output instead of leaving it external. When
    // external, nitro's dependency trace copies only `tslib.es6.mjs`, but Node
    // resolves bare `import "tslib"` via the package's `node` export condition
    // to `modules/index.js` — which isn't copied — so every SSR route 500s with
    // ERR_MODULE_NOT_FOUND (landing page included). Bundling resolves it at
    // build time. Paired with the ESM alias below so the bundled copy exposes
    // real named exports (`__extends`, …) rather than a CJS-interop wrapper.
    nitro({ noExternals: ["tslib"] }),
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
