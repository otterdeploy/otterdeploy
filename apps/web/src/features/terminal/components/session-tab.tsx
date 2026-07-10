import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/shared/lib/utils";

import type { Session, SessionSource } from "../types";
import type { ConnState } from "./terminal-session";

/**
 * At-a-glance kind glyph for a session tab — a colored mini-badge (`sh`,
 * `ssh`, `pg`, `rd`, …) so a strip of open sessions reads without parsing
 * the labels. Colors follow the app's semantic vocabulary: shell→sky,
 * ssh→amber, database engines→emerald (redis→rose).
 */
function glyphFor(source: SessionSource): { label: string; className: string } {
  switch (source.kind) {
    case "container":
      return { label: "sh", className: "text-sky-600 dark:text-sky-400" };
    case "ssh":
      return { label: "ssh", className: "text-amber-600 dark:text-amber-400" };
    case "database": {
      const engine = source.engine.toLowerCase();
      if (engine.startsWith("redis"))
        return { label: "rd", className: "text-rose-600 dark:text-rose-400" };
      const label = engine.startsWith("postgres")
        ? "pg"
        : engine.startsWith("mysql") || engine.startsWith("maria")
          ? "my"
          : engine.startsWith("mongo")
            ? "mg"
            : "db";
      return { label, className: "text-emerald-600 dark:text-emerald-400" };
    }
  }
}

export function SessionKindGlyph({ source }: { source: SessionSource }) {
  const { label, className } = glyphFor(source);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-4 min-w-[22px] items-center justify-center rounded-sm bg-muted px-1 font-mono text-[9px] font-semibold tracking-[0.05em] uppercase",
        className,
      )}
    >
      {label}
    </span>
  );
}

function describeConn(conn: ConnState): { className: string; label: string } {
  switch (conn.kind) {
    case "connecting":
      return { className: "bg-amber-500 motion-safe:animate-pulse", label: "Connecting" };
    case "connected":
      return { className: "bg-emerald-500", label: "Connected" };
    case "reconnecting":
      return {
        className: "bg-amber-500 motion-safe:animate-pulse",
        label: `Reconnecting (attempt ${conn.attempt})`,
      };
    case "closed":
      return { className: "bg-muted-foreground/40", label: "Session ended" };
    case "error":
      return { className: "bg-rose-500", label: `Error: ${conn.message}` };
  }
}

/** Connection-state dot fed by `TerminalSession`'s `onConnChange`. */
export function ConnStateDot({ conn }: { conn: ConnState | undefined }) {
  const { className, label } = describeConn(conn ?? { kind: "connecting" });
  return (
    <span title={label} className="inline-flex items-center">
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", className)} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * One tab in the terminal session strip: kind glyph · label · connection dot
 * · close. Shared between the in-app terminal page and the pop-out window so
 * the two strips can't drift apart.
 */
export function SessionTab({
  session,
  active,
  conn,
  onSelect,
  onClose,
}: {
  session: Session;
  active: boolean;
  conn: ConnState | undefined;
  onSelect: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex shrink-0 items-center gap-1.5 rounded-md border transition-colors",
        active ? "border-border bg-background" : "border-transparent hover:bg-muted/60",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex items-center gap-1.5 py-0.5 pl-1.5 font-mono text-[12px]"
      >
        <SessionKindGlyph source={session.source} />
        {session.label}
        <ConnStateDot conn={conn} />
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label={`Close ${session.label}`}
        className="grid size-5 place-items-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
      >
        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3" />
      </button>
    </div>
  );
}
