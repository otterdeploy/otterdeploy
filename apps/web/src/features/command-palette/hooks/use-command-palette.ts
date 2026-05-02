import { useEffect, useState } from "react";

export function useCommandPalette(): {
  open: boolean;
  setOpen: (next: boolean) => void;
  toggle: () => void;
} {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handler(event: KeyboardEvent) {
      const isModK = event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey);
      if (!isModK) return;
      event.preventDefault();
      setOpen((prev) => !prev);
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return { open, setOpen, toggle: () => setOpen((p) => !p) };
}
