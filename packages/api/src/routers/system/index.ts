/**
 * Platform self-update router. Reads (version, settings, check, live progress)
 * require `platform:read`; mutations (apply, save settings) require
 * `platform:update` — admins/owners only. See docs + contract.ts.
 */
import { requirePermission } from "../..";
import { getHostHealth, growBranchPool, reclaimSpace } from "../../system-health";
import { startApply } from "./apply";
import { checkForUpdate, getUpdateSettings, getVersionInfo, saveUpdateSettings } from "./check";
import { snapshot, streamProgress } from "./state";

export const systemRouter = {
  version: requirePermission({ platform: ["read"] }).system.version.handler(async () => {
    return getVersionInfo();
  }),

  updateSettings: {
    get: requirePermission({ platform: ["read"] }).system.updateSettings.get.handler(async () => {
      return getUpdateSettings();
    }),
    save: requirePermission({ platform: ["update"] }).system.updateSettings.save.handler(
      async ({ input, context }) => {
        context.log.set({ target: { type: "platform" } });
        return saveUpdateSettings(input);
      },
    ),
  },

  checkForUpdate: requirePermission({ platform: ["read"] }).system.checkForUpdate.handler(
    async () => {
      return checkForUpdate();
    },
  ),

  apply: requirePermission({ platform: ["update"] }).system.apply.handler(async ({ context }) => {
    context.log.set({ target: { type: "platform" }, action: "platform.update" });
    return startApply();
  }),

  updateState: requirePermission({ platform: ["read"] }).system.updateState.handler(async () => {
    return snapshot();
  }),

  progress: requirePermission({ platform: ["read"] }).system.progress.handler(async function* ({
    signal,
  }) {
    yield* streamProgress(signal);
  }),

  hostHealth: requirePermission({ platform: ["read"] }).system.hostHealth.handler(async () => {
    return getHostHealth();
  }),

  reclaim: requirePermission({ platform: ["update"] }).system.reclaim.handler(
    async ({ input, context }) => {
      context.log.set({ target: { type: "platform" }, action: "platform.reclaim" });
      return reclaimSpace(input.targets);
    },
  ),

  growBranchPool: requirePermission({ platform: ["update"] }).system.growBranchPool.handler(
    async ({ input, context }) => {
      context.log.set({ target: { type: "platform" }, action: "platform.grow-branch-pool" });
      return growBranchPool(input?.stepBytes);
    },
  ),
};
