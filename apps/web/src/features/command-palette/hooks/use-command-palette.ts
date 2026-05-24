import { useState } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";

export function useCommandPalette(): {
  open: boolean;
  setOpen: (next: boolean) => void;
  toggle: () => void;
} {
  const [open, setOpen] = useState(false);

  useHotkey("Mod+K", (event) => {
    event.preventDefault();
    setOpen((prev) => !prev);
  });

  return { open, setOpen, toggle: () => setOpen((p) => !p) };
}
