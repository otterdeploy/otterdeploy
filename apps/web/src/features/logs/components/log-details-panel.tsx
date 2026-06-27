// Right-hand "Log details" panel — slides in when a row is clicked. Mirrors the
// graph resource panel's motion pattern. Shows the full (coalesced) message; when
// the message is valid JSON it's pretty-printed via the shared JsonView, with a
// raw/prettify toggle.

import { useMemo, useState } from "react";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-client";

import { Button } from "@/shared/components/ui/button";
import { JsonView } from "@/shared/components/ui/json-view";
import { cn } from "@/shared/lib/utils";

import { LEVEL_TEXT, type LogLine } from "../data/use-project-log-stream";

function parseJson(msg: string): unknown {
  const t = msg.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return undefined;
  try {
    const v = JSON.parse(t);
    return v && typeof v === "object" ? v : undefined;
  } catch {
    return undefined;
  }
}

export function LogDetailsPanel({ line, onClose }: { line: LogLine | null; onClose: () => void }) {
  // Overlay the table's right edge (absolute) rather than pushing it — opening
  // mustn't reflow / re-measure the virtualized table. A STABLE key keeps the
  // panel mounted while switching rows, so the content just updates in place
  // instead of exit/enter-animating a fresh panel each click.
  return (
    <AnimatePresence>
      {line ? <Panel key="log-details" line={line} onClose={onClose} /> : null}
    </AnimatePresence>
  );
}

function Panel({ line, onClose }: { line: LogLine; onClose: () => void }) {
  const json = useMemo(() => parseJson(line.msg), [line.msg]);
  const [raw, setRaw] = useState(false);

  return (
    <m.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 360, damping: 38 }}
      className="absolute inset-y-0 right-0 z-20 flex w-[440px] flex-col border-l bg-card shadow-xl"
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">Log details</div>
          <div className="mt-0.5 flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
            <span className="truncate">{line.tsIso ?? line.ts}</span>
            <span className={cn("tracking-[0.08em] uppercase", LEVEL_TEXT[line.level])}>
              {line.level}
            </span>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close details"
          onClick={onClose}
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 font-mono text-[11.5px]">
          <Meta label="service" value={line.svc} />
          <Meta label="stream" value={line.stream} />
          <Meta label="resource" value={line.resourceId || "—"} />
        </dl>

        <div className="mt-4 flex items-center justify-between">
          <span className="text-[10px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
            Message
          </span>
          {json !== undefined && (
            <button
              type="button"
              onClick={() => setRaw((v) => !v)}
              className="rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {raw ? "prettify" : "raw"}
            </button>
          )}
        </div>

        {json !== undefined && !raw ? (
          <JsonView
            data={json}
            className="mt-1.5 rounded-md border bg-background/60 p-3 text-[11.5px]"
          />
        ) : (
          <pre className="mt-1.5 overflow-auto rounded-md border bg-background/60 p-3 font-mono text-[11.5px] leading-relaxed break-words whitespace-pre-wrap text-foreground/90">
            {line.msg}
          </pre>
        )}
      </div>
    </m.div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all text-foreground/90">{value}</dd>
    </>
  );
}
