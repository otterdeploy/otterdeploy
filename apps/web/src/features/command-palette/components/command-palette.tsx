import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandList,
} from "@/shared/components/ui/command";
import { useCommandPalette } from "../hooks/use-command-palette";

export function CommandPalette() {
  const { open, setOpen } = useCommandPalette();
  return (
    <CommandDialog open={open} onOpenChange={setOpen} className="max-w-xl gap-0 p-0">
      <Command>
        <CommandInput placeholder="Type a command or search…" />
        <CommandList>
          <CommandEmpty>Actions coming soon.</CommandEmpty>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
