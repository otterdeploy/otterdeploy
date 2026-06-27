/**
 * API-key permission-scope authorization (pure, no DB/auth I/O).
 *
 * Org-scoped API keys (better-auth apiKey plugin, `references: "organization"`)
 * carry their own `{ resource: actions[] }` permission map plus optional
 * metadata presets (read-only access level + project scoping). The oRPC
 * permission middleware combines three independent gates for a key actor:
 *
 *   1. authorizeKeyScope  — the key's own minted permission map covers the
 *      required {resource: actions[]}.
 *   2. authorizeRoleScope — DECISION A: every key is additionally capped at the
 *      least-privileged org role (`member`). Effective permission is therefore
 *      `min(key scope, member role)`. See the Decision B seam below for the
 *      future "intersect against the creator's live role" refinement.
 *   3. isReadAllowed      — optional read-only preset blocks non-read actions.
 *
 * Project scope (requireProjectScope) is enforced separately on procedures that
 * carry a `projectId` in their validated input.
 *
 * Everything here is a pure function of its inputs so it can be unit-tested
 * without a database, a live auth instance, or a real key.
 */
import { roles, type PermissionCheck } from "@otterdeploy/auth/permissions";

/** Read-ish verbs that don't mutate state. Kept in sync with the
 *  `READ_VERB` classifier in ../index.ts (single source of truth lives here so
 *  read-only keys and the audit trail agree on what "read" means). */
const READ_VERB =
  /^(list|get|inspect|stream|search|count|fetch|read|resolve|view|preview|status|events|logs|metrics|stats)/i;

/** True when the oRPC procedure path (e.g. `service.deploy`) is a read action. */
export function isReadAction(path: string): boolean {
  const action = path.split(".").pop() ?? path;
  return READ_VERB.test(action);
}

/**
 * Does the key's own minted permission map cover the required permission?
 *
 * `null` keyPermissions means a full-access key (the plugin stores `null` for
 * keys minted without a `permissions` field) → unconditionally true. Otherwise
 * every required `{resource: actions[]}` entry must be fully covered by
 * `keyPermissions[resource]`.
 */
export function authorizeKeyScope(
  keyPermissions: Record<string, string[]> | null,
  required: PermissionCheck,
): boolean {
  // Full-access key — no per-key narrowing.
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
 * `member` cap — i.e. an owner's key could do owner things, but it would
 * downgrade automatically if the creator is demoted. That needs a creator
 * column on the `apikey` row (none today: `references: "organization"` →
 * `referenceId` is the org id, not a user) plus a role lookup at verify time.
 * When that lands, swap `roles.member` here for the resolved creator role.
 */
export function authorizeRoleScope(required: PermissionCheck): boolean {
  return roles.member.authorize(required as Parameters<typeof roles.member.authorize>[0]).success;
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
