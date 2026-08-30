/**
 * The strip under every panel header: where you are, and every place you can
 * be next, in one row.
 *
 *   [▾ postiz ● 2/4 running] | [● postiz-app] [● db] [● redis] [● temporal]
 *
 * The HEAD is the switcher. It names the top-level resource this panel belongs
 * to (the stack, or the standalone service/database itself) and opens a
 * searchable list of every other top-level resource in the project. Same
 * control in the same place on every panel, so "take me somewhere else" never
 * means finding the canvas first.
 *
 * The MEMBERS follow it for a stack: one segment per service, dots only. A
 * stack and its members are one panel. Switching member is a `replace`
 * navigation that keeps the tab you are on (Logs on `db` → Logs on `redis`),
 * so browser Back still means "close the panel", not "walk every member you
 * looked at". `[` / `]` cycle stack → members → stack.
 *
 * Before this, members were only reachable from the expanded-width rail, the
 * Services tab's rows were plain divs, and a member's ✕ went to the graph
 * rather than back to its stack.
 */

import type { ProjectSlug } from "@otterdeploy/shared/id";

import { useEffect, useState } from "react";

import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useNavigate } from "@tanstack/react-router";

import type { ResourceState } from "@/features/resources/lib/resource-state";

import { TONE_DOT } from "@/features/resources/lib/resource-state";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { cn } from "@/shared/lib/utils";

import type { StackView } from "./use-stack-members";

import { ResourceSwitcher } from "./resource-switcher";

export interface StripCurrent {
  /** The open resource. Empty string for a staged create (no row yet). */
  resourceId: string;
  name: string;
  state: ResourceState | null;
}

/** Keys pressed inside a field belong to the field. */
function inEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT")
  );
}

export function StackMemberStrip({
  orgSlug,
  projectSlug,
  projectId,
  projectName,
  current,
  stack,
}: {
  orgSlug: string;
  projectSlug: ProjectSlug;
  projectId: string;
  projectName: string;
  current: StripCurrent;
  /** The stack this panel is in (its own, or the member's parent). Null for
   *  a standalone resource: the strip is then just the switcher. */
  stack: StackView | null;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  // Move sideways, keeping the tab. `replace`: the drawer is already open, and
  // one history entry per open is the rule.
  const go = (resourceId: string) => {
    void navigate({
      to: "/$orgSlug/$projectSlug/graph/$resourceId",
      params: { orgSlug, projectSlug, resourceId },
      search: (prev) => ({ tab: prev.tab }),
      replace: true,
    });
  };

  const ring = stack
    ? [stack.resourceId, ...stack.members.flatMap((m) => (m.resourceId ? [m.resourceId] : []))]
    : [];
  useEffect(() => {
    if (ring.length < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || inEditable(e.target)) return;
      if (e.key !== "[" && e.key !== "]") return;
      const i = ring.indexOf(current.resourceId);
      if (i === -1) return;
      e.preventDefault();
      const next = e.key === "]" ? (i + 1) % ring.length : (i - 1 + ring.length) % ring.length;
      const target = ring[next];
      if (target) go(target);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ring is derived from stack; join is the stable identity
  }, [ring.join(","), current.resourceId]);

  const head = stack
    ? { resourceId: stack.resourceId, name: stack.name, state: stack.state }
    : current;
  const headHere = head.resourceId === current.resourceId;

  return (
    <div
      role="navigation"
      aria-label="Where you are"
      className="flex shrink-0 items-stretch overflow-x-auto border-b border-border/60 bg-muted/20 px-2 sm:px-4"
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label={`Switch resource — currently in ${head.name}`}
          className={cn(
            "flex shrink-0 items-center gap-2 border-b-2 px-2.5 py-2 text-[12.5px] whitespace-nowrap transition-colors",
            "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
            headHere
              ? "border-foreground font-medium text-foreground"
              : "border-transparent text-muted-foreground",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full",
              head.state ? TONE_DOT[head.state.tone] : "ring-1 ring-muted-foreground/40",
            )}
          />
          <span className="truncate">{head.name}</span>
          {stack && (
            <span className="font-mono text-[11px] font-normal text-muted-foreground">
              {stack.state.label}
            </span>
          )}
          <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2.5} className="size-3 opacity-60" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <ResourceSwitcher
            crumb={{
              orgSlug,
              projectSlug,
              projectId,
              projectName,
              currentResourceId: head.resourceId,
            }}
            onNavigate={() => setOpen(false)}
          />
        </PopoverContent>
      </Popover>

      {stack && stack.members.length > 0 && (
        <>
          <span aria-hidden className="mx-1.5 my-2 w-px shrink-0 bg-border" />
          {stack.members.map((m) => {
            const here = m.resourceId != null && m.resourceId === current.resourceId;
            const id = m.resourceId;
            return (
              <button
                key={m.serviceName}
                type="button"
                disabled={id == null}
                aria-current={here ? "page" : undefined}
                title={m.state.why ? `${m.state.label} · ${m.state.why}` : m.state.label}
                onClick={() => {
                  if (id) go(id);
                }}
                className={cn(
                  "flex shrink-0 items-center gap-2 border-b-2 px-2.5 py-2 text-[12.5px] whitespace-nowrap transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                  "disabled:cursor-default disabled:opacity-60",
                  here
                    ? "border-foreground font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <span aria-hidden className={cn("size-1.5 rounded-full", TONE_DOT[m.state.tone])} />
                {m.name}
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
