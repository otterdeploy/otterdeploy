
import type { ProjectSlug, Slug } from "@otterdeploy/shared/id";
import { useState } from "react";
import {
  Link,
  useLoaderData,
  useMatch,
  useNavigate,
  useRouteContext,
  useSearch,
} from "@tanstack/react-router";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowDown01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";

import { envCollection } from "@/features/projects/data/env";
import { projectCollection } from "@/features/projects/data/project";
import { EnvironmentCreateDialog } from "@/features/shell/components/environment-create-dialog";
import { authClient } from "@/lib/auth-client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { orpc, queryClient } from "@/shared/server/orpc";
import { cn } from "@/shared/lib/utils";

function Separator() {
  return (
    <span aria-hidden className="select-none px-1 text-base text-muted-foreground/40">
      /
    </span>
  );
}

function CrumbTrigger({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <DropdownMenuTrigger
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none data-popup-open:bg-accent",
        className,
      )}
    >
      <span className="max-w-[14ch] truncate">{label}</span>
      <HugeiconsIcon
        icon={ArrowDown01Icon}
        strokeWidth={2}
        className="size-3.5 text-muted-foreground"
      />
    </DropdownMenuTrigger>
  );
}

function ActiveCheck({ active }: { active: boolean }) {
  return (
    <HugeiconsIcon
      icon={Tick02Icon}
      strokeWidth={2}
      className={cn("ml-auto size-3.5", active ? "opacity-100" : "opacity-0")}
    />
  );
}

export function HeaderNav() {
  const { organizations } = useRouteContext({ from: "/_app" });
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const projectMatch = useMatch({
    from: "/_app/$orgSlug/$projectSlug",
    shouldThrow: false,
  });
  const project = projectMatch?.loaderData?.project;

  const navigate = useNavigate();

  return (
    <nav
      aria-label="Workspace"
      className="hidden items-center gap-0.5 md:flex"
    >
      <OrgPicker
        orgs={organizations}
        activeOrgId={organization.id}
        activeOrgName={organization.name}
        onSelect={async (org) => {
          if (org.id === organization.id) return;
          await authClient.organization.setActive({
            organizationId: org.id,
          });
          await Promise.all([
            queryClient.invalidateQueries({
              queryKey: orpc.project.list.queryKey(),
            }),
            queryClient.invalidateQueries({
              queryKey: orpc.env.list.queryKey(),
            }),
          ]);
          void navigate({
            to: "/$orgSlug",
            params: { orgSlug: org.slug },
          });
        }}
      />

      {project && (
        <>
          <Separator />
          <ProjectPicker
            orgSlug={organization.slug}
            activeProjectId={project.id}
            activeProjectName={project.name}
          />
        </>
      )}

      {project && (
        <>
          <Separator />
          <EnvPicker projectId={project.id} />
        </>
      )}
    </nav>
  );
}

function OrgPicker({
  orgs,
  activeOrgId,
  activeOrgName,
  onSelect,
}: {
  orgs: { id: string; name: string; slug: string }[];
  activeOrgId: string;
  activeOrgName: string;
  onSelect: (org: { id: string; slug: string }) => void;
}) {
  return (
    <DropdownMenu>
      <CrumbTrigger label={activeOrgName} />
      <DropdownMenuContent align="start" className="min-w-56">
        {orgs.map((org) => (
          <DropdownMenuItem
            key={org.id}
            onClick={() => onSelect(org)}
            className="gap-2"
          >
            <span className="truncate">{org.name}</span>
            <ActiveCheck active={org.id === activeOrgId} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProjectPicker({
  orgSlug,
  activeProjectId,
  activeProjectName,
}: {
  orgSlug: string;
  activeProjectId: string;
  activeProjectName: string;
}) {
  const { data: projects } = useLiveQuery(
    (q) => q.from({ p: projectCollection }),
    [],
  );

  return (
    <DropdownMenu>
      <CrumbTrigger label={activeProjectName} />
      <DropdownMenuContent align="start" className="min-w-56">
        {projects.length === 0 ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            No projects
          </div>
        ) : (
          projects.map((p) => (
            <DropdownMenuItem
              key={p.id}
              render={
                <Link
                  to="/$orgSlug/$projectSlug"
                  params={{
                    orgSlug,
                    projectSlug: p.slug as ProjectSlug,
                  }}
                />
              }
              className="gap-2"
            >
              <span className="truncate">{p.name}</span>
              <ActiveCheck active={p.id === activeProjectId} />
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EnvPicker({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const { env } = useSearch({ from: "/_app/$orgSlug/$projectSlug" });
  const [createOpen, setCreateOpen] = useState(false);

  const { data: environments } = useLiveQuery(
    (q) => q.from({ e: envCollection }).where(({ e }) => eq(e.projectId, projectId)),
    [projectId],
  );

  const defaultEnv =
    environments.find((e) => e.slug === "production") ?? environments[0];
  const currentSlug = env ?? defaultEnv?.slug;
  const current = environments.find((e) => e.slug === currentSlug) ?? defaultEnv;

  if (!current) return null;

  return (
    <>
      <DropdownMenu>
        <CrumbTrigger label={current.name} />
        <DropdownMenuContent align="start" className="min-w-56">
          {environments.map((e) => (
            <DropdownMenuItem
              key={e.id}
              onClick={() =>
                void navigate({
                  search: (prev) => ({ ...prev, env: e.slug }),
                })
              }
              className="gap-2"
            >
              <span className="truncate">{e.name}</span>
              <ActiveCheck active={e.slug === currentSlug} />
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreateOpen(true)} className="gap-2">
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            New environment
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EnvironmentCreateDialog
        projectId={projectId}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </>
  );
}
