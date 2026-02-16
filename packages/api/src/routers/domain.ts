import * as z from "zod";
import { customDomainService } from "@otterstack/domain";

import { orgProcedure, orgAdminProcedure } from "../index";
import { fromPromise } from "../utils/result";

export const domainRouter = {
  add: orgAdminProcedure
    .input(
      z.object({
        resourceId: z.string().min(1),
        domain: z.string().min(3),
      }),
    )
    .handler(async ({ context, input }) => {
      return fromPromise(
        customDomainService.addDomain({
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
      return fromPromise(customDomainService.verifyDomain(input.domainId, context.organizationId));
    }),

  list: orgProcedure
    .input(
      z.object({
        resourceId: z.string().min(1).optional(),
        organizationId: z.string().min(1).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      return fromPromise(
        customDomainService.listDomains({
          organizationId: context.organizationId,
          resourceId: input.resourceId,
        }),
      );
    }),

  remove: orgAdminProcedure
    .input(
      z.object({
        domainId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      return fromPromise(customDomainService.removeDomain(input.domainId, context.organizationId));
    }),
};
