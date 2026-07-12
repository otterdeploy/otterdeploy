#!/usr/bin/env bun
/**
 * Build the publishable, runtime-agnostic bundle: a single ESM file that runs
 * on Node (≥20) or Bun, with all workspace + npm dependencies inlined so the
 * published package has zero install-time dependencies. Sets the `node`
 * shebang and the executable bit so npm's `bin` linking works.
 */

import { $ } from "bun";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";

const OUT = "dist/index.js";

// `#!/usr/bin/env node` is the only shebang that runs on all three operating
// systems across every package manager:
//   - npm/pnpm/yarn (Win/mac/Linux): npm ships Node, and its Windows cmd-shim
//     turns this line into a `.cmd` that calls `node`. A `#!/bin/sh` polyglot
//     instead makes cmd-shim emit a shim that calls `/bin/sh`, which stock
//     Windows lacks — so npm-on-Windows breaks. (Verified with cmd-shim@6.)
//   - `bun add -g`: symlinks straight to this file, so the OS honors the
//     shebang — Node is used when present.
//   - Bun-only boxes with no Node: `bun add -g` can't work (no interpreter the
//     shebang can name is present in BOTH a Bun-only and a Node-only install),
//     but `bunx @otterdeploy/cli` runs under Bun and ignores the shebang. The
//     README points Bun-only users there.
const NODE_SHEBANG = "#!/usr/bin/env node";

// The --define marks this as the published bundle so the dev-only localhost TLS
// relaxation (lib/local-tls.ts) is dead-code-eliminated — the shipped CLI must
// contain no certificate-verification bypass.
await $`bun build --target=node --format=esm --minify --sourcemap=none --define process.env.OTTERDEPLOY_BUNDLED='"1"' ./src/index.ts --outfile ${OUT}`;

// bun build preserves the source's `#!/usr/bin/env bun` shebang; swap it for
// node so the npm bin runs under the user's Node.
const body = readFileSync(OUT, "utf8");
const fixed = body.startsWith("#!")
  ? NODE_SHEBANG + body.slice(body.indexOf("\n"))
  : `${NODE_SHEBANG}\n${body}`;
writeFileSync(OUT, fixed);
chmodSync(OUT, 0o755);

console.log(`Built ${OUT}`);
