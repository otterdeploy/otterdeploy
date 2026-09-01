/**
 * The workbench's front door: every database it can open, none of them
 * opened.
 *
 * Nothing connects on arrival. A managed database is reached through a
 * session that exists only while someone is using it, so "which one" has to
 * be a choice the person makes, not one the page makes for them by opening
 * the first in the list. Clicking a row starts that session (see
 * `ConnectGate`).
 */
import { Database02Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { DatabaseLogo } from "@/shared/components/brand/database-logo";
import { Button } from "@/shared/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";
import { cn } from "@/shared/lib/utils";

import type { WorkbenchTargetOption } from "../data/use-workbench-targets";

export function TargetPicker({
  managed,
  external,
  onPick,
  onConnect,
}: {
  managed: WorkbenchTargetOption[];
  external: WorkbenchTargetOption[];
  onPick: (option: WorkbenchTargetOption) => void;
  onConnect: () => void;
}) {
  if (managed.length + external.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <Empty className="flex-1 justify-center">
          <EmptyHeader>
            <HugeiconsIcon
              icon={Database02Icon}
              strokeWidth={1.5}
              className="size-10 text-muted-foreground/50"
            />
            <EmptyTitle>Nothing to browse yet</EmptyTitle>
            <EmptyDescription>
              Deploy a PostgreSQL or MariaDB database, or connect one otterdeploy doesn&rsquo;t run.
            </EmptyDescription>
          </EmptyHeader>
          <Button size="sm" onClick={onConnect}>
            Connect a database URL
          </Button>
        </Empty>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 justify-center overflow-y-auto px-6 py-10">
      <div className="w-full max-w-xl">
        <h2 className="text-[15px] font-medium">Open a database</h2>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          A session is opened when you pick one and closed when you leave or disconnect.
        </p>
        {managed.length > 0 ? (
          <Group title="Managed by otterdeploy" options={managed} onPick={onPick} />
        ) : null}
        {external.length > 0 ? (
          <Group title="External connections" options={external} onPick={onPick} />
        ) : null}
        <Button size="sm" variant="outline" className="mt-6 gap-1.5" onClick={onConnect}>
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
          Connect a database URL
        </Button>
      </div>
    </div>
  );
}

function Group({
  title,
  options,
  onPick,
}: {
  title: string;
  options: WorkbenchTargetOption[];
  onPick: (option: WorkbenchTargetOption) => void;
}) {
  return (
    <section className="mt-6">
      <h3 className="mb-1.5 text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <ul className="divide-y overflow-hidden rounded-md ring-1 ring-foreground/10">
        {options.map((option) => (
          <li key={option.key}>
            <button
              type="button"
              disabled={!option.healthy}
              onClick={() => onPick(option)}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                option.healthy
                  ? "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  : "cursor-not-allowed opacity-50",
              )}
            >
              <DatabaseLogo value={option.engine} size={20} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{option.name}</span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">
                  {option.subtitle}
                </span>
              </span>
              {option.readOnly ? (
                <span className="shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-[9.5px] tracking-wide text-muted-foreground uppercase">
                  read-only
                </span>
              ) : null}
              {!option.healthy ? (
                <span className="shrink-0 text-[11px] text-muted-foreground">not running</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
