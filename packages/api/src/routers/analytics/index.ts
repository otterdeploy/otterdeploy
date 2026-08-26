/**
 * Web-analytics router (tracker plane): read procedures over the event
 * stream + session table, event-definition management, and the site
 * handlers (router-site.ts). Scope resolution is the one authz seam
 * (analytics/query/scope.ts); an empty scope answers with honest zeros.
 */

import type { AnalyticsSiteId } from "@otterdeploy/shared/id";

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

interface ScopedWindow {
  siteIds: AnalyticsSiteId[];
  window: ResolvedWindow;
  tz: string;
  now: number;
}

/**
 * Shared front half of every windowed read: resolve the site scope (the
 * authz decision), resolve the window, and clamp an `all` range to the
 * earliest site's creation — data cannot precede its site, and pretending
 * the window starts in 2020 would flatten every "all time" chart.
 */
async function resolveScopedWindow(
  context: Parameters<typeof resolveSiteScope>[0],
  input: SiteScopeInput & { range: RangePreset; from?: number; to?: number; tz: string },
  forbid: (message: string) => never,
): Promise<ScopedWindow> {
  const siteIds = await resolveSiteScope(context, input, forbid);
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

export const analyticsRouter = {
  site: analyticsSiteRouter,

  overview: projectScopedProcedure.analytics.overview.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "analytics", id: input.projectId ?? context.activeOrganizationId },
      });
      const { siteIds, window, tz, now } = await resolveScopedWindow(context, input, (message) => {
        throw errors.FORBIDDEN({ message });
      });
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
      context.log.set({
        target: { type: "analytics", id: input.projectId ?? context.activeOrganizationId },
      });
      const { siteIds, window } = await resolveScopedWindow(context, input, (message) => {
        throw errors.FORBIDDEN({ message });
      });
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
      context.log.set({
        target: { type: "analytics", id: input.projectId ?? context.activeOrganizationId },
      });
      const siteIds = await resolveSiteScope(context, input, (message) => {
        throw errors.FORBIDDEN({ message });
      });
      return realtimeQuery({ siteIds, now: Date.now() });
    },
  ),

  visitor: projectScopedProcedure.analytics.visitor.handler(async ({ input, context, errors }) => {
    context.log.set({
      target: { type: "analytics", id: input.projectId ?? context.activeOrganizationId },
    });
    const siteIds = await resolveSiteScope(context, input, (message) => {
      throw errors.FORBIDDEN({ message });
    });
    return visitorTrail({ siteIds, visitorId: input.visitorId, now: Date.now() });
  }),

  events: {
    list: projectScopedProcedure.analytics.events.list.handler(
      async ({ input, context, errors }) => {
        context.log.set({
          target: { type: "analytics", id: input.projectId ?? context.activeOrganizationId },
        });
        const { siteIds, window } = await resolveScopedWindow(context, input, (message) => {
          throw errors.FORBIDDEN({ message });
        });
        return {
          definitions: await listEventDefinitions({ siteIds, window, filters: input.filters }),
        };
      },
    ),

    update: requirePermission({ project: ["update"] }).analytics.events.update.handler(
      async ({ input, context, errors }) => {
        context.log.set({ target: { type: "analytics-event-definition", id: input.id } });
        const siteIds = await resolveSiteScope(context, input, (message) => {
          throw errors.FORBIDDEN({ message });
        });
        const definition = await updateEventDefinition({
          siteIds,
          id: input.id,
          displayName: input.displayName,
          conversion: input.conversion,
        });
        if (!definition) throw errors.NOT_FOUND();
        return { definition };
      },
    ),

    archive: requirePermission({ project: ["update"] }).analytics.events.archive.handler(
      async ({ input, context, errors }) => {
        context.log.set({ target: { type: "analytics-event-definition", id: input.id } });
        const siteIds = await resolveSiteScope(context, input, (message) => {
          throw errors.FORBIDDEN({ message });
        });
        const definition = await setEventDefinitionArchived({
          siteIds,
          id: input.id,
          archived: input.archived,
        });
        if (!definition) throw errors.NOT_FOUND();
        return { definition };
      },
    ),
  },
};
