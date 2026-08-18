import { useMemo, useState } from "react";

import { SearchIcon, TerminalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useLiveQuery } from "@tanstack/react-db";
import { Command as CommandPrimitive } from "cmdk";
import { useTranslation } from "react-i18next";

import { serverCollection } from "@/features/servers/data/server";
import {
  terminalContainersCollection,
  terminalDatabasesCollection,
} from "@/features/terminal/data/targets";
import { Command, CommandEmpty, CommandGroup, CommandList } from "@/shared/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Kbd, KbdGroup } from "@/shared/components/ui/kbd";
import { cn } from "@/shared/lib/utils";

import type { PickerTarget, TargetGroup } from "../data/pick-targets";
import type { SessionSource } from "../types";

import { buildPickerTargets, projectFacets } from "../data/pick-targets";
import { TargetRow } from "./target-row";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (source: SessionSource) => void;
  /** Optional starting project filter. Defaults to every project. */
  defaultProject?: string;
}

const GROUP_HEADING: Record<TargetGroup, string> = {
  service: "Services",
  database: "Databases",
  server: "Servers",
};

// Servers first: the machines are the anchor an operator orients by, and the
// list is shortest: services (the longest group) go last so they never bury
// the hosts.
const GROUP_ORDER: TargetGroup[] = ["server", "database", "service"];

/**
 * Destination picker for a new terminal session.
 *
 * Deliberately *not* organised by transport. The previous version split
 * targets across Container / SSH / Database tabs, which asked the operator to
 * know how otterdeploy reaches a box before they could say which box they
 * meant, and made the thing they wanted unsearchable behind a tab they
 * weren't on. Here every shell in the org is one list, one search field, one
 * Enter away; the grouping is what the target *is*, and the transport is a
 * quiet trailing detail on the row.
 */
export function OpenTerminalDialog({ open, onOpenChange, onPick, defaultProject = "all" }: Props) {
  const { t } = useTranslation();
  const [project, setProject] = useState(defaultProject);

  // Containers and databases come from one terminal.targets RPC (two sibling
  // collections, same queryKey → a single network call); servers reuse the
  // org-wide collection the servers page already keeps warm.
  const { data: containers = [] } = useLiveQuery(() => terminalContainersCollection);
  const { data: databases = [] } = useLiveQuery(() => terminalDatabasesCollection);
  const { data: servers } = useLiveQuery((q) => q.from({ s: serverCollection }));

  const targets = useMemo(
    () => buildPickerTargets({ containers, databases, servers }),
    [containers, databases, servers],
  );
  const facets = useMemo(() => projectFacets(targets), [targets]);

  const visible = project === "all" ? targets : targets.filter((t) => t.project === project);
  const openable = visible.filter((t) => t.unavailable === null).length;

  function pick(target: PickerTarget) {
    onPick(target.source);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl" showCloseButton={false}>
        <DialogTitle className="sr-only">{t("terminal.openTerminal")}</DialogTitle>
        <DialogDescription className="sr-only">
          Search every service, database, and server you can open a shell on.
        </DialogDescription>

        <Command shouldFilter loop className="rounded-none! bg-transparent p-0">
          <div className="flex items-center gap-2 border-b px-3 py-2.5">
            <HugeiconsIcon
              icon={SearchIcon}
              strokeWidth={2}
              className="size-4 shrink-0 opacity-50"
            />
            {/* No autoFocus: the dialog moves focus to its first focusable
                child on open, which is this input. */}
            <CommandPrimitive.Input
              placeholder={t("terminal.searchPlaceholder")}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <Kbd>esc</Kbd>
          </div>

          {facets.length > 1 && (
            <div className="flex flex-wrap items-center gap-1 border-b px-3 py-2">
              <ProjectFacet
                label={t("terminal.allProjects")}
                mono={false}
                count={targets.length}
                active={project === "all"}
                onClick={() => setProject("all")}
              />
              {facets.map((f) => (
                <ProjectFacet
                  key={f.slug}
                  label={f.slug}
                  count={f.count}
                  active={project === f.slug}
                  onClick={() => setProject(f.slug)}
                />
              ))}
            </div>
          )}

          <CommandList className="max-h-96 px-1 py-1">
            <CommandEmpty>
              <EmptyTargets hasAny={targets.length > 0} />
            </CommandEmpty>

            {GROUP_ORDER.map((group) => {
              const rows = visible.filter((t) => t.group === group);
              if (rows.length === 0) return null;
              return (
                <CommandGroup key={group} heading={GROUP_HEADING[group]}>
                  {rows.map((t) => (
                    <TargetRow key={t.id} target={t} onPick={pick} />
                  ))}
                </CommandGroup>
              );
            })}
          </CommandList>

          <div className="flex items-center gap-4 border-t px-3 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <KbdGroup>
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
              </KbdGroup>
              Navigate
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>↵</Kbd>
              Open session
            </span>
            <span className="ml-auto font-mono">
              {openable} {openable === 1 ? "target" : "targets"}
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function EmptyTargets({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8">
      <HugeiconsIcon
        icon={TerminalIcon}
        strokeWidth={1.5}
        className="size-8 text-muted-foreground/50"
      />
      <p className="text-sm">{hasAny ? "Nothing matches that." : "Nothing to open a shell on."}</p>
      <p className="text-[12.5px] text-muted-foreground">
        {hasAny
          ? "Try a service name, project, container id, or host."
          : "Deploy a service or register a server first."}
      </p>
    </div>
  );
}

/** A project slug is machine-readable, so it's mono; "All projects" is prose. */
function ProjectFacet({
  label,
  count,
  active,
  onClick,
  mono = true,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  mono?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-4xl px-2.5 py-1 text-[12px] transition-colors",
        active
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <span className={mono ? "font-mono" : undefined}>{label}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{count}</span>
    </button>
  );
}
