/**
 * The dialog's two regions under the header: a padded body and the muted
 * footer, with a lead on the left and the actions on the right.
 */

import type { ReactNode } from "react";

import { DialogFooter } from "@/shared/components/ui/dialog";

export function PanelBody({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-5 px-5 pt-5 pb-5">{children}</div>;
}

export function PanelFooter({ lead, children }: { lead?: ReactNode; children: ReactNode }) {
  return (
    <DialogFooter className="mx-0 mb-0 flex-row flex-wrap items-center justify-between gap-y-2 px-5 py-3 sm:justify-between">
      <div className="min-w-0">{lead}</div>
      <div className="ml-auto flex gap-2">{children}</div>
    </DialogFooter>
  );
}
