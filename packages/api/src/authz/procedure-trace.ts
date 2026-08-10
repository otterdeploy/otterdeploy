/**
 * The per-procedure evlog compliance trail: the one middleware every oRPC
 * procedure runs through, which turns each call into a wide event and (for
 * mutations and denials) an audit row.
 *
 * Split out of ../index.ts so that file stays a readable map of the procedure
 * *ladder* — public → protected → org-scoped → permission-gated. This module
 * owns the observability/audit concern instead, and sits next to the helpers it
 * consumes (`procedure-audit` for actor/error classification, `procedure-mode`
 * for the read-vs-write decision).
 */

import { os as orpc } from "@orpc/server";

import type { AuditDraft } from "../audit/changes";
import type { Context } from "../context";

import type { UnknownRecord } from "@otterdeploy/shared/json";

import { classifyTraceError, traceActor } from "./procedure-audit";
import { isReadAction, isReadMethod } from "./procedure-mode";

// Per-procedure evlog compliance trail. Handlers add target/domain fields.
export const traceProcedure = orpc
  .$context<Context>()
  .middleware(async ({ context, path, procedure, next }) => {
    const action = path.join(".");
    const actor = traceActor(context);
    // Prefer the procedure's own REST method (GET ⇒ read) — exact, and
    // immune to naming drift. Only endpoints with no method at all (neither
    // `.route()` nor `.meta({method})`) fall back to the verb-prefix guess.
    const orpcDef = procedure["~orpc"];
    const meta: UnknownRecord | undefined = orpcDef.meta;
    const route = orpcDef.route as { method?: string } | undefined;
    const isRead = isReadMethod(meta, route) ?? isReadAction(action);
    // Top-level fields keep the console/observability wide event informative.
    context.log.set({
      action,
      actor,
      context: { tenantId: context.activeOrganizationId },
    });
    // Fresh per invocation, and passed by reference so a handler's write is
    // visible here even if an inner middleware rebuilt the context object.
    // See audit/changes.ts for why it is a draft and not a plain field.
    const auditDraft: AuditDraft = {};
    const start = performance.now();
    try {
      const result = await next({ context: { auditDraft } });
      context.log.set({
        outcome: "success",
        durationMs: performance.now() - start,
      });
      // Persist mutations; skip read successes. Tenant id rides on the
      // top-level `context.tenantId` set above (the pg drain reads it); request
      // meta (ip/ua/requestId) is filled into `audit.context` by auditEnricher.
      if (!isRead) {
        context.log.audit?.({
          action,
          actor,
          outcome: "success",
          // Present only for handlers that recorded one; the rest keep the
          // column null rather than claiming an empty diff.
          ...(auditDraft.changes ? { changes: auditDraft.changes } : {}),
        });
      }
      return result;
    } catch (error) {
      const { reason, denied, detail } = classifyTraceError(error);
      context.log.set({
        outcome: denied ? "denied" : "failure",
        reason,
        error: detail,
        durationMs: performance.now() - start,
      });
      // Always audit denials (even of a read — a blocked read is exactly
      // what auditors want); audit failures only for mutating actions.
      if (denied) {
        context.log.audit?.deny(reason, { action, actor });
      } else if (!isRead) {
        context.log.audit?.({ action, actor, outcome: "failure", reason });
      }
      throw error;
    }
  });
