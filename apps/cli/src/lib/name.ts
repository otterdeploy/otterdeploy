/**
 * The name this process was invoked as.
 *
 * The CLI ships two bins pointing at the same bundle — `otterdeploy` and the
 * short `otd` (see package.json). Every hint, usage line and completion script
 * echoes back whichever one the user actually typed, so `otd whoami` never
 * answers with "run `otterdeploy login`". A hint you cannot copy-paste is worse
 * than no hint.
 *
 * `od` is deliberately NOT a bin: it is POSIX octal-dump (`/usr/bin/od`) on
 * every macOS and Linux box, and a global npm bin directory usually precedes
 * `/usr/bin` on PATH — claiming it would shadow a standard tool for anything
 * else running in that shell.
 */

import { basename } from "node:path";

/** Bins declared in package.json. Anything else is not a name we answer to. */
const KNOWN_NAMES = new Set(["otterdeploy", "otd"]);

const CANONICAL = "otterdeploy";

function resolve(): string {
  const argv1 = process.argv[1];
  if (!argv1) return CANONICAL;
  // Strip the extension so a direct `bun run src/index.ts` doesn't yield
  // "index.ts". npm's Windows cmd-shim invokes `node dist/index.js`, which also
  // lands here and correctly falls back to the canonical name.
  const name = basename(argv1).replace(/\.(js|mjs|cjs|ts)$/, "");
  return KNOWN_NAMES.has(name) ? name : CANONICAL;
}

let cached: string | null = null;

/** e.g. `otd` or `otterdeploy`. Resolved once — argv never changes mid-run. */
export function invokedName(): string {
  cached ??= resolve();
  return cached;
}

/** Reset the cache. Tests only, which rewrite `process.argv`. */
export function resetInvokedName(): void {
  cached = null;
}

/**
 * A runnable command string for hints: `cmd("login <url>")` → "otd login <url>".
 * Always prefer this over interpolating the name yourself.
 */
export function cmd(rest: string): string {
  return `${invokedName()} ${rest}`;
}
