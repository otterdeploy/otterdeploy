import type { PermissionCheck } from "@otterdeploy/auth/permissions";

import { auth } from "@otterdeploy/auth";

import type { ResolvedActor, SessionActor } from "./actor";

import { authorizeKeyScope, authorizeRoleScope, requireProjectScope } from "./api-key-scope";

export type Capability =
  | {
      scope: "install";
      mode: "read" | "write";
    }
  | {
      scope: "organization";
      mode: "read" | "write";
      organizationId: string;
      permission: PermissionCheck;
      projectId?: string;
    };

export type AuthorizationDecision =
  | { allowed: true }
  | {
      allowed: false;
      status: 401 | 403;
      reason: string;
    };

interface CapabilityDependencies {
  hasSessionPermission?: (actor: SessionActor, permission: PermissionCheck) => Promise<boolean>;
}

const ALLOWED: AuthorizationDecision = { allowed: true };

function deny(reason: string, status: 401 | 403 = 403): AuthorizationDecision {
  return { allowed: false, status, reason };
}

async function defaultHasSessionPermission(
  actor: SessionActor,
  permission: PermissionCheck,
): Promise<boolean> {
  const { success } = await auth.api.hasPermission({
    headers: actor.headers,
    body: {
      organizationId: actor.session.activeOrganizationId ?? undefined,
      permissions: permission as Record<string, string[]>,
    },
  });
  return success;
}

function authorizeApiKey(
  actor: Extract<ResolvedActor, { kind: "api-key" }>,
  capability: Extract<Capability, { scope: "organization" }>,
): AuthorizationDecision {
  if (capability.mode === "write" && actor.accessLevel === "read") {
    return deny("This API key is read-only.");
  }
  if (
    !authorizeKeyScope(actor.permissions, capability.permission) ||
    !authorizeRoleScope(capability.permission)
  ) {
    return deny("This API key does not grant the required permission.");
  }
  if (capability.projectId && !requireProjectScope(actor, capability.projectId)) {
    return deny("This API key is not scoped to that project.");
  }
  return ALLOWED;
}

/**
 * The transport-independent authorization boundary. Every caller must state
 * exactly what it wants to do, where it wants to do it, and whether it mutates
 * state. This makes missing scope/mode/permission information a type error.
 */
export async function authorizeCapability(
  actor: ResolvedActor,
  capability: Capability,
  dependencies: CapabilityDependencies = {},
): Promise<AuthorizationDecision> {
  if (!actor) {
    return deny("Authentication is required.", 401);
  }

  if (capability.scope === "install") {
    return actor.kind === "session" && actor.user.isInstallAdmin
      ? ALLOWED
      : deny("Installation administrator access is required.");
  }

  const actorOrganizationId =
    actor.kind === "api-key" ? actor.organizationId : actor.session.activeOrganizationId;
  if (!actorOrganizationId || actorOrganizationId !== capability.organizationId) {
    return deny("The actor is not authorized for this organization.");
  }

  if (actor.kind === "api-key") {
    return authorizeApiKey(actor, capability);
  }

  const hasPermission = dependencies.hasSessionPermission ?? defaultHasSessionPermission;
  if (!(await hasPermission(actor, capability.permission))) {
    return deny("The actor does not have the required permission.");
  }
  return ALLOWED;
}
