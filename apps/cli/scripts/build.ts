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
const NODE_SHEBANG = "#!/usr/bin/env node";

await $`bun build --target=node --format=esm --minify --sourcemap=none ./src/index.ts --outfile ${OUT}`;

// bun build preserves the source's `#!/usr/bin/env bun` shebang; swap it for
// node so the npm bin runs under the user's Node.
const body = readFileSync(OUT, "utf8");
const fixed = body.startsWith("#!")
  ? NODE_SHEBANG + body.slice(body.indexOf("\n"))
  : `${NODE_SHEBANG}\n${body}`;
writeFileSync(OUT, fixed);
chmodSync(OUT, 0o755);

console.log(`Built ${OUT}`);
