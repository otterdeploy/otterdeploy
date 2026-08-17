import { useEffect, useState } from "react";

import { OtterdeployMark } from "@/components/brand/otterdeploy-mark";

import { RAIL_STATIONS } from "./content";
import { cx, Mono, StateChip } from "./primitives";

/**
 * The deploy rail. The hero's instrument.
 *
 * One deployment, drawn as the stations it passes through, in the platform's
 * own words (`pending` → `building` → `running` are `deployment_status`
 * members; `tls` resolves a `proxy_route_cert_state`).
 *
 * The default render is the FINISHED state: every station lit, the URL live.
 * That matters. SSR, a headless renderer, a background tab and a reader with
 * `prefers-reduced-motion` all get a complete, legible diagram instead of an
 * empty rail waiting on a transition that never fires. Motion is layered on
 * top for readers who can take it.
 */

const STEP_MS = 560;
const TOTAL = RAIL_STATIONS.length;
/** The rail spans dot-centre to dot-centre, so it stops under the last tick. */
const TRACK_WIDTH = `${((TOTAL - 1) / TOTAL) * 100}%`;

export function DeployRail() {
  // Finished by default; the effect rewinds only when motion is welcome.
  const [step, setStep] = useState(TOTAL);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Rewind after the first paint, never during it: the finished rail is what
    // gets painted, and what a hydration mismatch would otherwise argue with.
    let interval: ReturnType<typeof setInterval> | undefined;
    const frame = requestAnimationFrame(() => {
      setStep(0);
      interval = setInterval(() => {
        setStep((s) => {
          if (s >= TOTAL) {
            if (interval) clearInterval(interval);
            return s;
          }
          return s + 1;
        });
      }, STEP_MS);
    });

    return () => {
      cancelAnimationFrame(frame);
      if (interval) clearInterval(interval);
    };
  }, []);

  const done = step >= TOTAL;
  const reached = Math.min(step, TOTAL - 1);
  const progress = TOTAL > 1 ? (reached / (TOTAL - 1)) * 100 : 100;

  return (
    <figure
      aria-label="Diagram: the stages one git-sourced deployment passes through."
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <figcaption className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <OtterdeployMark size={16} status={done ? "success" : "deploying"} titled />
        <Mono className="min-w-0 truncate text-foreground">storefront / web</Mono>
        <span className="ml-auto shrink-0">
          <StateChip tone={done ? "success" : "info"}>
            {done ? "running" : RAIL_STATIONS[reached].key}
          </StateChip>
        </span>
      </figcaption>

      <div className="px-5 pt-9 pb-6">
        <div className="relative">
          {/* Track and fill sit behind the stations; the stations own the
              layout, so the line can never disagree with the tick spacing.
              Hidden below `sm`, where the grid wraps to two rows and a single
              horizontal line would be a lie about the order. */}
          <div
            aria-hidden
            className="absolute top-1 left-0 hidden h-px -translate-y-1/2 bg-border sm:block"
            style={{ width: TRACK_WIDTH }}
          />
          <div
            aria-hidden
            className="absolute top-1 left-0 hidden h-px -translate-y-1/2 bg-foreground/40 transition-[width] duration-500 ease-out motion-reduce:transition-none sm:block"
            style={{ width: `calc(${TRACK_WIDTH} * ${progress / 100})` }}
          />
          {!done ? (
            <span
              aria-hidden
              className="od-comet absolute top-1 hidden size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left] duration-500 ease-out motion-reduce:transition-none sm:block"
              style={{
                left: `calc(${TRACK_WIDTH} * ${progress / 100})`,
                background: "var(--od-accent)",
              }}
            />
          ) : null}

          <ol className="relative grid grid-cols-3 gap-y-6 sm:grid-cols-6 sm:gap-y-0">
            {RAIL_STATIONS.map((station, i) => {
              const lit = i < step;
              return (
                <li key={station.key} className="flex min-w-0 flex-col items-start gap-2.5 pr-3">
                  <span
                    className={cx(
                      "relative z-10 size-2 rounded-full ring-4 ring-card transition-colors duration-300 motion-reduce:transition-none",
                      lit ? "bg-success" : "bg-border",
                    )}
                  />
                  <span className="min-w-0">
                    <Mono
                      className={cx(
                        "block truncate transition-colors duration-300 motion-reduce:transition-none",
                        lit ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {station.key}
                    </Mono>
                    <Mono
                      className={cx(
                        "mt-1 block truncate transition-colors duration-300 motion-reduce:transition-none",
                        lit ? "text-muted-foreground" : "text-muted-foreground/60",
                      )}
                    >
                      {station.note}
                    </Mono>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-background px-4 py-3">
        <span
          className={cx(
            "size-1.5 shrink-0 rounded-full transition-colors duration-300 motion-reduce:transition-none",
            done ? "bg-success" : "bg-border",
          )}
        />
        <Mono
          className={cx("min-w-0 truncate", done ? "text-foreground" : "text-muted-foreground")}
        >
          https://storefront.example.com
        </Mono>
        <Mono className="ml-auto shrink-0 text-muted-foreground">
          {done ? "23.1s" : "deploying"}
        </Mono>
      </div>
    </figure>
  );
}
