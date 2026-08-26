/**
 * The Realtime view: the live count with the paths being read right now, the
 * online visitors, and the sessions from earlier today. Visitors carry
 * derived anonymous identities (name + wheel dot) so a person can be followed
 * across rows without anything being stored about them. Polls every 10 s.
 */

import { useState } from "react";

import { Temporal } from "@otterdeploy/shared/temporal";
import { useTranslation } from "react-i18next";

import { CountryFlag } from "@/features/analytics/components/country-flag";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";
import { Skeleton } from "@/shared/components/ui/skeleton";

import { formatCount } from "../../analytics-model";
import { type AnalyticsScope, useRealtime } from "../../hooks/use-web-analytics";
import { formatAgo } from "../../lib/format-duration";
import { isoMs } from "../../lib/iso-ms";
import { visitorDotColor, visitorIdentity } from "../../lib/visitor-name";
import { VisitorSheet } from "./visitor-sheet";

export function RealtimeView({ scope }: { scope: AnalyticsScope }) {
  const { t } = useTranslation();
  const query = useRealtime(scope);
  const [openVisitor, setOpenVisitor] = useState<string | null>(null);
  const data = query.data;
  const nowMs = Temporal.Now.instant().epochMilliseconds;

  if (data === undefined) {
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-64 rounded-lg lg:col-span-2" />
      </div>
    );
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-3">
      <section className="flex flex-col gap-4 rounded-lg bg-card px-4 py-4 ring-1 ring-foreground/10">
        <div>
          <div className="font-mono text-5xl leading-none font-medium tabular-nums">
            {formatCount(data.liveVisitors)}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{t("analytics.realtime.liveNow")}</p>
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-medium text-muted-foreground">
            {t("analytics.realtime.topPages")}
          </h3>
          {data.byPath.length === 0 ? (
            <p className="py-1 text-xs text-muted-foreground">{t("analytics.realtime.nobody")}</p>
          ) : (
            <ul className="flex flex-col">
              {data.byPath.map((entry) => (
                <li key={entry.path} className="flex items-center gap-2 py-1">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs" title={entry.path}>
                    {entry.path}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    {formatCount(entry.visitors)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="flex flex-col gap-4 lg:col-span-2">
        <section className="flex flex-col rounded-lg bg-card ring-1 ring-foreground/10">
          <h3 className="border-b border-border px-4 py-2.5 text-sm font-medium">
            {t("analytics.realtime.online")}
          </h3>
          {data.online.length === 0 ? (
            <Empty className="m-3 rounded-md border border-dashed bg-muted/20 py-8">
              <EmptyHeader>
                <EmptyTitle>{t("analytics.realtime.noOnlineTitle")}</EmptyTitle>
                <EmptyDescription>{t("analytics.realtime.noOnlineBody")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="divide-y divide-border/60">
              {data.online.map((entry) => (
                <VisitorRow
                  key={entry.sessionId}
                  visitorId={entry.visitorId}
                  path={entry.path}
                  country={entry.country}
                  meta={`${entry.browser} · ${entry.os} · ${entry.device}`}
                  agoMs={agoOf(entry.lastSeenAt, nowMs)}
                  live
                  onOpen={() => setOpenVisitor(entry.visitorId)}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col rounded-lg bg-card ring-1 ring-foreground/10">
          <h3 className="border-b border-border px-4 py-2.5 text-sm font-medium">
            {t("analytics.realtime.earlierToday")}
          </h3>
          {data.recent.filter((s) => !s.live).length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              {t("analytics.realtime.noRecent")}
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {data.recent
                .filter((s) => !s.live)
                .map((session) => (
                  <VisitorRow
                    key={session.sessionId}
                    visitorId={session.visitorId}
                    path={session.exitPath}
                    country={session.country}
                    meta={t("analytics.realtime.sessionMeta", {
                      pageviews: session.pageviews,
                      referrer: session.referrerHost ?? t("analytics.realtime.direct"),
                    })}
                    agoMs={agoOf(session.lastAt, nowMs)}
                    live={false}
                    onOpen={() => setOpenVisitor(session.visitorId)}
                  />
                ))}
            </ul>
          )}
        </section>
      </div>

      <VisitorSheet
        scope={scope}
        visitorId={openVisitor}
        onOpenChange={(open) => {
          if (!open) setOpenVisitor(null);
        }}
      />
    </div>
  );
}

function agoOf(iso: string, nowMs: number): number | null {
  const ms = isoMs(iso);
  return ms === null ? null : Math.max(nowMs - ms, 0);
}

function VisitorRow({
  visitorId,
  path,
  country,
  meta,
  agoMs,
  live,
  onOpen,
}: {
  visitorId: string;
  path: string;
  country: string | null;
  meta: string;
  agoMs: number | null;
  live: boolean;
  onOpen: () => void;
}) {
  const identity = visitorIdentity(visitorId);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full"
          style={{ background: visitorDotColor(identity.hue) }}
        />
        <span className="w-32 shrink-0 truncate text-sm font-medium">{identity.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={path}>
          {path}
        </span>
        {country ? <CountryFlag code={country} /> : null}
        <span className="hidden max-w-44 shrink-0 truncate text-xs text-muted-foreground sm:block">
          {meta}
        </span>
        <span className="w-16 shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
          {agoMs === null ? "–" : formatAgo(agoMs)}
        </span>
        {live ? (
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success" />
        ) : null}
      </button>
    </li>
  );
}
