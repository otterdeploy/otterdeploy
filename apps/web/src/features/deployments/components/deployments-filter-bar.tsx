/**
 * The page's scope controls, in one row: the status view (All · Live now ·
 * In progress · Failed, each with its count), Resource and Person chips, the
 * date range, and search. Every control writes the URL (see the route), so a
 * filtered view is a link.
 */

import { useEffect, useRef, useState } from "react";

import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Input } from "@/shared/components/ui/input";
import { Kbd } from "@/shared/components/ui/kbd";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";

import { type DeployWindow, STATUS_VIEWS, type StatusView } from "../data/deployments-search";
import {
  PersonChip,
  type PersonOption,
  ResourceChip,
  type ResourceOption,
  WindowChip,
} from "./deployments-filter-chips";

function StatusTabs({
  value,
  counts,
  onChange,
}: {
  value: StatusView;
  counts: Record<StatusView, number> | null;
  onChange: (v: StatusView) => void;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(v) => {
        const next = STATUS_VIEWS.find((s) => s.id === v);
        if (next) onChange(next.id);
      }}
      className="max-w-full overflow-x-auto"
    >
      <TabsList aria-label="Status">
        {STATUS_VIEWS.map((s) => (
          <TabsTrigger key={s.id} value={s.id} className="gap-1.5 px-2.5 text-[12.5px]">
            {s.label}
            {counts ? (
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                {counts[s.id]}
              </span>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

const SEARCH_DEBOUNCE_MS = 250;

/** Local echo of the URL's `q` with a debounced write-back: typing stays
 *  instant, the URL stays the source of truth (sharing, reload, back). `/`
 *  focuses it from anywhere on the page. */
function SearchField({ q, onQChange }: { q: string; onQChange: (value: string) => void }) {
  const [draft, setDraft] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || t.closest("input, textarea"))) return;
      e.preventDefault();
      input.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  // Adopt an external URL change (back button, shared link) while not typing.
  const [prevQ, setPrevQ] = useState(q);
  if (q !== prevQ) {
    setPrevQ(q);
    if (timer.current === null) setDraft(q);
  }
  return (
    <div className="relative flex min-w-0 items-center max-sm:w-full">
      <HugeiconsIcon
        icon={Search01Icon}
        strokeWidth={2}
        className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground"
      />
      <Input
        ref={input}
        value={draft}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          if (timer.current !== null) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            timer.current = null;
            onQChange(next.trim());
          }, SEARCH_DEBOUNCE_MS);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") e.currentTarget.blur();
        }}
        placeholder="Search commits, SHA, image"
        aria-label="Search deployments"
        className="h-7 w-64 pr-8 pl-8 text-[12.5px] max-sm:w-full"
      />
      <Kbd className="pointer-events-none absolute right-2">/</Kbd>
    </div>
  );
}

export function DeploymentsFilterBar(props: {
  status: StatusView;
  counts: Record<StatusView, number> | null;
  onStatusChange: (v: StatusView) => void;
  resources: ResourceOption[];
  resource: string | undefined;
  onResourceChange: (id: string | undefined) => void;
  people: PersonOption[];
  automaticCount: number;
  selectedPeople: readonly string[];
  automatic: boolean;
  onPeopleChange: (people: string[], automatic: boolean) => void;
  window: DeployWindow;
  onWindowChange: (v: DeployWindow) => void;
  q: string;
  onQChange: (q: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusTabs value={props.status} counts={props.counts} onChange={props.onStatusChange} />
      <ResourceChip
        options={props.resources}
        value={props.resource}
        onChange={props.onResourceChange}
      />
      <PersonChip
        options={props.people}
        automaticCount={props.automaticCount}
        people={props.selectedPeople}
        automatic={props.automatic}
        onChange={props.onPeopleChange}
      />
      <WindowChip value={props.window} onChange={props.onWindowChange} />
      <span className="grow max-sm:hidden" />
      <SearchField q={props.q} onQChange={props.onQChange} />
    </div>
  );
}
