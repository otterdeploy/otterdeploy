/**
 * Post-processing of the BuildKit plan railpack writes at `prepare` time.
 *
 * Railpack has no CLI flag for "also cache this directory", but the plan it
 * emits is plain JSON that we hand to buildx ourselves (`-f railpack-plan.json`),
 * and its cache model is simple and stable:
 *
 *   { "caches":  { "<name>": { "directory": "<abs path>", "type": "shared" } },
 *     "steps":  [ { "name": "build", "caches": ["<name>"], ... } ] }
 *
 * Each entry becomes a BuildKit cache mount. Those live in the buildkitd
 * instance behind our shared `docker-container` builder (see buildx.ts), whose
 * registration is persisted on the data folder — so a mount added here really
 * does survive between deployments, even though the work tree does not.
 *
 * That is what makes turbo's LOCAL cache viable. Turbo's own `.turbo` dir would
 * otherwise be cold on every build (fresh clone per deployment), leaving the
 * BuildKit layer cache as the only thing between a code change and a full
 * rebuild of every workspace package. With the mount, turbo restores unchanged
 * packages' outputs even when the layer cache misses — which it does on every
 * commit, since the COPY of the source invalidates it.
 *
 * Kept BEST-EFFORT and total: a plan we can't parse, or one whose shape has
 * drifted, is left exactly as railpack wrote it. A cache is a speedup; it must
 * never be the reason a build fails.
 */

import { Result } from "better-result";
import { readFile, writeFile } from "node:fs/promises";
import * as z from "zod";

import type { LogSink } from "./log-stream";

/** Absolute path (inside the build container) turbo is pointed at via
 *  `TURBO_CACHE_DIR`, and the directory we mount. Chosen explicitly rather than
 *  relying on turbo's default, which has moved between versions
 *  (`node_modules/.cache/turbo` → `.turbo/cache`): pinning it means the mount
 *  and the cache always agree. */
export const TURBO_CACHE_DIR = "/app/.turbo-cache";

/** Cache name in the plan. Namespaced so it can't collide with a railpack
 *  provider's own entry. */
const TURBO_CACHE_NAME = "otterdeploy-turbo";

/** The step whose commands run the app's build. Railpack names it `build`
 *  across every provider that has one. */
const BUILD_STEP = "build";

/** Only what the injection reads/writes; every other key is preserved by
 *  round-tripping the parsed JSON object, not this schema. */
const planSchema = z.object({
  caches: z.record(z.string(), z.unknown()).optional(),
  steps: z
    .array(
      z.object({
        name: z.string().optional(),
        caches: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});

/**
 * Add a persistent cache mount for turbo's local cache to the plan's build step.
 *
 * No-ops (and says why, at most once) when the plan has no recognisable build
 * step — the case where a provider ships files as-is and runs no build at all,
 * where there is nothing to cache anyway.
 */
export async function injectTurboCache(planPath: string, sink: LogSink): Promise<void> {
  const raw = await Result.tryPromise({
    try: () => readFile(planPath, "utf8"),
    catch: (cause: unknown) => cause,
  });
  if (raw.isErr()) return;

  const parsed = Result.try((): unknown => JSON.parse(raw.value));
  if (parsed.isErr()) return;
  const checked = planSchema.safeParse(parsed.value);
  if (!checked.success) return;

  // Re-parse into a mutable object so unknown keys survive the round-trip; the
  // schema above is a shape CHECK, not the value we write back.
  const plan = parsed.value;
  if (typeof plan !== "object" || plan === null || !("steps" in plan)) return;

  const steps = checked.data.steps ?? [];
  const buildIndex = steps.findIndex((s) => s.name === BUILD_STEP);
  if (buildIndex === -1) {
    sink.system("no build step in the railpack plan; skipping the turbo cache mount");
    return;
  }

  const updated = withTurboCache(plan, buildIndex);
  if (!updated) return;

  const written = await Result.tryPromise({
    try: () => writeFile(planPath, `${JSON.stringify(updated, null, 2)}\n`),
    catch: (cause: unknown) => cause,
  });
  if (written.isErr()) {
    sink.system("could not write the turbo cache mount into the plan; building without it");
    return;
  }
  sink.system(`turbo local cache mounted at ${TURBO_CACHE_DIR} (persists between builds)`);
}

/**
 * Return a copy of the plan with the turbo cache registered and attached to the
 * build step, or null when the shape isn't what we expect. Pure.
 */
function withTurboCache(plan: object, buildIndex: number): object | null {
  if (!("steps" in plan) || !Array.isArray(plan.steps)) return null;
  const steps = [...plan.steps];
  const step = steps[buildIndex];
  if (typeof step !== "object" || step === null) return null;

  const existing = "caches" in step && Array.isArray(step.caches) ? step.caches : [];
  if (existing.includes(TURBO_CACHE_NAME)) return plan; // already injected

  steps[buildIndex] = { ...step, caches: [...existing, TURBO_CACHE_NAME] };

  const caches = "caches" in plan && typeof plan.caches === "object" ? plan.caches : {};
  return {
    ...plan,
    caches: {
      ...caches,
      [TURBO_CACHE_NAME]: { directory: TURBO_CACHE_DIR, type: "shared" },
    },
    steps,
  };
}
