/**
 * Why the Analytics page has no numbers, when the reason is not "nobody
 * visited".
 *
 * Its own module rather than another export from analytics-view-parts.tsx:
 * that file is the page's layout vocabulary (tiles, chart cards, the breakdown
 * grid), and this is a statement about the health of the collection pipeline.
 *
 * It renders ABOVE the dashboard rather than replacing it. The page used to
 * substitute one centred line for all fourteen panels the moment the host
 * count hit zero, which meant a fresh install never saw the shape of what it
 * was setting up — and the line it did see ("No traffic recorded in this
 * window") blamed the time range for a condition no time range could fix.
 *
 * Four states, in priority order. Only the first two are faults; the third and
 * fourth are ordinary conditions and get a quiet line rather than a card.
 *
 * Machine tokens (the env var, the log key) are rendered as their own mono
 * element rather than embedded in the translated sentence. Splicing markup
 * into a translation needs `<Trans>`, which this codebase does not use
 * anywhere, and it hands translators a string they can silently break.
 */

import { useTranslation } from "react-i18next";

export function CollectionNotice({
  sinkConfigured,
  collecting,
  geoAvailable,
  hasHosts,
  requests,
}: {
  sinkConfigured: boolean;
  collecting: boolean;
  geoAvailable: boolean;
  /** Whether any public domain exists in scope at all. */
  hasHosts: boolean;
  requests: number;
}) {
  const { t } = useTranslation();

  if (!sinkConfigured) {
    return (
      <NoticeCard
        title={t("analytics.collection.offTitle")}
        body={t("analytics.collection.offBody")}
        code="EDGE_LOG_SINK"
      />
    );
  }

  if (!collecting) {
    return (
      <NoticeCard
        title={t("analytics.collection.stalledTitle")}
        body={t("analytics.collection.stalledBody")}
        code="edgeLog.analytics"
      />
    );
  }

  if (!hasHosts) {
    return (
      <NoticeCard
        title={t("analytics.collection.noHostsTitle")}
        body={t("analytics.collection.noHostsBody")}
      />
    );
  }

  return (
    <>
      {requests === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("analytics.collection.quiet")}</p>
      ) : null}
      {/* Only worth saying once traffic is arriving: before that, an empty map
          is the least of the operator's problems. */}
      {!geoAvailable && requests > 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("analytics.collection.geoOff")}</p>
      ) : null}
    </>
  );
}

/** Flat, hairline, no accent fill: this is a statement of fact about the
 *  install, not an alarm (DESIGN.md keeps the accent under 10% of a screen). */
function NoticeCard({ title, body, code }: { title: string; body: string; code?: string }) {
  return (
    <div className="rounded-lg p-4 ring-1 ring-foreground/10">
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
      {/* Mono for machine output, per DESIGN.md. */}
      {code ? (
        <code className="mt-2 inline-block rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
          {code}
        </code>
      ) : null}
    </div>
  );
}
