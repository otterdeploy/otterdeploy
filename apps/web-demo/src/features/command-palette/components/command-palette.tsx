import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandInput,
  CommandList,
} from "../ui/command";
import { useCommandPalette } from "../hooks/use-command-palette";

export function CommandPalette() {
  const { open, setOpen } = useCommandPalette();
  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandDialogPopup className="max-w-xl gap-0 p-0">
        <Command>
          <CommandInput placeholder="Type a command or search…" />
          <CommandList>
            <CommandEmpty>Actions coming soon.</CommandEmpty>
          </CommandList>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
