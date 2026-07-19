/**
 * Collapsible legend for the graph canvas (bottom-left): the edge vocabulary
 * (dependency vs live traffic) and the node status dot key. Collapse state
 * persists globally — it's a viewing preference, not project state.
 */

import { useState } from "react";

import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/shared/lib/utils";

const STORAGE_KEY = "otterdeploy:graph-legend-open";

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function GraphLegend() {
  const [open, setOpen] = useState(readOpen);

  const toggle = () => {
    const next = !open;
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      /* ignore */
    }
    setOpen(next);
  };

  return (
    <div className="rounded-md border border-border/40 bg-background/80 text-[11px] shadow-sm backdrop-blur">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="font-medium">Legend</span>
        <HugeiconsIcon
          icon={open ? ArrowDown01Icon : ArrowUp01Icon}
          strokeWidth={2}
          className="size-3"
        />
      </button>
      {open ? (
        <div className="flex flex-col gap-1.5 border-t border-border/40 px-2.5 py-2">
          <LegendRow swatch={<EdgeSwatch />} label="dependency" />
          <LegendRow swatch={<EdgeSwatch traffic />} label="live traffic" />
          <div className="mt-0.5 flex items-center gap-3">
            <Dot className="bg-success" label="running" />
            <Dot className="bg-warning" label="building" />
            <Dot className="bg-destructive" label="error" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LegendRow({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      {swatch}
      <span>{label}</span>
    </div>
  );
}

function EdgeSwatch({ traffic }: { traffic?: boolean }) {
  return (
    <svg width="20" height="4" aria-hidden className="shrink-0">
      <line
        x1="0"
        y1="2"
        x2="20"
        y2="2"
        className="stroke-foreground/45"
        strokeWidth={traffic ? 2.5 : 1.25}
        strokeDasharray={traffic ? "4 3" : undefined}
      />
    </svg>
  );
}

function Dot({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span className={cn("size-2 rounded-full", className)} />
      {label}
    </span>
  );
}
