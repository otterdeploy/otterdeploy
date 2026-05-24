import { SearchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useHotkey, useHotkeySequence } from "@tanstack/react-hotkeys";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Command as CommandPrimitive } from "cmdk";

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
import { useNewResourceOverlay } from "@/features/projects/components/new-resource/overlay-provider";

import { useCommandPalette } from "../hooks/use-command-palette";

export function CommandPalette() {
  const { open, setOpen } = useCommandPalette();
  const navigate = useNavigate();
  const { orgSlug, projectSlug } = useParams({ strict: false });
  const overlay = useNewResourceOverlay();

  const close = () => setOpen(false);

  const goNewResource = () => {
    if (orgSlug && projectSlug) {
      overlay.setOpen(true);
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

  // Global keyboard shortcuts. `ignoreInputs` defaults to true for single keys
  // and sequences, so these don't fire while the user is typing in any input
  // (including the palette's own search field).
  useHotkey("D", goNewResource);
  useHotkeySequence(["G", "G"], goGraph);

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
            Select
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>esc</Kbd>
            Close
          </span>
        </div>
      </Command>
    </CommandDialog>
  );
}
