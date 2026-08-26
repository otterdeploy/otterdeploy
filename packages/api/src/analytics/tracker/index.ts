import { Result } from "better-result";

import { install } from "./otter.js";

/** Route the browser tracker is served from (docs/designs/web-analytics.md section 3). */
export const TRACKER_PATH = "/a/otter.js";
/** Public collect endpoint the tracker POSTs batches to. */
export const COLLECT_PATH = "/a/c";

export interface TrackerScript {
  /** Minified (when Bun.Transpiler is available) browser script. */
  body: string;
  /** Strong ETag, quoted, derived from `body`. */
  etag: string;
}

// The production server is a tsdown/rolldown bundle: a `with { type: "text" }`
// import is parsed as a module by rolldown (build error) and `Bun.file(...)` has
// nothing to read once dist/ is the only thing shipped. Serializing the real
// `install` function keeps otter.js a normal module for every bundler while the
// wire artifact stays exactly its source text.
function wrapSource(): string {
  return (
    `(function(w){try{(${install.toString()})(w)}catch(e){}})` +
    `(typeof window!=="undefined"?window:globalThis);\n`
  );
}

function minify(source: string): string {
  if (typeof Bun === "undefined") return source;
  const minified = Result.try({
    try: () => new Bun.Transpiler({ loader: "js", minifyWhitespace: true }).transformSync(source),
    catch: (cause) => new Error("tracker minify failed", { cause }),
  });
  return minified.isOk() && minified.value.length > 0 ? minified.value : source;
}

function etagOf(body: string): string {
  if (typeof Bun === "undefined") {
    let hash = 0;
    for (let i = 0; i < body.length; i++) hash = (hash * 31 + body.charCodeAt(i)) | 0;
    return `"${(hash >>> 0).toString(16)}"`;
  }
  return `"${Bun.hash(body).toString(16)}"`;
}

// Cached on globalThis (same reasoning as edge-logs/persist.ts) so `--hot`
// reloads and every import site share one minified artifact + etag.
declare global {
  var __otterTrackerScript: TrackerScript | undefined;
}

export async function getTrackerScript(): Promise<TrackerScript> {
  if (globalThis.__otterTrackerScript) return globalThis.__otterTrackerScript;
  const body = minify(wrapSource());
  const script: TrackerScript = { body, etag: etagOf(body) };
  globalThis.__otterTrackerScript = script;
  return script;
}

/** The one-line install snippet shown on the Setup tab. */
export function buildSnippet(origin: string, publicKey: string): string {
  const base = origin.replace(/\/+$/, "");
  return `<script async src="${base}${TRACKER_PATH}" data-key="${publicKey}"></script>`;
}
