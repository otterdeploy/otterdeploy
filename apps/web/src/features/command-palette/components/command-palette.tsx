import {
  Folder01Icon,
  Moon02Icon,
  Rocket01Icon,
  SearchIcon,
  Settings01Icon,
  Sun02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useMatch, useNavigate, useParams } from "@tanstack/react-router";
import { Command as CommandPrimitive } from "cmdk";
import { useTheme } from "next-themes";

import type { RoutePath } from "@/features/shell/components/sidebar";

import { useResourceOverlay } from "@/features/projects/components/new-resource/overlay-provider";
import { envCollection } from "@/features/projects/data/env";
import { projectCollection } from "@/features/projects/data/project";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/shared/components/ui/command";
import { Kbd, KbdGroup } from "@/shared/components/ui/kbd";

import { useCommandPalette } from "../hooks/use-command-palette";
import { useProjectNavHotkeys } from "../hooks/use-project-nav-hotkeys";
import { NavGroup, ORG_NAV_GROUPS, PaletteFooter, PROJECT_NAV } from "./nav-items";

/**
 * Imperative navigation for palette selections. Nav entries carry typed
 * RoutePaths (checked at their definition in the nav manifest), but at these
 * dynamic call sites the widened union defeats param inference — substitute
 * the known params into the concrete path instead of casting: `to` also
 * accepts a plain string.
 */
function makeGoHandlers(opts: {
  navigate: ReturnType<typeof useNavigate>;
  run: (fn: () => void) => void;
  orgSlug?: string;
  projectSlug?: string;
}) {
  const { navigate, run, orgSlug, projectSlug } = opts;

  const goOrg = (to: RoutePath) => {
    if (!orgSlug || !to) return;
    run(() => void navigate({ to: to.replace("$orgSlug", orgSlug) }));
  };
  const goProject = (to: RoutePath) => {
    if (!orgSlug || !projectSlug || !to) return;
    run(
      () =>
        void navigate({
          to: to.replace("$orgSlug", orgSlug).replace("$projectSlug", projectSlug),
        }),
    );
  };
  const openProject = (slug: string) => {
    if (!orgSlug) return;
    run(() => void navigate({ to: `/${orgSlug}/${slug}` }));
  };
  // Same-page search tweak. The current route (and so its search schema) is
  // opaque at this call site, so go through the concrete URL instead of a
  // cast — TanStack's search serializer round-trips raw values losslessly.
  const switchEnv = (slug: string) =>
    run(() => {
      const url = new URL(window.location.href);
      url.searchParams.set("env", slug);
      void navigate({
        to: url.pathname,
        search: Object.fromEntries(url.searchParams.entries()),
      });
    });

  return { goOrg, goProject, openProject, switchEnv };
}

export function CommandPalette() {
  const { open, setOpen } = useCommandPalette();
  const navigate = useNavigate();
  const { orgSlug, projectSlug } = useParams({ strict: false });
  const overlay = useResourceOverlay();
  const { setTheme } = useTheme();

  // Live-query environments for the active project (loader exposes the project
  // but environments are a separate collection, same pattern as the layout).
  const projectMatch = useMatch({
    from: "/_app/$orgSlug/_shell/$projectSlug",
    shouldThrow: false,
  });
  const projectId = projectMatch?.loaderData?.project?.id;
  const { data: environments } = useLiveQuery(
    (q) => q.from({ e: envCollection }).where(({ e }) => eq(e.projectId, projectId)),
    [projectId],
  );

  // All projects in the org — the palette doubles as a project switcher.
  const { data: projects } = useLiveQuery((q) => q.from({ p: projectCollection }), []);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const { goOrg, goProject, openProject, switchEnv } = makeGoHandlers({
    navigate,
    run,
    orgSlug,
    projectSlug,
  });

  const goNewResource = () =>
    run(() => {
      if (orgSlug && projectSlug) overlay.setOpen(true);
    });

  // Global keyboard shortcuts. `ignoreInputs` defaults to true for single keys
  // and sequences, so these don't fire while the user is typing in any input.
  useHotkey("D", goNewResource);
  useProjectNavHotkeys(goProject);

  const inProject = Boolean(orgSlug && projectSlug);

  return (
    <CommandDialog open={open} onOpenChange={setOpen} className="gap-0 p-0 sm:max-w-xl">
      <Command>
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <HugeiconsIcon icon={SearchIcon} strokeWidth={2} className="size-4 shrink-0 opacity-50" />
          <CommandPrimitive.Input
            placeholder="Type a command or search…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <Kbd>esc</Kbd>
        </div>

        <CommandList>
          <CommandEmpty>No matching command.</CommandEmpty>

          {inProject && (
            <CommandGroup heading="This project">
              <CommandItem value="action new-service deploy" onSelect={goNewResource}>
                <HugeiconsIcon icon={Rocket01Icon} strokeWidth={2} />
                Deploy a new service…
                <CommandShortcut>
                  <Kbd>D</Kbd>
                </CommandShortcut>
              </CommandItem>
              {PROJECT_NAV.map((item) => (
                <CommandItem
                  key={item.label}
                  value={`project ${item.label} ${(item.keywords ?? []).join(" ")}`}
                  keywords={item.keywords ? [...item.keywords] : undefined}
                  onSelect={() => goProject(item.to)}
                >
                  <HugeiconsIcon icon={item.icon} strokeWidth={2} />
                  {item.label}
                  {item.chord ? (
                    <CommandShortcut>
                      <KbdGroup>
                        <Kbd>G</Kbd>
                        <Kbd>{item.chord}</Kbd>
                      </KbdGroup>
                    </CommandShortcut>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {environments.length > 0 && (
            <CommandGroup heading="Environment">
              {environments.map((envOption) => (
                <CommandItem
                  key={envOption.slug}
                  value={`env ${envOption.slug} ${envOption.name}`}
                  onSelect={() => switchEnv(envOption.slug)}
                >
                  <HugeiconsIcon icon={Folder01Icon} strokeWidth={2} />
                  Switch to {envOption.name}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {projects.length > 0 && (
            <CommandGroup heading="Projects">
              {projects.map((project) => (
                <CommandItem
                  key={project.id}
                  value={`open-project ${project.name} ${project.slug}`}
                  onSelect={() => openProject(project.slug)}
                >
                  <HugeiconsIcon icon={Folder01Icon} strokeWidth={2} />
                  {project.name}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {ORG_NAV_GROUPS.map((group) => (
            <NavGroup
              key={group.heading}
              heading={group.heading}
              items={group.items}
              onGo={goOrg}
            />
          ))}

          <CommandGroup heading="Appearance">
            <CommandItem value="theme light" onSelect={() => run(() => setTheme("light"))}>
              <HugeiconsIcon icon={Sun02Icon} strokeWidth={2} />
              Light theme
            </CommandItem>
            <CommandItem value="theme dark" onSelect={() => run(() => setTheme("dark"))}>
              <HugeiconsIcon icon={Moon02Icon} strokeWidth={2} />
              Dark theme
            </CommandItem>
            <CommandItem value="theme system" onSelect={() => run(() => setTheme("system"))}>
              <HugeiconsIcon icon={Settings01Icon} strokeWidth={2} />
              System theme
            </CommandItem>
          </CommandGroup>
        </CommandList>

        <PaletteFooter />
      </Command>
    </CommandDialog>
  );
}
