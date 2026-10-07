/**
 * API-key permission-scope authorization (pure, no DB/auth I/O).
 *
 * Org-scoped API keys (better-auth apiKey plugin, `references: "organization"`)
 * carry their own `{ resource: actions[] }` permission map plus optional
 * metadata presets (read-only access level + project scoping). The oRPC
 * permission middleware combines three independent gates for a key actor:
 *
 *   1. authorizeKeyScope: the key's own minted permission map covers the
 *      required {resource: actions[]}.
 *   2. authorizeRoleScope: DECISION A: every key is additionally capped at the
 *      least-privileged org role (`member`). Effective permission is therefore
 *      `min(key scope, member role)`. See the Decision B seam below for the
 *      future "intersect against the creator's live role" refinement.
 *   3. isReadAllowed: optional read-only preset blocks non-read actions.
 *
 * Project scope (requireProjectScope) is enforced separately on procedures that
 * carry a `projectId` in their validated input.
 *
 * Everything here is a pure function of its inputs so it can be unit-tested
 * without a database, a live auth instance, or a real key.
 */
import { roles, type PermissionCheck } from "@otterdeploy/auth/permissions";

// `isReadAction` is deliberately imported, not redefined. Read-only API keys
// (isReadAllowed below) and the audit read-gate (../index.ts) must classify a
// procedure identically: a divergence would either let a read-only key through
// a mutation or drop a mutation from the audit trail. One definition, in
// ./procedure-mode, is what keeps them honest.
import { isReadAction } from "./procedure-mode";

/**
 * Does the key's own minted permission map cover the required permission?
 *
 * `null` keyPermissions means a full-access key → unconditionally true (the
 * member-role cap below still applies). A key is null only when its creator
 * explicitly chose full access (`apiKeys.create` with `permissions: "full"`),
 * or when it was minted before that choice existed: such legacy keys keep
 * working as full access, deliberately, so existing CI and scripts do not
 * break. The plugin's own create endpoint, the one path that could still mint a
 * null key implicitly, is closed over HTTP (`disabledPaths` in packages/auth).
 * Otherwise every required `{resource: actions[]}` entry must be fully covered
 * by `keyPermissions[resource]`.
 */
export function authorizeKeyScope(
  keyPermissions: Record<string, string[]> | null,
  required: PermissionCheck,
): boolean {
  // Full-access key, no per-key narrowing.
  if (keyPermissions === null) return true;

  for (const [resource, actions] of Object.entries(required)) {
    if (!actions || actions.length === 0) continue;
    const allowed = keyPermissions[resource];
    if (!allowed) return false;
    if (!actions.every((action) => allowed.includes(action))) return false;
  }
  return true;
}

/**
 * DECISION A: cap every API key at the `member` role. Returns true only when the
 * required permission is within what an org member may do.
 *
 * DECISION B SEAM (future): record the minting user on the key and intersect
 * `required` against that creator's *live* org role instead of the static
 * `member` cap: i.e. an owner's key could do owner things, but it would
 * downgrade automatically if the creator is demoted. That needs a creator
 * column on the `apikey` row (none today: `references: "organization"` →
 * `referenceId` is the org id, not a user) plus a role lookup at verify time.
 * When that lands, swap `roles.member` here for the resolved creator role.
 */
type MemberAuthorizeRequest = Parameters<typeof roles.member.authorize>[0];

/**
 * Genuine narrowing from the full-catalog `PermissionCheck` to the subset the
 * `member` role's `authorize` accepts: every requested resource must exist in
 * the member statements and every requested action must be one the member
 * statements list. When this returns false, `authorize` would have returned
 * `success: false` anyway (unknown resource / uncovered action), so callers
 * can short-circuit to `false` without changing behavior.
 */
function fitsMemberStatements(
  required: PermissionCheck,
): required is MemberAuthorizeRequest & PermissionCheck {
  const memberStatements = new Map<string, readonly string[]>(
    Object.entries(roles.member.statements),
  );
  for (const [resource, actions] of Object.entries(required)) {
    const allowed = memberStatements.get(resource);
    if (!allowed) return false;
    // `undefined` actions pass through to `authorize` unchanged (same crash
    // semantics as before this guard existed); arrays must be fully covered.
    if (actions && !actions.every((action) => allowed.includes(action))) return false;
  }
  return true;
}

/**
 * The `resource:action` pairs of a requested key grant that no key can ever
 * use: every key is capped at the member role (DECISION A), so anything the
 * member statements do not list (an unknown resource, a misspelt action,
 * `database:write`, `apiKey:create`) would mint a key that silently cannot do
 * what its creator asked. `apiKeys.create` refuses those instead.
 */
export function ungrantableKeyPermissions(requested: Record<string, string[]>): string[] {
  const memberStatements = new Map<string, readonly string[]>(
    Object.entries(roles.member.statements),
  );
  return Object.entries(requested).flatMap(([resource, actions]) => {
    const allowed = memberStatements.get(resource) ?? [];
    return actions
      .filter((action) => !allowed.includes(action))
      .map((action) => `${resource}:${action}`);
  });
}

export function authorizeRoleScope(required: PermissionCheck): boolean {
  if (!fitsMemberStatements(required)) return false;
  return roles.member.authorize(required).success;
}

/**
 * Optional read-only preset. `accessLevel === 'read'` blocks any non-read
 * action; `'write'` / `undefined` (the default) impose no extra restriction.
 */
export function isReadAllowed(accessLevel: "read" | "write" | undefined, path: string): boolean {
  if (accessLevel !== "read") return true;
  return isReadAction(path);
}

/** The project-scope view of an API-key actor, as carried on the request
 *  context. `projectScope === 'all'` (or absent) means the key isn't restricted
 *  to specific projects. */
export interface ApiKeyProjectScope {
  projectScope?: "all" | "selected";
  projectIds?: string[];
}

/**
 * The projects a key's org-wide READS must be narrowed to: its allow-list when
 * minted for selected projects, `null` when nothing narrows (a session actor,
 * or a key for every project). A procedure with no project in its input (a
 * listing, an org-wide analytics read) cannot be confined by the input check,
 * so it filters its RESULT by this instead.
 */
export function scopedProjectIds(apiKeyCtx: ApiKeyProjectScope | null): readonly string[] | null {
  if (!apiKeyCtx || apiKeyCtx.projectScope !== "selected") return null;
  return apiKeyCtx.projectIds ?? [];
}

/**
 * Is the key allowed to act on `projectId`?
 *
 * `null` apiKeyCtx means a session/cookie actor (no key) → no-op, always true.
 * For a key: `projectScope !== 'selected'` → unrestricted; otherwise the project
 * must be in the key's allow-list.
 */
export function requireProjectScope(
  apiKeyCtx: ApiKeyProjectScope | null,
  projectId: string,
): boolean {
  if (!apiKeyCtx) return true;
  if (apiKeyCtx.projectScope !== "selected") return true;
  return (apiKeyCtx.projectIds ?? []).includes(projectId);
}
