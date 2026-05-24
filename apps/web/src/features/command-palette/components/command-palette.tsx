import { useNavigate, useParams } from "@tanstack/react-router";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/components/ui/command";
import { useCommandPalette } from "../hooks/use-command-palette";

export function CommandPalette() {
  const { open, setOpen } = useCommandPalette();
  const navigate = useNavigate();
  const { orgSlug, projectSlug } = useParams({ strict: false });

  const close = () => setOpen(false);

  return (
    <CommandDialog open={open} onOpenChange={setOpen} className="max-w-xl gap-0 p-0">
      <Command>
        <CommandInput placeholder="Type a command or search…" />
        <CommandList>
          <CommandEmpty>No matching command.</CommandEmpty>

          {orgSlug && (
            <CommandGroup heading="Organization">
              <CommandItem
                onSelect={() => {
                  void navigate({ to: "/$orgSlug", params: { orgSlug } });
                  close();
                }}
              >
                Org overview
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  void navigate({ to: "/$orgSlug/servers", params: { orgSlug } });
                  close();
                }}
              >
                Servers
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  void navigate({ to: "/$orgSlug/networking", params: { orgSlug } });
                  close();
                }}
              >
                Networking
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  void navigate({ to: "/$orgSlug/team", params: { orgSlug } });
                  close();
                }}
              >
                Team
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  void navigate({ to: "/$orgSlug/settings", params: { orgSlug } });
                  close();
                }}
              >
                Settings
              </CommandItem>
            </CommandGroup>
          )}

          {orgSlug && projectSlug && (
            <CommandGroup heading="Project">
              <CommandItem
                onSelect={() => {
                  void navigate({
                    to: "/$orgSlug/$projectSlug",
                    params: { orgSlug, projectSlug },
                  });
                  close();
                }}
              >
                Project overview
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  void navigate({
                    to: "/$orgSlug/$projectSlug/graph",
                    params: { orgSlug, projectSlug },
                  });
                  close();
                }}
              >
                Graph
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  void navigate({
                    to: "/$orgSlug/$projectSlug/new-resource",
                    params: { orgSlug, projectSlug },
                  });
                  close();
                }}
              >
                Add resource
              </CommandItem>
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
