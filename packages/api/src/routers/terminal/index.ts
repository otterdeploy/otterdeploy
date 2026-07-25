import { requirePermission } from "../..";
import { listTerminalTargets } from "./handlers";

export const terminalRouter = {
  targets: requirePermission({ terminal: ["open"] }).terminal.targets.handler(
    async ({ context }) => {
      context.log.set({ target: { type: "organization", id: context.activeOrganizationId } });
      return listTerminalTargets({
        organizationId: context.activeOrganizationId,
        projectIds:
          context.apiKey?.projectScope === "selected"
            ? (context.apiKey.projectIds ?? [])
            : undefined,
      });
    },
  ),
};
