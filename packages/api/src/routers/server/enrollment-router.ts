import type { NodeEnrollmentId, UserId } from "@otterdeploy/shared/id";

import { auth } from "@otterdeploy/auth";
import { Result } from "better-result";

import type { Context } from "../../context";

import { requireInstallAdmin } from "../..";
import {
  createNodeEnrollment,
  isSwarmEnrollmentReady,
  listNodeEnrollments,
  revokeNodeEnrollment,
  rotateSwarmJoinCredential,
  type EnrollmentRole,
} from "./enrollment";

interface StepUpErrors {
  TWO_FACTOR_REQUIRED: () => Error;
  INVALID_STEP_UP: () => Error;
  MANAGER_CONFIRMATION_REQUIRED: () => Error;
}

async function requireEnrollmentStepUp(
  context: Context,
  input: {
    role: EnrollmentRole;
    totpCode: string;
    managerConfirmation?: string;
  },
  errors: StepUpErrors,
): Promise<void> {
  if (!context.session?.user.twoFactorEnabled) {
    throw errors.TWO_FACTOR_REQUIRED();
  }
  if (input.role === "manager" && input.managerConfirmation !== "ENROLL MANAGER") {
    throw errors.MANAGER_CONFIRMATION_REQUIRED();
  }
  const verified = await Result.tryPromise({
    try: () =>
      auth.api.verifyTOTP({
        headers: context.headers,
        body: { code: input.totpCode, trustDevice: false },
      }),
    catch: (cause) => cause,
  });
  if (verified.isErr()) throw errors.INVALID_STEP_UP();
}

function enrollmentStatus(row: {
  expiresAt: Date;
  redeemedAt: Date | null;
  completedAt: Date | null;
  revokedAt: Date | null;
}) {
  if (row.revokedAt) return "revoked" as const;
  if (row.completedAt) return "completed" as const;
  if (row.redeemedAt) return "redeemed" as const;
  if (row.expiresAt.getTime() <= Date.now()) return "expired" as const;
  return "active" as const;
}

export const serverEnrollmentRouter = {
  enrollments: requireInstallAdmin().server.enrollments.handler(async ({ context }) => {
    const rows = await listNodeEnrollments(context.activeOrganizationId);
    return rows.map((row) => ({
      ...row,
      status: enrollmentStatus(row),
      expiresAt: row.expiresAt.toISOString(),
      redeemedAt: row.redeemedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }),

  createEnrollment: requireInstallAdmin().server.createEnrollment.handler(
    async ({ input, context, errors }) => {
      await requireEnrollmentStepUp(context, input, errors);
      if (!(await isSwarmEnrollmentReady(input.role))) {
        throw errors.SWARM_UNAVAILABLE();
      }
      const created = await createNodeEnrollment({
        organizationId: context.activeOrganizationId,
        createdByUserId: context.session?.user.id as UserId,
        role: input.role,
        ttlMinutes: input.ttlMinutes,
      });
      context.log.set({
        target: { type: "node-enrollment", id: created.id },
        enrollment: { role: created.role, expiresAt: created.expiresAt.toISOString() },
      });
      return {
        id: created.id,
        role: created.role,
        credential: created.credential,
        expiresAt: created.expiresAt.toISOString(),
      };
    },
  ),

  revokeEnrollment: requireInstallAdmin().server.revokeEnrollment.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "node-enrollment", id: input.id } });
      const revoked = await revokeNodeEnrollment({
        id: input.id as NodeEnrollmentId,
        organizationId: context.activeOrganizationId,
      });
      if (!revoked) throw errors.NOT_FOUND();
      return { revoked: true as const };
    },
  ),

  rotateJoinCredential: requireInstallAdmin().server.rotateJoinCredential.handler(
    async ({ input, context, errors }) => {
      await requireEnrollmentStepUp(context, input, errors);
      context.log.set({ target: { type: "swarm-join-credential", id: input.role } });
      await rotateSwarmJoinCredential(input.role);
      return { rotated: true as const };
    },
  ),
};
