/** Shared by the org-settings handlers split across ./handlers and ./base-domain. */
import type { OrganizationId } from "@otterdeploy/shared/id";

import { TaggedError } from "better-result";

export class OrganizationNotFoundError extends TaggedError("OrganizationNotFoundError")<{
  organizationId: OrganizationId;
  message: string;
}>() {
  constructor(organizationId: OrganizationId) {
    super({ organizationId, message: `organization ${organizationId} not found` });
  }
}
