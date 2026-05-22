import { useCallback, useState } from "react";
import type { DrawerSelection } from "../types";

export function useResourceDrawer(): {
  selection: DrawerSelection;
  open: boolean;
  select: (next: DrawerSelection) => void;
  close: () => void;
} {
  const [selection, setSelection] = useState<DrawerSelection>(null);
  const select = useCallback((next: DrawerSelection) => setSelection(next), []);
  const close = useCallback(() => setSelection(null), []);
  return { selection, open: selection !== null, select, close };
}
