/**
 * Open/close state for the Add-server dialog, including the non-secret
 * carry-over used when re-adding a failed run.
 *
 * Lives in a hook rather than inline in the route so the branching (clear on
 * close, remount key) doesn't count against the route's complexity budget.
 */

import { useState } from "react";

import type { ProvisionInitialValues } from "./server-provision-form";

export interface AddServerDialogState {
  open: boolean;
  initial: ProvisionInitialValues | undefined;
  /** Remount key: TanStack Form reads defaultValues on mount only. */
  formKey: string;
  /** Plain "+ Add server": always starts blank. */
  openFresh: () => void;
  /** Re-add a failed server with its non-secret fields carried over. */
  openWith: (initial: ProvisionInitialValues) => void;
  onOpenChange: (next: boolean) => void;
}

export function useAddServerDialog(): AddServerDialogState {
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<ProvisionInitialValues | undefined>(undefined);

  return {
    open,
    initial,
    formKey: initial ? `readd:${initial.host}` : "new",
    openFresh: () => {
      setInitial(undefined);
      setOpen(true);
    },
    openWith: (values: ProvisionInitialValues) => {
      setInitial(values);
      setOpen(true);
    },
    onOpenChange: (next: boolean) => {
      setOpen(next);
      // Clear on close so a later "+ Add server" never inherits the last
      // failure's values.
      if (!next) setInitial(undefined);
    },
  };
}
