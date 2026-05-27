/**
 * Layout atoms used by the demo Settings tab — labels, rows, toggles,
 * capacity bars, etc. All pure presentation; no data fetching.
 */

import { useState } from "react";

import { cn } from "@/shared/lib/utils";

export function SettingsBlock({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "destructive";
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3
        className={cn(
          "text-[15px] font-semibold",
          tone === "destructive" && "text-destructive",
        )}
      >
        {title}
      </h3>
      <div className="mt-3 flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

export function SettingsRow({
  label,
  value,
  mono = false,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  tone?: "primary";
}) {
  return (
    <div className="grid grid-cols-[180px_1fr] items-center gap-4 border-b border-border/30 pb-2.5">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-[13px]",
          mono ? "font-mono text-foreground/90" : "text-foreground",
          tone === "primary" && "text-primary",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function SubLabel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70">
        {label}
      </span>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function Toggle({ on, label }: { on: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={cn(
          "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors",
          on ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "inline-block size-3 rounded-full bg-background transition-transform",
            on ? "translate-x-3.5" : "translate-x-0.5",
          )}
        />
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  );
}

export function CapacityBar({
  label,
  value,
  sub,
  pct,
}: {
  label: string;
  value: string;
  sub: string;
  pct: number;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70">
          {label}: <span className="font-semibold text-foreground">{value}</span>
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">{sub}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary/70"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function PillButton({
  active,
  children,
}: {
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-md border px-2.5 py-1 text-xs transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border/60 text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function FeatureFlag({ title, sub }: { title: string; sub: string }) {
  const [on, setOn] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setOn((s) => !s)}
      className="flex items-center justify-between rounded-lg border border-border/40 px-4 py-3 text-left transition-colors hover:border-border"
    >
      <span
        className={cn(
          "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors",
          on ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "inline-block size-3 rounded-full bg-background transition-transform",
            on ? "translate-x-3.5" : "translate-x-0.5",
          )}
        />
      </span>
      <div className="ml-4 flex-1">
        <div className="text-[13px] font-medium">{title}</div>
        <div className="text-[11.5px] text-muted-foreground">{sub}</div>
      </div>
    </button>
  );
}
