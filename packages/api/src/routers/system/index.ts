/**
 * Platform self-update router. Reads (version, settings, check, live progress)
 * require the server-owned installation administrator identity. Organization
 * owner/admin roles intentionally grant no authority over this router.
 */
import { requireInstallAdmin } from "../..";
import { renderInstalledCaddyfile } from "../../caddy";
import { getHostHealth, growBranchPool, reclaimSpace } from "../../system-health";
import { cancelUpdate, startApply } from "./apply";
import { checkForUpdate, getUpdateSettings, getVersionInfo, saveUpdateSettings } from "./check";
import { snapshot, streamProgress } from "./state";

export const systemRouter = {
  version: requireInstallAdmin().system.version.handler(async () => {
    return getVersionInfo();
  }),

  caddyfile: requireInstallAdmin().system.caddyfile.handler(async () => {
    return renderInstalledCaddyfile();
  }),

  updateSettings: {
    get: requireInstallAdmin().system.updateSettings.get.handler(async () => {
      return getUpdateSettings();
    }),
    save: requireInstallAdmin().system.updateSettings.save.handler(async ({ input, context }) => {
      context.log.set({ target: { type: "platform" } });
      return saveUpdateSettings(input);
    }),
  },

  checkForUpdate: requireInstallAdmin().system.checkForUpdate.handler(async () => {
    return checkForUpdate();
  }),

  apply: requireInstallAdmin().system.apply.handler(async ({ context }) => {
    context.log.set({ target: { type: "platform" }, action: "platform.update" });
    return startApply();
  }),

  cancelUpdate: requireInstallAdmin().system.cancelUpdate.handler(async ({ context }) => {
    context.log.set({ target: { type: "platform" }, action: "platform.update-cancel" });
    return cancelUpdate();
  }),

  updateState: requireInstallAdmin().system.updateState.handler(async () => {
    return snapshot();
  }),

  progress: requireInstallAdmin().system.progress.handler(async function* ({ input, signal }) {
    yield* streamProgress(signal, input?.afterSeq);
  }),

  hostHealth: requireInstallAdmin().system.hostHealth.handler(async () => {
    return getHostHealth();
  }),

  reclaim: requireInstallAdmin().system.reclaim.handler(async ({ input, context }) => {
    context.log.set({ target: { type: "platform" }, action: "platform.reclaim" });
    return reclaimSpace(input.targets);
  }),

  growBranchPool: requireInstallAdmin().system.growBranchPool.handler(
    async ({ input, context }) => {
      context.log.set({ target: { type: "platform" }, action: "platform.grow-branch-pool" });
      return growBranchPool(input?.stepBytes);
    },
  ),
};
