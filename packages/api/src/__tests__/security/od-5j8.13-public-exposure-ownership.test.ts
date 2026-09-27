/**
 * od-5j8.13: nothing changes what is reachable from the internet without first
 * proving the caller owns the resource.
 *
 * These mutators are the sharp end of the product. `setPublicExposure` and
 * `setServicePublicDomain` decide whether a service is on the public internet
 * and under which hostname; the `proxyRoute` writers mint, retarget and delete
 * the edge routes that carry it. All of them take a bare `resourceId` or
 * `routeId` and will operate on any row in the install — `resource` has no
 * organization column, so ownership is four joins away
 * (resource -> project -> organization) and there is no row-level security to
 * fall back on.
 *
 * So the guarantee lives entirely in each caller remembering to resolve
 * ownership first, through `loadResource` / `loadOwnedRoute` (which also pins
 * the route to its resource AND project, folding "missing" and "not yours"
 * into one 404 so existence never leaks). That is a convention, and this is
 * the test that fails when someone adds a caller that forgets.
 *
 * Why structural: the failure is silent. A handler missing the guard still
 * compiles, still passes its own tests, and still returns 200 — it just does
 * so for somebody else's service.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vite-plus/test";

const repositoryRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../..");
const routersDir = resolve(repositoryRoot, "packages/api/src/routers");

/** Writes that change public reachability. */
const EXPOSURE_MUTATORS =
  /\b(setPublicExposure|setServicePublicDomain|updateProxyRoute|deleteProxyRoute|clearPrimaryForResource|setRoutesEnabledForResource|insertProxyRoute)\s*\(/;

/**
 * Evidence the caller resolved ownership. Each of these reaches the org:
 * `loadProject`/`getProjectInOrg` match (projectId, organizationId);
 * `loadResource` adds the resource-in-project check; `loadOwnedRoute` adds the
 * route-in-resource-in-project check. `enforceResourceScope` is the api-key
 * variant. An explicit `activeOrganizationId` in the body counts too: the
 * handler is building the scope itself.
 */
const OWNERSHIP_GUARD =
  /\b(loadOwnedRoute|loadResource|loadProject|getProjectInOrg|enforceResourceScope|activeOrganizationId|requireServiceInOrg)\b/;

/**
 * Proof carried in the SIGNATURE instead of re-derived in the body. A function
 * taking an already-loaded `ServiceRecord` or `ProxyRouteRecord` cannot be
 * called without one, and the only way to get one is through the org-scoped
 * loaders — so the type system is doing the enforcing. `insertGeneratedRoute`
 * is the example: it demands the record its caller already resolved.
 */
const PROOF_IN_SIGNATURE = /\b(ServiceRecord|ProxyRouteRecord|ProjectRow)\b/;

/**
 * Files with no caller tenant to derive, by construction. Keep this short and
 * justify every entry.
 */
const NO_CALLER_TENANT = new Set([
  // Compose rollout seeding a freshly-created stack member's domain, inside a
  // deploy the compose router already gated. `isCreate` bounds it to rows this
  // very reconcile made.
  "packages/api/src/routers/compose/reconcile-rollout.ts",
  // Background sweep on a timer, install-wide on purpose: it re-probes DNS for
  // routes stuck on a self-signed cert and can only ever UPGRADE one to ACME.
  // It makes no tenancy decision — there is no caller and no request.
  "packages/api/src/routers/service/cert-recheck-sweep.ts",
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".ts") && !full.includes("__tests__") ? [full] : [];
  });
}

/** Index of the `}` closing the `{` at `open`. */
function matchBrace(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    else if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return text.length - 1;
}

interface Fn {
  file: string;
  name: string;
  exported: boolean;
  line: number;
  signature: string;
  body: string;
}

/** Every top-level function declaration in a file, with its body. */
function functionsIn(path: string): Fn[] {
  const text = readFileSync(path, "utf8");
  const found: Fn[] = [];
  for (const match of text.matchAll(/^(export )?(?:async )?function (\w+)\s*\(/gm)) {
    const open = text.indexOf("{", match.index + match[0].length);
    if (open === -1) continue;
    const close = matchBrace(text, open);
    found.push({
      file: path.slice(repositoryRoot.length + 1),
      name: match[2] ?? "?",
      exported: match[1] !== undefined,
      line: text.slice(0, match.index).split("\n").length,
      // The signature too: proof can be carried in a parameter type.
      signature: text.slice(match.index, open),
      body: text.slice(open, close),
    });
  }
  return found;
}

describe("[od-5j8.13] public exposure is never changed without an ownership check", () => {
  const callers = walk(routersDir)
    .flatMap(functionsIn)
    .filter((fn) => EXPOSURE_MUTATORS.test(fn.body));

  test("the scan finds the callers at all, so it cannot rot into a no-op", () => {
    // If a refactor renames these mutators, the filter above silently matches
    // nothing and every assertion below passes vacuously.
    expect(callers.length).toBeGreaterThanOrEqual(5);
  });

  /** Files whose exported surface is guarded: a private helper inside one of
   *  these is only reachable through that surface, so its caller has already
   *  proved ownership. */
  const guardedModules = new Set(
    walk(routersDir)
      .flatMap(functionsIn)
      .filter((fn) => fn.exported && OWNERSHIP_GUARD.test(fn.body))
      .map((fn) => fn.file),
  );

  test("every function that changes exposure resolves ownership first", () => {
    const offenders = callers
      .filter((fn) => !OWNERSHIP_GUARD.test(fn.body))
      // Proof passed in rather than re-derived.
      .filter((fn) => !PROOF_IN_SIGNATURE.test(fn.signature))
      // A private helper in a module whose exported functions are guarded.
      .filter((fn) => fn.exported || !guardedModules.has(fn.file))
      .filter((fn) => !NO_CALLER_TENANT.has(fn.file))
      .map((fn) => `${fn.file}:${fn.line} ${fn.name}`);

    // Resolve through `loadResource` (or `loadOwnedRoute` when a routeId is
    // involved) and return its error. Alternatively take the already-loaded
    // `ServiceRecord` as a parameter, which makes the caller do it. Adding an
    // entry to NO_CALLER_TENANT is the last resort, not the first.
    expect(offenders).toEqual([]);
  });

  test("loadOwnedRoute pins the route to its resource AND project, not just the org", () => {
    const source = readFileSync(
      resolve(repositoryRoot, "packages/api/src/routers/service/domains.ts"),
      "utf8",
    );
    const guard = source.slice(source.indexOf("export async function loadOwnedRoute"));
    const body = guard.slice(0, guard.indexOf("\nexport "));

    // Without both comparisons a caller could hand any route id to a resource
    // it does own and retarget somebody else's domain through it.
    expect(body).toContain("loadResource(input)");
    expect(body).toMatch(/route\.resourceId !== input\.resourceId/);
    expect(body).toMatch(/route\.projectId !== input\.projectId/);
  });
});
