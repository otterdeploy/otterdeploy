/**
 * Add / edit an outbound webhook: target URL + the subscribed-event chip grid.
 * The event catalog is the SAME list notifications renders (one vocabulary).
 * Submits raw values — the page maps them onto the collection mutation. The
 * HMAC secret is minted server-side on create and revealed from the card.
 */
import { useState } from "react";

import { useForm } from "@tanstack/react-form";

import { EVENTS, SEVERITY_DOT } from "@/features/notifications/shared";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { cn } from "@/shared/lib/utils";

import { type OutboundWebhook } from "./shared";

export interface OutboundFormValues {
  url: string;
  events: string[];
}

const URL_RE = /^https?:\/\/.+/i;
const DEFAULT_EVENTS = ["deploy.succeeded", "deploy.failed"];

interface OutboundDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** null → create; a webhook → edit that webhook. */
  editing: OutboundWebhook | null;
  onSubmit: (values: OutboundFormValues) => void;
}

export function OutboundDialog({ open, onOpenChange, editing, onSubmit }: OutboundDialogProps) {
  const isEdit = editing !== null;
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { url: "", events: DEFAULT_EVENTS },
    onSubmit: ({ value }) => {
      const trimmed = value.url.trim();
      if (!URL_RE.test(trimmed)) {
        setError("Enter a valid URL (https://…)");
        return;
      }
      if (value.events.length === 0) {
        setError("Subscribe to at least one event");
        return;
      }
      onSubmit({ url: trimmed, events: value.events });
    },
  });

  // Re-seed when the dialog opens (edit hydrates, create resets).
  const handleOpenChange = (next: boolean) => {
    if (next) {
      form.reset({
        url: editing?.url ?? "",
        events: editing ? [...editing.events] : DEFAULT_EVENTS,
      });
      setError(null);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit outbound webhook" : "Add outbound webhook"}</DialogTitle>
          <DialogDescription>
            Every payload is a JSON POST signed with HMAC-SHA256 in the{" "}
            <span className="font-mono text-foreground">X-Otterdeploy-Signature</span> header.
            {!isEdit && <> The signing secret is generated for you and revealed on the card.</>}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <form.Field name="url">
            {(field) => (
              <div className="flex flex-col gap-2">
                <Label htmlFor="webhook-url">Target URL</Label>
                <Input
                  id="webhook-url"
                  className="font-mono"
                  placeholder="https://hooks.example.com/intake"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={Boolean(error)}
                />
              </div>
            )}
          </form.Field>

          <form.Field name="events">
            {(field) => (
              <div className="flex flex-col gap-2">
                <Label>Subscribe to events</Label>
                <div className="flex flex-wrap gap-1.5">
                  {EVENTS.map((e) => {
                    const on = field.state.value.includes(e.id);
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() =>
                          field.handleChange(
                            on
                              ? field.state.value.filter((id) => id !== e.id)
                              : [...field.state.value, e.id],
                          )
                        }
                        aria-pressed={on}
                        title={e.label}
                        className={cn(
                          "flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] transition-colors",
                          on
                            ? "border-foreground/40 bg-muted text-foreground"
                            : "border-border text-muted-foreground hover:bg-muted/50",
                        )}
                      >
                        <span className={cn("size-1.5 rounded-full", SEVERITY_DOT[e.severity])} />
                        {e.id}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </form.Field>

          {error && <p className="text-[11px] text-destructive">{error}</p>}

          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{isEdit ? "Save changes" : "Create webhook"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
