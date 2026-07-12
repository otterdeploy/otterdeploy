/**
 * Shared destructive-confirmation dialog — the one safety pattern for every
 * irreversible action in the app.
 *
 * Two strengths, one component:
 * - `confirmPhrase` set → type-the-phrase gate: the confirm button stays
 *   disabled until the input exactly matches (deletes, drops, teardowns).
 * - `confirmPhrase` omitted → a plain styled confirm for recoverable-but-
 *   consequential actions (rollback, blocklist removal). Never `window.confirm`.
 *
 * Works trigger-based (pass `trigger`, the dialog owns its open state) or
 * controlled (pass `open` + `onOpenChange`, e.g. when the confirm is raised
 * imperatively from a hook). Escape / dismiss always cancels and resets the
 * typed input. The dialog never auto-closes on confirm — async callers keep it
 * open via `pending` until they close/unmount it; sync callers close it in
 * `onConfirm` (controlled) or let success unmount it (trigger-based).
 *
 * Tone per DESIGN.md: destructive is a tint, the solid destructive fill is
 * reserved for the confirm button — the single most consequential action.
 */

import { useState, type ReactElement, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

interface TypedConfirmDialogProps {
  /** Trigger element (a Button, usually). Omit when controlling via `open`. */
  trigger?: ReactElement;
  /** Controlled open state — pair with `onOpenChange`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  /** Consequence copy — say honestly what happens, and that it can't be undone. */
  description: ReactNode;
  /** Optional extra consequence slot (e.g. the SQL about to run). */
  children?: ReactNode;
  /** When set, the confirm button is disabled until the input matches exactly. */
  confirmPhrase?: string;
  confirmLabel: string;
  /** Label shown on the confirm button while `pending` (falls back to confirmLabel). */
  pendingLabel?: string;
  /** Async in flight — disables both buttons and keeps the dialog open. */
  pending?: boolean;
  onConfirm: () => void;
}

export function TypedConfirmDialog({
  trigger,
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmPhrase,
  confirmLabel,
  pendingLabel,
  pending = false,
  onConfirm,
}: TypedConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const phraseOk = confirmPhrase === undefined || typed.trim() === confirmPhrase;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTyped("");
        onOpenChange?.(next);
      }}
    >
      {trigger ? <AlertDialogTrigger render={trigger} /> : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        {confirmPhrase !== undefined ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] text-muted-foreground">
              Type <span className="font-mono text-foreground">{confirmPhrase}</span> to confirm
            </span>
            <Input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={confirmPhrase}
              className="font-mono"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label={`Type ${confirmPhrase} to confirm`}
            />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel
            render={
              <Button variant="outline" size="sm" disabled={pending}>
                Cancel
              </Button>
            }
          />
          <AlertDialogAction
            render={
              <Button
                variant="destructive"
                size="sm"
                disabled={!phraseOk || pending}
                onClick={onConfirm}
              >
                {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
              </Button>
            }
          />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
