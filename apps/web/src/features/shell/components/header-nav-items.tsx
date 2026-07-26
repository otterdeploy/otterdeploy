/**
 * The three menu item lists behind the header's workspace nav — organizations,
 * projects, environments.
 *
 * They live apart from `header-nav.tsx` because each list is rendered TWICE:
 * once inside its own dropdown in the desktop crumb trail, and once as a
 * labelled group inside the single collapsed menu shown below `md`. Keeping
 * them here means the two surfaces can never drift, and keeps the nav file
 * under the line cap.
 */

import type { ProjectSlug } from "@otterdeploy/shared/id";

import { Add01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import { DropdownMenuItem, DropdownMenuSeparator } from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";

/** Shape shared by every item list — one object built in `HeaderNav` and
 *  spread into both the desktop trail and the collapsed mobile menu. */
export interface NavLists {
  orgs: { id: string; name: string; slug: string }[];
  activeOrgId: string;
  onSelectOrg: (org: { id: string; slug: string }) => void;
  orgSlug: string;
  projects: { id: string; name: string; slug: string }[];
  activeProjectId?: string;
  onCreateProject: () => void;
  environments: { id: string; name: string; slug: string }[];
  currentEnvSlug?: string;
  onSelectEnv: (slug: string) => void;
  onCreateEnv: () => void;
}

export function ActiveCheck({ active }: { active: boolean }) {
  return (
    <HugeiconsIcon
      icon={Tick02Icon}
      strokeWidth={2}
      className={cn("ml-auto size-3.5", active ? "opacity-100" : "opacity-0")}
    />
  );
}

/**
 * Environment status-dot color, derived from slug/name heuristics (there is
 * no explicit "kind" column on environments): production→emerald,
 * staging→amber, preview→blue, anything else→muted.
 */
function envDotClass(env: { slug: string; name: string }): string {
  const s = `${env.slug} ${env.name}`.toLowerCase();
  if (s.includes("prod")) return "bg-emerald-500";
  if (s.includes("stag")) return "bg-amber-500";
  if (s.includes("preview")) return "bg-blue-500";
  return "bg-muted-foreground/50";
}

export function EnvDot({ env }: { env: { slug: string; name: string } }) {
  return <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", envDotClass(env))} />;
}

export function OrgItems({ orgs, activeOrgId, onSelectOrg }: NavLists) {
  return (
    <>
      {orgs.map((org) => (
        <DropdownMenuItem key={org.id} onClick={() => onSelectOrg(org)} className="gap-2">
          <span className="truncate">{org.name}</span>
          <ActiveCheck active={org.id === activeOrgId} />
        </DropdownMenuItem>
      ))}
    </>
  );
}

export function ProjectItems({ orgSlug, projects, activeProjectId, onCreateProject }: NavLists) {
  return (
    <>
      {projects.length === 0 ? (
        <div className="px-2 py-1 text-xs text-muted-foreground">No projects</div>
      ) : (
        projects.map((p) => (
          <DropdownMenuItem
            key={p.id}
            render={
              <Link
                to="/$orgSlug/$projectSlug"
                params={{ orgSlug, projectSlug: p.slug as ProjectSlug }}
              />
            }
            className="gap-2"
          >
            <span className="truncate">{p.name}</span>
            <ActiveCheck active={p.id === activeProjectId} />
          </DropdownMenuItem>
        ))
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={onCreateProject} className="gap-2">
        <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
        New project
      </DropdownMenuItem>
    </>
  );
}

export function EnvItems({ environments, currentEnvSlug, onSelectEnv, onCreateEnv }: NavLists) {
  return (
    <>
      {environments.map((e) => (
        <DropdownMenuItem key={e.id} onClick={() => onSelectEnv(e.slug)} className="gap-2">
          <EnvDot env={e} />
          <span className="truncate">{e.name}</span>
          <ActiveCheck active={e.slug === currentEnvSlug} />
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={onCreateEnv} className="gap-2">
        <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
        New environment
      </DropdownMenuItem>
    </>
  );
}
