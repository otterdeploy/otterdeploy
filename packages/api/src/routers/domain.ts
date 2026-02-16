import * as z from "zod";
import { ORPCError } from "@orpc/server";
import { customDomainService, DomainError } from "@otterstack/domain";

import { orgProcedure, orgAdminProcedure } from "../index";

function mapDomainError(err: unknown): never {
  if (err instanceof DomainError) {
    throw new ORPCError(err.code, { message: err.message });
  }
  throw err;
}

export const domainRouter = {
  add: orgAdminProcedure
    .input(
      z.object({
        resourceId: z.string().min(1),
        domain: z.string().min(3),
      }),
    )
    .handler(async ({ context, input }) => {
      try {
        return await customDomainService.addDomain({
          organizationId: context.organizationId,
          resourceId: input.resourceId,
          domain: input.domain,
        });
      } catch (err) {
        mapDomainError(err);
      }
    }),

  verify: orgAdminProcedure
    .input(
      z.object({
        domainId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      try {
        return await customDomainService.verifyDomain(
          input.domainId,
          context.organizationId,
        );
      } catch (err) {
        mapDomainError(err);
      }
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
      try {
        return await customDomainService.removeDomain(
          input.domainId,
          context.organizationId,
        );
      } catch (err) {
        mapDomainError(err);
      }
    }),
};
