/**
 * Target-scoped authorization for opening a shell. Extracted from the old
 * `/pty` upgrade auth (apps/server/src/handlers/terminal/auth.ts) so the SAME
 * check now runs once, at ticket-mint time (an ordinary oRPC procedure), not
 * a hand-rolled parallel check on the WebSocket transport. The WS upgrade
 * itself no longer authorizes anything: it only validates Origin and
 * consumes the single-use ticket this function's caller minted (od-5j8.9).
 */
import type { OrganizationId } from "@otterdeploy/shared/id";

import { Result, TaggedError } from "better-result";

import type { ResolvedActor } from "../../authz/actor";

import { authorizeCapability } from "../../authz/capability";
import { listTerminalTargets } from "./handlers";

export type TerminalTarget = { kind: "container"; id: string } | { kind: "host" };

class TerminalAuthzError extends TaggedError("TerminalAuthzError")<{
  status: 401 | 403 | 404;
  message: string;
}>() {}

/**
 * Authorize `actor` to open a shell on `target` within `organizationId`.
 * Containers must be org-owned (same discovery source the terminal picker
 * uses, never a raw daemon-wide docker id); the host shell is
 * install-admin-only platform surface, gated purely on install capability.
 */
export async function authorizeTerminalTarget(
  actor: ResolvedActor,
  // Plain string, matching `Capability.organizationId`: the branded
  // `OrganizationId` the DB layer wants is an internal detail cast at the
  // one call site (`listTerminalTargets`) that needs it.
  organizationId: string,
  target: TerminalTarget,
): Promise<Result<{ projectId: string | null }, TerminalAuthzError>> {
  if (!actor) {
    return Result.err(new TerminalAuthzError({ status: 401, message: "Authentication required" }));
  }

  if (target.kind === "container") {
    const targets = await listTerminalTargets({ organizationId: organizationId as OrganizationId });
    const owned = targets.containers.find((ct) => ct.containerId === target.id);
    if (!owned) {
      return Result.err(
        new TerminalAuthzError({
          status: 404,
          message: "Container not found in this organization",
        }),
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
      return Result.err(
        new TerminalAuthzError({ status: decision.status, message: decision.reason }),
      );
    }
    return Result.ok({ projectId: owned.projectId });
  }

  // Host shell: the most dangerous target. Install-admin only, never an
  // organization role and never an organization API key (authorizeCapability
  // enforces this for the "install" scope regardless of actor kind).
  const decision = await authorizeCapability(actor, { scope: "install", mode: "write" });
  if (!decision.allowed) {
    return Result.err(
      new TerminalAuthzError({ status: decision.status, message: decision.reason }),
    );
  }
  return Result.ok({ projectId: null });
}
