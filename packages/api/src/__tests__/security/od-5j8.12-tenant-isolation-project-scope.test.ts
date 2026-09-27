/**
 * od-5j8.12: an `input.projectId` is an attacker-controlled value, never a
 * proof of tenancy.
 *
 * Why this is a structural test and not a request test: there is no row-level
 * security in this install. `SELECT`s are not filtered by tenant by the
 * database, so the ONLY thing standing between org A and org B's rows is that
 * each handler remembers to join `project.organizationId` (or call a helper
 * that does). That is a convention, and conventions need a test that fails
 * when someone forgets.
 *
 * The gap this closes, concretely:
 *
 *   - `orgScopedProcedure` proves the caller HAS an active organization. It
 *     never compares that organization to the project named in the input.
 *   - `projectScopedProcedure` adds `projectScopeMiddleware`, which opens with
 *     `if (context.apiKey)`. For a cookie/session actor — i.e. anyone using
 *     the web app — the whole middleware is a no-op.
 *   - `requirePermission({...})` resolves the RBAC check against
 *     `context.activeOrganizationId`, the CALLER's org. Holding `service:deploy`
 *     in your own organization satisfies it while you pass somebody else's
 *     project id.
 *
 * So a handler that reads `input.projectId` and hands it straight to a query
 * keyed on `resource.projectId` is a cross-tenant read (or write) regardless of
 * which builder it was declared with. Every such handler must verify ownership
 * itself.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vite-plus/test";

const repositoryRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../..");
const routersDir = resolve(repositoryRoot, "packages/api/src/routers");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".ts") && !full.includes("__tests__") ? [full] : [];
  });
}

/** Index of the `)` closing the `(` at `open`. */
function matchParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
}

interface Handler {
  file: string;
  line: number;
  body: string;
}

/** Every `.handler(...)` body in the router tree, with its source position. */
function handlers(): Handler[] {
  const found: Handler[] = [];
  for (const file of walk(routersDir)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\.handler\(/g)) {
      const open = match.index + match[0].length - 1;
      found.push({
        file: file.slice(repositoryRoot.length + 1),
        line: text.slice(0, match.index).split("\n").length,
        body: text.slice(open, matchParen(text, open)),
      });
    }
  }
  return found;
}

/**
 * Evidence that a handler tied the input project to the caller's organization.
 * Either it names the active org itself (so any `where` it builds can include
 * it), or it delegates to one of the resolve-in-org helpers, each of which
 * joins `project.organizationId` before returning a row.
 */
const OWNERSHIP_PROOF =
  /activeOrganizationId|getProjectInOrg|projectInOrg|getEnvInOrg|requireSite|requireBackup|requireProjectAccess/;

/**
 * Handlers that legitimately read across tenants. An install administrator is
 * an instance-wide role by construction (`scope: "install"`, a server-owned
 * user attribute that no organization role can grant), so an install-gated
 * handler touching a project it does not belong to is the intended behaviour,
 * not a leak. Keep this list minimal and justify every entry.
 */
const CROSS_TENANT_BY_DESIGN = new Set([
  // Instance-wide Caddy/ACME options. `projectId` is carried for the audit
  // target only — it is logged, never used to select rows.
  "packages/api/src/routers/project/router-proxy-routes.ts:78",
]);

describe("[od-5j8.12] a project id from input never grants cross-tenant access", () => {
  test("every handler reading input.projectId proves the project belongs to the caller's org", () => {
    const offenders = handlers()
      .filter((h) => /input\.projectId/.test(h.body))
      .filter((h) => !OWNERSHIP_PROOF.test(h.body))
      .map((h) => `${h.file}:${h.line}`)
      .filter((at) => !CROSS_TENANT_BY_DESIGN.has(at));

    // A handler listed here reads rows keyed on an id the caller chose, with
    // nothing in its body tying that id to the caller's tenant. Fix it by
    // resolving through `getProjectInOrg({ projectId, organizationId })` (or an
    // equivalent org-joined helper) and throwing NOT_FOUND on a miss — never by
    // adding an entry to CROSS_TENANT_BY_DESIGN unless the handler really is
    // install-scoped.
    expect(offenders).toEqual([]);
  });

  test("projectScopeMiddleware is api-key-only, so it cannot be the tenancy gate", () => {
    const index = readFileSync(resolve(repositoryRoot, "packages/api/src/index.ts"), "utf8");
    const middleware = index.slice(index.indexOf("const projectScopeMiddleware"));
    const body = middleware.slice(0, middleware.indexOf("\n/**"));

    // This asserts the shape the test above reasons about: the guard is
    // entered only for api-key actors. If this ever becomes a real per-actor
    // tenancy check, the reasoning in this file needs revisiting — but until
    // then, `projectScopedProcedure` must not be mistaken for org ownership.
    expect(body).toContain("if (context.apiKey)");
    expect(body).toMatch(/requireProjectScope\(context\.apiKey/);
  });
});
