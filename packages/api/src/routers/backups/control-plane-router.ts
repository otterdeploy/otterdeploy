/**
 * Whole-control-plane backup/DR endpoints — install-admin only (see
 * control-plane-contract.ts). Thin handlers over control-plane-service.ts.
 */
import { requireInstallAdmin } from "../..";
import {
  confirmControlPlaneRecoveryKeyExported,
  configureControlPlaneBackup,
  generateControlPlaneRecoveryKey,
  getControlPlaneReadiness,
  reportControlPlaneBackupRun,
} from "./control-plane-service";

export const controlPlaneBackupRouter = {
  readiness: requireInstallAdmin().backups.controlPlane.readiness.handler(
    async ({ context }) => {
      context.log.set({ target: { type: "organization", id: context.activeOrganizationId } });
      return getControlPlaneReadiness();
    },
  ),

  configure: requireInstallAdmin().backups.controlPlane.configure.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "organization", id: context.activeOrganizationId },
        controlPlaneBackup: { destinationId: input.destinationId, enabled: input.enabled },
      });
      const result = await configureControlPlaneBackup({
        organizationId: context.activeOrganizationId,
        destinationId: input.destinationId,
        enabled: input.enabled,
      });
      if ("notFound" in result) throw errors.DESTINATION_NOT_FOUND();
      return result;
    },
  ),

  recoveryKey: {
    generate: requireInstallAdmin().backups.controlPlane.recoveryKey.generate.handler(
      async ({ context }) => {
        context.log.set({
          target: { type: "organization", id: context.activeOrganizationId },
          // Never log the key material itself — only that a rotation happened.
          controlPlaneBackup: { event: "recovery-key-generated" },
        });
        return generateControlPlaneRecoveryKey();
      },
    ),

    confirmExported: requireInstallAdmin().backups.controlPlane.recoveryKey.confirmExported.handler(
      async ({ context }) => {
        context.log.set({
          target: { type: "organization", id: context.activeOrganizationId },
          controlPlaneBackup: { event: "recovery-key-export-confirmed" },
        });
        return confirmControlPlaneRecoveryKeyExported();
      },
    ),
  },

  reportRun: requireInstallAdmin().backups.controlPlane.reportRun.handler(
    async ({ input, context }) => {
      context.log.set({
        target: { type: "organization", id: context.activeOrganizationId },
        controlPlaneBackup: { runStatus: input.status, sizeBytes: input.sizeBytes },
      });
      return reportControlPlaneBackupRun(input);
    },
  ),
};
