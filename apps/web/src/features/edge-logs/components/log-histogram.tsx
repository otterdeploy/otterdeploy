import { BUCKET_BG, type EdgeLogsData } from "./edge-logs-constants";

function Bar({ n, total, cls }: { n: number; total: number; cls: string }) {
  if (n === 0 || total === 0) return null;
  return <div className={cls} style={{ height: `${(n / total) * 100}%` }} />;
}

/** Volume histogram, stacked by status bucket. `labels` are the window's
 *  start/end axis captions (e.g. "−1h" / "now", or the custom range ends). */
export function LogHistogram({
  data,
  labels,
}: {
  data: EdgeLogsData | undefined;
  labels: { start: string; end: string };
}) {
  const maxBucket = Math.max(
    1,
    ...(data?.histogram ?? []).map((b) => b.c2xx + b.c3xx + b.c4xx + b.c5xx),
  );
  return (
    <div className="border-b px-4 pt-3 pb-2">
      <div className="mb-1.5 flex items-center">
        <span className="text-[10px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          Volume
        </span>
        <div className="flex-1" />
        <span className="font-mono text-[11px] text-muted-foreground">
          {data?.total ?? 0} matched
        </span>
      </div>
      <div className="flex h-[52px] items-end gap-px">
        {(data?.histogram ?? []).map((b) => {
          const total = b.c2xx + b.c3xx + b.c4xx + b.c5xx;
          const h = (total / maxBucket) * 100;
          return (
            <div
              key={b.t}
              className="flex flex-1 flex-col-reverse"
              style={{ height: `${Math.max(2, h)}%`, minHeight: 1 }}
              title={`${new Date(b.t).toLocaleTimeString()} · ${total} req`}
            >
              <Bar n={b.c2xx} total={total} cls={BUCKET_BG["2xx"]} />
              <Bar n={b.c3xx} total={total} cls={BUCKET_BG["3xx"]} />
              <Bar n={b.c4xx} total={total} cls={BUCKET_BG["4xx"]} />
              <Bar n={b.c5xx} total={total} cls={BUCKET_BG["5xx"]} />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex font-mono text-[10px] text-muted-foreground/70">
        <span>{labels.start}</span>
        <div className="flex-1" />
        <span>{labels.end}</span>
      </div>
    </div>
  );
}
