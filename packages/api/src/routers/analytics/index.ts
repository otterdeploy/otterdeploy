/**
 * Web-analytics router (tracker plane): read procedures over the event
 * stream + session table, event-definition management, and the site
 * handlers (router-site.ts). Scope resolution is the one authz seam
 * (analytics/query/scope.ts); an empty scope answers with honest zeros.
 */

import type { AnalyticsEventDefinitionId, AnalyticsSiteId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { projectScopedProcedure, requirePermission } from "../..";
import { breakdownQuery } from "../../analytics/query/breakdown";
import {
  listEventDefinitions,
  setEventDefinitionArchived,
  updateEventDefinition,
} from "../../analytics/query/events";
import { overviewQuery } from "../../analytics/query/overview";
import { liveVisitorCount, realtimeQuery } from "../../analytics/query/realtime";
import {
  type SiteScopeInput,
  earliestSiteCreatedAt,
  resolveSiteScope,
} from "../../analytics/query/scope";
import { visitorTrail } from "../../analytics/query/visitor";
import {
  bucketFor,
  type RangePreset,
  type ResolvedWindow,
  resolveWindow,
  safeTimeZone,
} from "../../analytics/query/window";
import { analyticsSiteRouter } from "./router-site";

type QueryContext = Parameters<typeof resolveSiteScope>[0] & { log: RequestLogger };
type WindowedInput = SiteScopeInput & {
  range: RangePreset;
  from?: number;
  to?: number;
  tz: string;
};

interface ScopeErrors {
  FORBIDDEN(input: { message: string }): Error;
}

interface ScopedWindow {
  siteIds: AnalyticsSiteId[];
  window: ResolvedWindow;
  tz: string;
  now: number;
}

/**
 * Shared prologue of every read: stamp the audit target (the project, or the
 * org when the read spans it) and resolve the site scope — the authz
 * decision, with its refusal surfaced as the contract's FORBIDDEN.
 */
async function resolveScope(
  context: QueryContext,
  input: SiteScopeInput,
  errors: ScopeErrors,
): Promise<AnalyticsSiteId[]> {
  context.log.set({
    target: { type: "analytics", id: input.projectId ?? context.activeOrganizationId },
  });
  return resolveSiteScope(context, input, (message) => {
    throw errors.FORBIDDEN({ message });
  });
}

/**
 * The windowed reads' prologue: the scope above, then the window, clamping
 * an `all` range to the earliest site's creation — data cannot precede its
 * site, and pretending the window starts in 2020 would flatten every "all
 * time" chart.
 */
async function resolveScopedWindow(
  context: QueryContext,
  input: WindowedInput,
  errors: ScopeErrors,
): Promise<ScopedWindow> {
  const siteIds = await resolveScope(context, input, errors);
  const now = Date.now();
  let window = resolveWindow({
    range: input.range,
    from: input.from,
    to: input.to,
    tz: input.tz,
    now,
  });
  if (input.range === "all") {
    const earliest = await earliestSiteCreatedAt(siteIds);
    if (earliest !== null && earliest > window.from) {
      const span = window.to - earliest;
      window = {
        from: earliest,
        to: window.to,
        previous: { from: earliest - span, to: earliest },
        bucket: bucketFor(span),
      };
    }
  }
  return { siteIds, window, tz: safeTimeZone(input.tz), now };
}

/** Mutations on one definition: the audit target is the definition itself,
 *  the scope is still the caller's (a definition outside it reads as absent). */
async function resolveDefinitionScope(
  context: QueryContext,
  input: SiteScopeInput & { id: AnalyticsEventDefinitionId },
  errors: ScopeErrors,
): Promise<AnalyticsSiteId[]> {
  context.log.set({ target: { type: "analytics-event-definition", id: input.id } });
  return resolveSiteScope(context, input, (message) => {
    throw errors.FORBIDDEN({ message });
  });
}

function definitionOr404<T>(definition: T | null, errors: { NOT_FOUND(): Error }): T {
  if (!definition) throw errors.NOT_FOUND();
  return definition;
}

export const analyticsRouter = {
  site: analyticsSiteRouter,

  overview: projectScopedProcedure.analytics.overview.handler(
    async ({ input, context, errors }) => {
      const { siteIds, window, tz, now } = await resolveScopedWindow(context, input, errors);
      const [result, liveVisitors] = await Promise.all([
        overviewQuery({
          siteIds,
          window,
          tz,
          filters: input.filters,
          compare: input.compare,
          now,
        }),
        liveVisitorCount(siteIds, now),
      ]);
      return {
        ...result,
        liveVisitors,
        window: { from: window.from, to: window.to, previous: window.previous },
      };
    },
  ),

  breakdown: projectScopedProcedure.analytics.breakdown.handler(
    async ({ input, context, errors }) => {
      const { siteIds, window } = await resolveScopedWindow(context, input, errors);
      return breakdownQuery({
        siteIds,
        window,
        filters: input.filters,
        dimension: input.dimension,
        limit: input.limit,
        offset: input.offset,
      });
    },
  ),

  realtime: projectScopedProcedure.analytics.realtime.handler(
    async ({ input, context, errors }) => {
      const siteIds = await resolveScope(context, input, errors);
      return realtimeQuery({ siteIds, now: Date.now() });
    },
  ),

  visitor: projectScopedProcedure.analytics.visitor.handler(async ({ input, context, errors }) => {
    const siteIds = await resolveScope(context, input, errors);
    return visitorTrail({ siteIds, visitorId: input.visitorId, now: Date.now() });
  }),

  events: {
    list: projectScopedProcedure.analytics.events.list.handler(
      async ({ input, context, errors }) => {
        const { siteIds, window } = await resolveScopedWindow(context, input, errors);
        return {
          definitions: await listEventDefinitions({ siteIds, window, filters: input.filters }),
        };
      },
    ),

    update: requirePermission({ project: ["update"] }).analytics.events.update.handler(
      async ({ input, context, errors }) => {
        const siteIds = await resolveDefinitionScope(context, input, errors);
        const definition = await updateEventDefinition({
          siteIds,
          id: input.id,
          displayName: input.displayName,
          conversion: input.conversion,
        });
        return { definition: definitionOr404(definition, errors) };
      },
    ),

    archive: requirePermission({ project: ["update"] }).analytics.events.archive.handler(
      async ({ input, context, errors }) => {
        const siteIds = await resolveDefinitionScope(context, input, errors);
        const definition = await setEventDefinitionArchived({
          siteIds,
          id: input.id,
          archived: input.archived,
        });
        return { definition: definitionOr404(definition, errors) };
      },
    ),
  },
};
