/**
 * Relational Query Builder (RQB v2) graph.
 *
 * drizzle-orm 1.0 replaced the old `relations()` helper with
 * `defineRelations(schema, (r) => …)`. This object is what powers
 * `db.query.<table>.findMany({ with: { … } })` — it does NOT affect
 * `db.select()` / `.leftJoin()` (those work straight off the table objects),
 * so wiring it in is purely additive.
 *
 * Conventions used below:
 *   - `from`/`to` are declared on the side that HOLDS the foreign key column
 *     (the `one` side). The reverse `many`/`one` pairs automatically by table.
 *   - `optional: false` marks NOT NULL foreign keys (the related row always
 *     exists); `optional: true` marks nullable ones (the related row may be
 *     absent). This only changes the inferred result type's nullability.
 *   - A few columns reference another table at the application layer without a
 *     DB-level FK (to avoid cross-schema import cycles): `project.gitRepoId`,
 *     `project.containerRegistryId`, `project.environmentId`,
 *     `proxyRoute.resourceId`. RQB only needs the column pair, so these are
 *     modelled here too.
 *   - `project` ↔ `environment` has two distinct paths, so each is given an
 *     explicit `alias` to disambiguate:
 *       · "projectEnvironments"      — environments owned by a project
 *       · "projectActiveEnvironment" — a project's selected/default environment
 */
import { defineRelations } from "drizzle-orm";

import * as schema from "../schema";
import { authRelations } from "./auth";
import {
  auditRelations,
  backupRelations,
  gitRelations,
  proxyRelations,
  serverRelations,
} from "./infra";
import { projectRelations, registryRelations, serviceRelations } from "./project";

export const relations = defineRelations(schema, (r) => ({
  // ─── auth ──────────────────────────────────────────────────────────────
  ...authRelations(r),

  // ─── project ───────────────────────────────────────────────────────────
  ...projectRelations(r),
  ...serviceRelations(r),

  // ─── build / registry ────────────────────────────────────────────────────
  ...registryRelations(r),

  // ─── git ───────────────────────────────────────────────────────────────
  ...gitRelations(r),

  // ─── server ──────────────────────────────────────────────────────────────
  ...serverRelations(r),

  // ─── proxy ───────────────────────────────────────────────────────────────
  ...proxyRelations(r),

  // ─── audit ───────────────────────────────────────────────────────────────
  ...auditRelations(r),

  // ─── backups ─────────────────────────────────────────────────────────────
  ...backupRelations(r),
}));
