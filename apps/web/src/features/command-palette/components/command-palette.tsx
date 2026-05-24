import { useNavigate, useParams } from "@tanstack/react-router";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/shared/components/ui/command";
import { Kbd, KbdGroup } from "@/shared/components/ui/kbd";
import { useCommandPalette } from "../hooks/use-command-palette";

export function CommandPalette() {
  const { open, setOpen } = useCommandPalette();
  const navigate = useNavigate();
  const { orgSlug, projectSlug } = useParams({ strict: false });

  const close = () => setOpen(false);

  const goNewResource = () => {
    if (orgSlug && projectSlug) {
      void navigate({
        to: "/$orgSlug/$projectSlug/new-resource",
        params: { orgSlug, projectSlug },
      });
    }
    close();
  };

  const goGraph = () => {
    if (orgSlug && projectSlug) {
      void navigate({
        to: "/$orgSlug/$projectSlug/graph",
        params: { orgSlug, projectSlug },
      });
    }
    close();
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} className="max-w-xl gap-0 p-0">
      <Command>
        <div className="relative">
          <CommandInput placeholder="Type a command or search…" />
          <Kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2">
            esc
          </Kbd>
        </div>
        <CommandList>
          <CommandEmpty>No matching command.</CommandEmpty>

          <CommandGroup heading="Actions">
            <CommandItem onSelect={goNewResource}>
              Deploy a new service…
              <CommandShortcut>
                <Kbd>D</Kbd>
              </CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={close}>
              Rollback last deployment
              <CommandShortcut>
                <KbdGroup>
                  <Kbd>⇧</Kbd>
                  <Kbd>R</Kbd>
                </KbdGroup>
              </CommandShortcut>
            </CommandItem>
          </CommandGroup>

          <CommandGroup heading="Logs">
            <CommandItem onSelect={close}>Tail logs · api</CommandItem>
            <CommandItem onSelect={close}>Tail logs · web</CommandItem>
            <CommandItem onSelect={close}>Tail logs · worker</CommandItem>
          </CommandGroup>

          <CommandGroup heading="Navigate">
            <CommandItem onSelect={goGraph}>
              Go to graph
              <CommandShortcut>
                <KbdGroup>
                  <Kbd>G</Kbd>
                  <Kbd>G</Kbd>
                </KbdGroup>
              </CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={close}>
              Go to deployments
              <CommandShortcut>
                <KbdGroup>
                  <Kbd>G</Kbd>
                  <Kbd>D</Kbd>
                </KbdGroup>
              </CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={close}>
              Go to variables
              <CommandShortcut>
                <KbdGroup>
                  <Kbd>G</Kbd>
                  <Kbd>V</Kbd>
                </KbdGroup>
              </CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={close}>
              Go to metrics
              <CommandShortcut>
                <KbdGroup>
                  <Kbd>G</Kbd>
                  <Kbd>M</Kbd>
                </KbdGroup>
              </CommandShortcut>
            </CommandItem>
          </CommandGroup>

          <CommandGroup heading="Environment">
            <CommandItem onSelect={close}>Switch to production</CommandItem>
            <CommandItem onSelect={close}>Switch to staging</CommandItem>
            <CommandItem onSelect={close}>Switch to preview</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
