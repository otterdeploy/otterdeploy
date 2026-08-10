import { orgScopedProcedure, requirePermission } from "../..";
import { grantStepUp, hasRecentStepUp, verifyStepUpCredential } from "../../authz/step-up";
import { authorizeTerminalTarget, type TerminalTarget } from "./authorize";
import { listTerminalTargets } from "./handlers";
import { mintTerminalTicket, ticketBindingIp } from "./tickets";

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

  // ── od-5j8.9: step-up + single-use ticket for the /pty WS upgrade ──────

  stepUp: orgScopedProcedure.terminal.stepUp.handler(async ({ input, context, errors }) => {
    if (!context.session) throw errors.INTERACTIVE_SESSION_REQUIRED();

    const verified = await verifyStepUpCredential(context, context.session.user, input);
    if (verified.isErr()) {
      switch (verified.error.reason) {
        case "two_factor_code_required":
          throw errors.TWO_FACTOR_CODE_REQUIRED();
        case "password_required":
          throw errors.PASSWORD_REQUIRED();
        default:
          throw errors.INVALID_STEP_UP();
      }
    }

    const grantedUntil = await grantStepUp(context.session.user.id);
    context.log.set({ target: { type: "user", id: context.session.user.id } });
    return { grantedUntil: grantedUntil.toISOString() };
  }),

  mintTicket: orgScopedProcedure.terminal.mintTicket.handler(async ({ input, context, errors }) => {
    // Tickets authenticate an interactive shell for a real human, never an
    // organization API key, which is also where the step-up credential
    // (password/TOTP) wouldn't even make sense.
    if (!context.session) throw errors.INTERACTIVE_SESSION_REQUIRED();

    if (!(await hasRecentStepUp(context.session.user.id))) {
      throw errors.STEP_UP_REQUIRED();
    }

    const target: TerminalTarget =
      input.target.kind === "container"
        ? { kind: "container", id: input.target.containerId }
        : { kind: "host" };

    const authorized = await authorizeTerminalTarget(
      context.actor,
      context.activeOrganizationId,
      target,
    );
    if (authorized.isErr()) {
      if (authorized.error.status === 404)
        throw errors.NOT_FOUND({ message: authorized.error.message });
      throw errors.FORBIDDEN({ message: authorized.error.message });
    }

    const minted = await mintTerminalTicket({
      userId: context.session.user.id,
      organizationId: context.activeOrganizationId,
      target,
      clientIp: ticketBindingIp(context.headers),
    });

    context.log.set({
      target: { type: target.kind, id: target.kind === "container" ? target.id : "host" },
    });

    return { ticket: minted.token, expiresAt: minted.expiresAt.toISOString() };
  }),
};
