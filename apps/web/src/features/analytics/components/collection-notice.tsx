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
 */

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
  if (!sinkConfigured) {
    return (
      <NoticeCard title="Traffic collection is off">
        No access logs are reaching this install, so nothing is being recorded. This is not an empty
        window — no window would have data. Set <Mono>EDGE_LOG_SINK</Mono> on the server (the
        production compose file already does) and restart it to start collecting.
      </NoticeCard>
    );
  }

  if (!collecting) {
    return (
      <NoticeCard title="Collection is configured but not running">
        The sink is set, but the analytics rollup refused to start — it does that deliberately when
        its day-row seed fails, rather than risk overwriting earlier totals. Check the server log
        for <Mono>edgeLog.analytics</Mono>; the next restart retries.
      </NoticeCard>
    );
  }

  if (!hasHosts) {
    return (
      <NoticeCard title="No public domains yet">
        Collection is running. Analytics starts recording as soon as a service is exposed on a
        domain.
      </NoticeCard>
    );
  }

  return (
    <>
      {requests === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Collecting. No requests in this window yet.
        </p>
      ) : null}
      {/* Only worth saying once traffic is actually arriving: before that, an
          empty map is the least of the operator's problems. */}
      {!geoAvailable && requests > 0 ? (
        <p className="text-[13px] text-muted-foreground">
          GeoIP isn&apos;t configured on this install, so visitor countries can&apos;t be resolved
          and the map stays empty.
        </p>
      ) : null}
    </>
  );
}

/** Flat, hairline, no accent fill: this is a statement of fact about the
 *  install, not an alarm (DESIGN.md keeps the accent under 10% of a screen). */
function NoticeCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg p-4 ring-1 ring-foreground/10">
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

/** Machine strings (env vars, log keys) in mono, per DESIGN.md. */
function Mono({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{children}</code>;
}
