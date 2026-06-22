/**
 * Organization access control (RBAC).
 *
 * Built on better-auth's access-control primitives so role resolution and
 * permission checks go through `auth.api.hasPermission` — no hand-rolled
 * `member`-table lookups scattered across handlers. Statements below extend
 * better-auth's org defaults (organization/member/invitation/team/ac) with
 * otterdeploy's own resources.
 *
 * Roles:
 *   - owner  : full control, including deleting the org
 *   - admin  : manage everything except deleting the org
 *   - member : full mutation of the app + infra resource surface (create/update/
 *              delete/deploy projects, services, databases, environments,
 *              servers, registries, routes) — RBAC-governed so it can be
 *              tightened with a custom role — but NO org/member administration
 *              and no data-plane writes (database `write`) or key minting.
 */
import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc as orgAdminAc,
  memberAc as orgMemberAc,
  ownerAc as orgOwnerAc,
  defaultStatements,
} from "better-auth/plugins/organization/access";

export const statements = {
  // better-auth org defaults (organization/member/invitation/team/ac).
  ...defaultStatements,

  // otterdeploy resources.
  project: ["create", "read", "update", "delete"],
  service: ["create", "read", "update", "delete", "deploy"],
  // `query` = run read-only SQL / browse rows; `write` = mutate data (inline
  // edit, insert, delete, DML) through the data viewer. Split so members can
  // read the live database without being able to change it.
  database: ["create", "read", "update", "delete", "query", "write"],
  backup: ["create", "read", "update", "delete", "run", "restore"],
  route: ["create", "read", "update", "delete"],
  // `env` covers both environments (the entity — create/delete) and their
  // variables (read/update). Members manage env + vars; only admins/owners
  // delete a whole environment.
  env: ["create", "read", "update", "delete"],
  server: ["create", "read", "update", "delete"],
  // Org-scoped container registries (image push/pull creds). Infra-level, like
  // servers: members read (to bind a service), admins/owners manage.
  registry: ["create", "read", "update", "delete"],
  firewall: ["read", "update"],
  notificationChannel: ["create", "read", "update", "delete", "test"],
  // Org-scoped API keys. The better-auth apiKey plugin resolves these same
  // actions against this AC on every create/read/update/delete (org owners pass
  // automatically via `allowCreatorAllPermissions`); the apiKeys oRPC create
  // procedure gates on `create` too.
  apiKey: ["create", "read", "update", "delete"],
  // Org-scoped SSH keys (Git deploy keys + node management). Generated/imported
  // via the sshKeys oRPC router; gated on these actions there.
  sshKey: ["create", "read", "update", "delete"],
} as const;

export const ac = createAccessControl(statements);

/** Full app + infra resource mutation (the pre-RBAC default — members could do
 *  all of this before it was enforced). Excludes org/member administration,
 *  data-plane writes (`database:write`), and key minting. Tighten via a custom
 *  role if you want a more restricted member. */
export const member = ac.newRole({
  ...orgMemberAc.statements,
  project: ["create", "read", "update", "delete"],
  service: ["create", "read", "update", "delete", "deploy"],
  // `query` = read-only browse; `write` (data-plane mutation) stays admin/owner.
  database: ["create", "read", "update", "delete", "query"],
  backup: ["create", "read", "run", "restore"],
  route: ["create", "read", "update", "delete"],
  env: ["create", "read", "update", "delete"],
  server: ["create", "read", "update", "delete"],
  registry: ["create", "read", "update", "delete"],
  firewall: ["read"],
  notificationChannel: ["create", "read", "update", "test"],
  // Members can see the workspace's keys but not mint or revoke them.
  apiKey: ["read"],
  // SSH keys: same posture — read-only for members.
  sshKey: ["read"],
});

/** Everything except deleting the org. */
export const admin = ac.newRole({
  ...orgAdminAc.statements,
  project: ["create", "read", "update", "delete"],
  service: ["create", "read", "update", "delete", "deploy"],
  database: ["create", "read", "update", "delete", "query", "write"],
  backup: ["create", "read", "update", "delete", "run", "restore"],
  route: ["create", "read", "update", "delete"],
  env: ["create", "read", "update", "delete"],
  server: ["create", "read", "update", "delete"],
  registry: ["create", "read", "update", "delete"],
  firewall: ["read", "update"],
  notificationChannel: ["create", "read", "update", "delete", "test"],
  apiKey: ["create", "read", "update", "delete"],
  sshKey: ["create", "read", "update", "delete"],
});

/** Full control. */
export const owner = ac.newRole({
  ...orgOwnerAc.statements,
  project: ["create", "read", "update", "delete"],
  service: ["create", "read", "update", "delete", "deploy"],
  database: ["create", "read", "update", "delete", "query", "write"],
  backup: ["create", "read", "update", "delete", "run", "restore"],
  route: ["create", "read", "update", "delete"],
  env: ["create", "read", "update", "delete"],
  server: ["create", "read", "update", "delete"],
  registry: ["create", "read", "update", "delete"],
  firewall: ["read", "update"],
  notificationChannel: ["create", "read", "update", "delete", "test"],
  apiKey: ["create", "read", "update", "delete"],
  sshKey: ["create", "read", "update", "delete"],
});

export const roles = { member, admin, owner };

/** A single `{ resource: actions[] }` permission check. */
export type PermissionCheck = {
  [K in keyof typeof statements]?: Array<(typeof statements)[K][number]>;
};
