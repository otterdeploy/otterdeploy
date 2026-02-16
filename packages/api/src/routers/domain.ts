import * as z from "zod";
import { customDomainService } from "@otterstack/domain";

import { orgProcedure, orgAdminProcedure } from "../index";
import { unwrapResult } from "../utils/result";

export const domainRouter = {
  add: orgAdminProcedure
    .input(
      z.object({
        resourceId: z.string().min(1),
        domain: z.string().min(3),
      }),
    )
    .handler(async ({ context, input }) => {
      return unwrapResult(
        await customDomainService.addDomain({
          organizationId: context.organizationId,
          resourceId: input.resourceId,
          domain: input.domain,
        }),
      );
    }),

  verify: orgAdminProcedure
    .input(
      z.object({
        domainId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      return unwrapResult(await customDomainService.verifyDomain(input.domainId, context.organizationId));
    }),

  list: orgProcedure
    .input(
      z.object({
        resourceId: z.string().min(1).optional(),
        organizationId: z.string().min(1).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      return customDomainService.listDomains({
        organizationId: context.organizationId,
        resourceId: input.resourceId,
      });
    }),

  remove: orgAdminProcedure
    .input(
      z.object({
        domainId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      return unwrapResult(await customDomainService.removeDomain(input.domainId, context.organizationId));
    }),
};
