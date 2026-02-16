import { oc } from "@orpc/contract";
import * as z from "zod";

import { TeamMemberSchema } from "../schemas";
import { route } from "../http";
import { IdSchema, OrgRoleSchema, SuccessSchema } from "../shared";

export const teamContract = {
  listMembers: oc
    .route(route("GET", "/organizations/{organizationId}/members"))
    .input(
      z.object({
        organizationId: IdSchema,
      }),
    )
    .output(z.array(TeamMemberSchema)),
  invite: oc
    .route(route("POST", "/organizations/{organizationId}/members/invite"))
    .input(
      z.object({
        organizationId: IdSchema,
        email: z.email(),
        role: OrgRoleSchema,
      }),
    )
    .output(
      z.object({
        invitationId: IdSchema,
        organizationId: IdSchema,
        email: z.email(),
        role: OrgRoleSchema,
        expiresAt: z.iso.datetime(),
      }),
    )
    .errors({
      CONFLICT: { message: "Member already exists or invitation pending" },
    }),
  updateRole: oc
    .route(route("PATCH", "/organizations/{organizationId}/members/{memberId}/role"))
    .input(
      z.object({
        organizationId: IdSchema,
        memberId: IdSchema,
        role: OrgRoleSchema,
      }),
    )
    .output(TeamMemberSchema)
    .errors({
      NOT_FOUND: { message: "Member not found" },
    }),
  removeMember: oc
    .route(route("DELETE", "/organizations/{organizationId}/members/{memberId}"))
    .input(
      z.object({
        organizationId: IdSchema,
        memberId: IdSchema,
      }),
    )
    .output(SuccessSchema)
    .errors({
      NOT_FOUND: { message: "Member not found" },
      FORBIDDEN: { message: "Cannot remove the last owner" },
    }),
};
