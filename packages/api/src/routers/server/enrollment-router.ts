import { ID_PREFIX, hasPrefix } from "@otterdeploy/shared/id";

import type { Context } from "../../context";

import { requireInstallAdmin } from "../..";
import { verifyStepUpCredential } from "../../authz/step-up";
import {
  createNodeEnrollment,
  isSwarmEnrollmentReady,
  listNodeEnrollments,
  revokeNodeEnrollment,
  rotateSwarmJoinCredential,
  type EnrollmentRole,
} from "./enrollment";

interface StepUpErrors {
  TWO_FACTOR_CODE_REQUIRED: () => Error;
  PASSWORD_REQUIRED: () => Error;
  INVALID_STEP_UP: () => Error;
  MANAGER_CONFIRMATION_REQUIRED: () => Error;
}

async function requireEnrollmentStepUp(
  context: Context,
  input: {
    role: EnrollmentRole;
    totpCode?: string;
    password?: string;
    managerConfirmation?: string;
  },
  errors: StepUpErrors,
): Promise<void> {
  const user = context.session?.user;
  if (!user) throw errors.INVALID_STEP_UP();

  if (input.role === "manager" && input.managerConfirmation !== "ENROLL MANAGER") {
    throw errors.MANAGER_CONFIRMATION_REQUIRED();
  }

  // `verifyStepUpCredential`, not a bare `verifyTotpCode`: this used to reject
  // anyone without 2FA outright, which made node enrollment impossible for an
  // operator who had never set up an authenticator, while still showing them
  // a code field. The shared primitive asks for whichever credential the
  // account actually has, exactly as terminal step-up does.
  const verified = await verifyStepUpCredential(context, user, {
    totpCode: input.totpCode,
    password: input.password,
  });
  if (verified.isErr()) {
    const { reason } = verified.error;
    if (reason === "two_factor_code_required") throw errors.TWO_FACTOR_CODE_REQUIRED();
    if (reason === "password_required") throw errors.PASSWORD_REQUIRED();
    throw errors.INVALID_STEP_UP();
  }
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
      // Step-up above guarantees a session user exists; the prefix guard
      // brands the id from a runtime check instead of asserting.
      const userId = context.session?.user.id;
      if (userId === undefined || !hasPrefix(userId, ID_PREFIX.user)) {
        throw errors.INVALID_STEP_UP();
      }
      const created = await createNodeEnrollment({
        organizationId: context.activeOrganizationId,
        createdByUserId: userId,
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
        id: input.id,
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
