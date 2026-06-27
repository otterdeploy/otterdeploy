import { orgScopedProcedure } from "../..";
import { listTerminalTargets } from "./handlers";

export const terminalRouter = {
  targets: orgScopedProcedure.terminal.targets.handler(async ({ context }) => {
    context.log.set({ target: { type: "organization", id: context.activeOrganizationId } });
    return listTerminalTargets({ organizationId: context.activeOrganizationId });
  }),
};
