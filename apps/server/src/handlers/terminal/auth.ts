import type { ResolvedActor } from "@otterdeploy/api/authz/actor";
import type { OrganizationId } from "@otterdeploy/shared/id";
import type { Context } from "hono";

import { resolveRequestActor } from "@otterdeploy/api/authz/actor";
import { authorizeCapability } from "@otterdeploy/api/authz/capability";
import { listTerminalTargets } from "@otterdeploy/api/routers/terminal/handlers";
import { Result, TaggedError } from "better-result";

import type { Target } from "./pty";

// ---------------------------------------------------------------------------
// /pty upgrade auth. Credential sources, in order:
//   1. Request cookies / Authorization header — browsers send cookies on the
//      WS upgrade, so the web UI works unchanged.
//   2. `?token=` query param for non-browser clients (Bun's WebSocket cannot
//      set headers): `otter_`-prefixed values verify as org API keys, anything
//      else is treated as a bearer session token.
// Authorization: containers must be org-owned (same discovery source the
// terminal picker uses); host shells are platform-admin surface and require a
// real user session — never an API key.
// ---------------------------------------------------------------------------

export class PtyAuthError extends TaggedError("PtyAuthError")<{
  status: 401 | 403;
  message: string;
}>() {}

export interface PtyActor {
  userId: string | null;
  organizationId: OrganizationId;
}

async function resolveActor(c: Context): Promise<ResolvedActor | null> {
  const fromRequest = await resolveRequestActor(c.req.raw.headers);
  if (fromRequest) return fromRequest;

  // Temporary compatibility for non-browser clients that cannot set WS
  // headers. This transport is removed in od-5j8.9 in favor of one-time,
  // origin-bound upgrade tickets.
  const token = c.req.query("token");
  if (!token) return null;
  const headers = new Headers(c.req.raw.headers);
  headers.set("authorization", `Bearer ${token}`);
  return resolveRequestActor(headers);
}

function actorOrganizationId(actor: Exclude<ResolvedActor, null>): OrganizationId | null {
  const value =
    actor.kind === "api-key" ? actor.organizationId : actor.session.activeOrganizationId;
  return (value ?? null) as OrganizationId | null;
}

/**
 * Authenticate + authorize a /pty upgrade request. Runs BEFORE the WebSocket
 * upgrade, so a denial is a plain HTTP 401/403 — the socket never opens and no
 * backend is spawned. A null target passes through: the post-upgrade
 * MISSING_TARGET control frame keeps its existing wire behavior.
 */
export async function authorizePty(
  c: Context,
  target: Target | null,
): Promise<Result<PtyActor, PtyAuthError>> {
  const actor = await resolveActor(c);
  if (!actor) {
    return Result.err(new PtyAuthError({ status: 401, message: "Authentication required" }));
  }
  const organizationId = actorOrganizationId(actor);
  if (!organizationId) {
    return Result.err(new PtyAuthError({ status: 403, message: "No active organization" }));
  }

  if (target?.kind === "container") {
    // Same org-scoped discovery the terminal picker uses — the container must
    // be one this org could have selected, never a raw daemon-wide docker id.
    const targets = await listTerminalTargets({ organizationId });
    const owned = targets.containers.find((ct) => ct.containerId === target.id);
    if (!owned) {
      return Result.err(
        new PtyAuthError({ status: 403, message: "Container not found in this organization" }),
      );
    }
    const decision = await authorizeCapability(actor, {
      scope: "organization",
      mode: "write",
      organizationId,
      projectId: owned.projectId,
      permission: { terminal: ["open"] },
    });
    if (!decision.allowed) {
      return Result.err(new PtyAuthError({ status: decision.status, message: decision.reason }));
    }
  }

  if (target?.kind === "host") {
    const decision = await authorizeCapability(actor, {
      scope: "install",
      mode: "write",
    });
    if (!decision.allowed) {
      return Result.err(
        new PtyAuthError({
          status: decision.status,
          message: decision.reason,
        }),
      );
    }
  }

  return Result.ok({
    userId: actor.kind === "session" ? actor.user.id : null,
    organizationId,
  });
}
