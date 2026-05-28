/**
 * Common addressing tuples used across every router handler in this
 * package. Replaces the ~11 duplicate local definitions of these
 * shapes (`OrgRef`, `ProjectRef`, `ResourceRef`, `ProjectScope` —
 * same 1-3 fields each).
 *
 * Naming follows the API surface: an `OrgRef` addresses an
 * organization; a `ProjectRef` adds a project; a `ResourceRef` adds a
 * resource. Each input type a handler accepts is then
 * `XxxRef & { ... }` for whatever extra params the call needs.
 */

import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

export interface OrgRef {
  organizationId: OrganizationId;
}

export interface ProjectRef extends OrgRef {
  projectId: ProjectId;
}

export interface ResourceRef extends ProjectRef {
  resourceId: ResourceId;
}

/**
 * Legacy alias for `ProjectRef` — kept so existing `manifest.ts`
 * `loadManifest({ projectId, organizationId })` callers don't need
 * to rename in this pass.
 */
export type ProjectScope = ProjectRef;
