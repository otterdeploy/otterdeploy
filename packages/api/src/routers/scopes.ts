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
