#!/usr/bin/env bun
/**
 * Build the publishable, runtime-agnostic bundle: a single ESM file that runs
 * on Node (≥20) or Bun, with all workspace + npm dependencies inlined so the
 * published package has zero install-time dependencies. Sets a polyglot
 * shebang and the executable bit so npm's `bin` linking works.
 */

import { $ } from "bun";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";

const OUT = "dist/index.js";

// A sh/JS polyglot header so the bin runs under whatever runtime the user has,
// preferring Bun and falling back to Node — a plain `#!/usr/bin/env node`
// breaks bun-only installs (`bun add -g` on a box without Node exits with
// "env: 'node': No such file or directory"). Line 1 is the kernel shebang;
// line 2 is valid in both shells and JS: `sh` runs `:` (no-op) then execs the
// chosen runtime on this file, while Node/Bun strip the shebang line and read
// `':'` as a no-op string expression with the rest as a `//` comment.
const POLYGLOT_HEADER = [
  "#!/bin/sh",
  '\':\' //; exec "$(command -v bun || command -v node)" "$0" "$@"',
].join("\n");

// The --define marks this as the published bundle so the dev-only localhost TLS
// relaxation (lib/local-tls.ts) is dead-code-eliminated — the shipped CLI must
// contain no certificate-verification bypass.
await $`bun build --target=node --format=esm --minify --sourcemap=none --define process.env.OTTERDEPLOY_BUNDLED='"1"' ./src/index.ts --outfile ${OUT}`;

// bun build preserves the source's `#!/usr/bin/env bun` shebang; swap it for
// the polyglot header so the npm bin runs under Bun or Node.
const body = readFileSync(OUT, "utf8");
const fixed = body.startsWith("#!")
  ? POLYGLOT_HEADER + body.slice(body.indexOf("\n"))
  : `${POLYGLOT_HEADER}\n${body}`;
writeFileSync(OUT, fixed);
chmodSync(OUT, 0o755);

console.log(`Built ${OUT}`);
