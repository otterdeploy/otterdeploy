import { useState, type ReactNode } from "react";

import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import {
  useLoaderData,
  useMatch,
  useNavigate,
  useRouteContext,
  useSearch,
} from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { CreateProjectDialog } from "@/features/projects/components/create-project-dialog";
import { envCollection } from "@/features/projects/data/env";
import { projectCollection } from "@/features/projects/data/project";
import { EnvironmentCreateDialog } from "@/features/shell/components/environment-create-dialog";
import {
  EnvDot,
  EnvItems,
  OrgItems,
  ProjectItems,
  type NavLists,
} from "@/features/shell/components/header-nav-items";
import { authClient } from "@/lib/auth-client";
import { invalidateAuth } from "@/lib/auth-queries";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

function Separator() {
  return (
    <span aria-hidden className="px-1 text-base text-muted-foreground/40 select-none">
      /
    </span>
  );
}

function CrumbTrigger({
  label,
  leading,
  className,
}: {
  label: string;
  leading?: ReactNode;
  className?: string;
}) {
  return (
    <DropdownMenuTrigger
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none data-popup-open:bg-accent",
        className,
      )}
    >
      {leading}
      <span className="max-w-[14ch] truncate">{label}</span>
      <HugeiconsIcon
        icon={ArrowDown01Icon}
        strokeWidth={2}
        className="size-3.5 text-muted-foreground"
      />
    </DropdownMenuTrigger>
  );
}

export function HeaderNav() {
  const { organizations } = useRouteContext({ from: "/_app" });
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const projectMatch = useMatch({
    from: "/_app/$orgSlug/_shell/$projectSlug",
    shouldThrow: false,
  });
  const project = projectMatch?.loaderData?.project;

  const navigate = useNavigate();

  // Create dialogs are owned here rather than inside each picker so the
  // desktop trail and the collapsed mobile menu drive the same two instances.
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createEnvOpen, setCreateEnvOpen] = useState(false);

  // Both collections are preloaded by the `_app` layout, so these are cheap
  // subscriptions rather than fetches. They live here (not in the individual
  // pickers) because the mobile menu renders all three lists at once.
  const { data: projects } = useLiveQuery((q) => q.from({ p: projectCollection }), []);
  const { data: environments } = useLiveQuery(
    (q) => q.from({ e: envCollection }).where(({ e }) => eq(e.projectId, project?.id ?? "")),
    [project?.id],
  );

  // `strict: false` — this nav also renders on org-level routes, which have no
  // `env` search param in their schema at all.
  const search = useSearch({ strict: false }) as { env?: string };
  const defaultEnv = environments.find((e) => e.slug === "production") ?? environments[0];
  const currentEnvSlug = search.env ?? defaultEnv?.slug;
  const currentEnv = environments.find((e) => e.slug === currentEnvSlug) ?? defaultEnv;

  const selectOrg = async (org: { id: string; slug: string }) => {
    if (org.id === organization.id) return;
    await authClient.organization.setActive({ organizationId: org.id });
    await Promise.all([
      // The session payload carries activeOrganizationId, and the gate now
      // serves it from a 5min-stale cache — so switching org MUST drop it, or
      // the app keeps resolving the previous org until the cache expires.
      invalidateAuth(),
      queryClient.invalidateQueries({ queryKey: orpc.project.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: orpc.env.list.queryKey() }),
    ]);
    void navigate({ to: "/$orgSlug", params: { orgSlug: org.slug } });
  };

  const selectEnv = (slug: string) =>
    void navigate({
      search: (prev: Record<string, unknown>) => ({ ...prev, env: slug }),
    } as never);

  const lists = {
    orgs: organizations,
    activeOrgId: organization.id,
    onSelectOrg: selectOrg,
    orgSlug: organization.slug,
    projects,
    activeProjectId: project?.id,
    onCreateProject: () => setCreateProjectOpen(true),
    environments,
    currentEnvSlug,
    onSelectEnv: selectEnv,
    onCreateEnv: () => setCreateEnvOpen(true),
  };

  const crumbs = { orgName: organization.name, projectName: project?.name, currentEnv, lists };

  return (
    <>
      <DesktopTrail {...crumbs} />
      <MobileCrumbMenu {...crumbs} />

      <CreateProjectDialog open={createProjectOpen} onOpenChange={setCreateProjectOpen} />
      {project && (
        <EnvironmentCreateDialog
          projectId={project.id}
          open={createEnvOpen}
          onOpenChange={setCreateEnvOpen}
        />
      )}
    </>
  );
}

interface CrumbProps {
  orgName: string;
  projectName?: string;
  currentEnv?: { id: string; name: string; slug: string };
  lists: NavLists;
}

/** Full crumb trail — org / project / environment as three separate triggers.
 *  Needs ~26rem, so it only appears once there's room for it. */
function DesktopTrail({ orgName, projectName, currentEnv, lists }: CrumbProps) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("nav.workspace")} className="hidden min-w-0 items-center gap-0.5 md:flex">
      <DropdownMenu>
        <CrumbTrigger label={orgName} />
        <DropdownMenuContent align="start" className="min-w-56">
          <OrgItems {...lists} />
        </DropdownMenuContent>
      </DropdownMenu>

      {projectName && (
        <>
          <Separator />
          <DropdownMenu>
            <CrumbTrigger label={projectName} />
            <DropdownMenuContent align="start" className="min-w-56">
              <ProjectItems {...lists} />
            </DropdownMenuContent>
          </DropdownMenu>

          <Separator />
          {currentEnv && (
            <DropdownMenu>
              <CrumbTrigger label={currentEnv.name} leading={<EnvDot env={currentEnv} />} />
              <DropdownMenuContent align="start" className="min-w-56">
                <EnvItems {...lists} />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </>
      )}
    </nav>
  );
}

/** Below `md` the three triggers can't fit beside the sidebar toggle and the
 *  action cluster, so they collapse into ONE trigger that opens all three lists
 *  as labelled groups. Switching workspace, project and environment all stay
 *  reachable — they just share a surface. */
function MobileCrumbMenu({ orgName, projectName, currentEnv, lists }: CrumbProps) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("nav.workspace")} className="flex min-w-0 items-center md:hidden">
      <DropdownMenu>
        <CrumbTrigger
          label={projectName ?? orgName}
          leading={projectName && currentEnv ? <EnvDot env={currentEnv} /> : undefined}
          className="min-w-0"
        />
        <DropdownMenuContent align="start" className="max-h-[70svh] min-w-56 overflow-y-auto">
          <DropdownMenuLabel className="text-muted-foreground">
            {t("nav.workspace")}
          </DropdownMenuLabel>
          <DropdownMenuGroup>
            <OrgItems {...lists} />
          </DropdownMenuGroup>

          {projectName && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-muted-foreground">
                {t("nav.project")}
              </DropdownMenuLabel>
              <DropdownMenuGroup>
                <ProjectItems {...lists} />
              </DropdownMenuGroup>

              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-muted-foreground">
                {t("shell.environment")}
              </DropdownMenuLabel>
              <DropdownMenuGroup>
                <EnvItems {...lists} />
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
