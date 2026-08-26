/**
 * One visitor's trail for the current day: sessions as sections, each with a
 * vertical timeline of pageviews and events. The identity at the top is the
 * same derived name and dot as the list rows — nothing here is stored, and
 * the trail resets with the daily hash rotation, which the empty copy says.
 */

import { useTranslation } from "react-i18next";

import { CountryFlag } from "@/features/analytics/components/country-flag";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { CLOCK_MINUTES, clockFormatter } from "@/shared/lib/clock";

import { type AnalyticsScope, useVisitorTrail } from "../../hooks/use-web-analytics";
import { formatDurationMs } from "../../lib/format-duration";
import { isoMs } from "../../lib/iso-ms";
import { visitorDotColor, visitorIdentity } from "../../lib/visitor-name";

const clock = clockFormatter(CLOCK_MINUTES);

export function VisitorSheet({
  scope,
  visitorId,
  onOpenChange,
}: {
  scope: AnalyticsScope;
  visitorId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const trail = useVisitorTrail(scope, visitorId);
  const identity = visitorId === null ? null : visitorIdentity(visitorId);

  return (
    <Sheet open={visitorId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2.5">
            {identity ? (
              <span
                aria-hidden="true"
                className="size-2.5 rounded-full"
                style={{ background: visitorDotColor(identity.hue) }}
              />
            ) : null}
            {identity?.name}
          </SheetTitle>
          <SheetDescription>{t("analytics.realtime.trailDescription")}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-6">
          {trail.isPending ? (
            <>
              <Skeleton className="h-24 w-full rounded-md" />
              <Skeleton className="h-24 w-full rounded-md" />
            </>
          ) : trail.data === undefined || trail.data.sessions.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {t("analytics.realtime.trailEmpty")}
            </p>
          ) : (
            trail.data.sessions.map((session) => (
              <section key={session.sessionId} className="flex flex-col gap-2">
                <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-xs tabular-nums">
                    {stamp(session.startedAt)} – {stamp(session.lastAt)}
                  </span>
                  {session.country ? <CountryFlag code={session.country} /> : null}
                  <span className="text-xs text-muted-foreground">
                    {session.browser} · {session.os} · {session.device}
                  </span>
                </header>
                <p className="text-xs text-muted-foreground">
                  {t("analytics.realtime.sessionSummary", {
                    pageviews: session.pageviews,
                    duration: formatDurationMs(session.activeMs),
                    referrer: session.referrerHost ?? t("analytics.realtime.direct"),
                  })}
                </p>
                <ol className="flex flex-col border-l border-border pl-4">
                  {session.eventsList.map((event, index) => (
                    <li key={index} className="relative flex items-baseline gap-2.5 py-1">
                      <span
                        aria-hidden="true"
                        className={
                          event.kind === "pageview"
                            ? "absolute top-2.5 -left-[1.1875rem] size-1.5 rounded-full bg-foreground/25"
                            : "absolute top-2.5 -left-[1.1875rem] size-1.5 rounded-full bg-foreground/60"
                        }
                      />
                      <span className="w-11 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                        {stamp(event.ts)}
                      </span>
                      {event.kind === "pageview" ? (
                        <span className="min-w-0 truncate font-mono text-xs" title={event.path}>
                          {event.path}
                        </span>
                      ) : (
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className="truncate text-xs font-medium">
                            {event.name ?? event.kind}
                          </span>
                          <span
                            className="truncate font-mono text-[11px] text-muted-foreground"
                            title={event.path}
                          >
                            {event.path}
                          </span>
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function stamp(iso: string): string {
  const ms = isoMs(iso);
  return ms === null ? "–" : clock(ms);
}
