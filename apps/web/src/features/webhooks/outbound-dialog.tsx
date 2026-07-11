/**
 * Add / edit an outbound webhook: target URL + the subscribed-event chip grid.
 * The event catalog is the SAME list notifications renders (one vocabulary).
 * Submits raw values — the page maps them onto the collection mutation. The
 * HMAC secret is minted server-side on create and revealed from the card.
 */
import { useState } from "react";

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
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(DEFAULT_EVENTS);
  const [error, setError] = useState<string | null>(null);

  // Re-seed when the dialog opens (edit hydrates, create resets).
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setUrl(editing?.url ?? "");
      setEvents(editing ? [...editing.events] : DEFAULT_EVENTS);
      setError(null);
    }
    onOpenChange(next);
  };

  const toggle = (id: string) =>
    setEvents((cur) => (cur.includes(id) ? cur.filter((e) => e !== id) : [...cur, id]));

  const submit = () => {
    const trimmed = url.trim();
    if (!URL_RE.test(trimmed)) {
      setError("Enter a valid URL (https://…)");
      return;
    }
    if (events.length === 0) {
      setError("Subscribe to at least one event");
      return;
    }
    onSubmit({ url: trimmed, events });
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
            submit();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="webhook-url">Target URL</Label>
            <Input
              id="webhook-url"
              className="font-mono"
              placeholder="https://hooks.example.com/intake"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-invalid={Boolean(error)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Subscribe to events</Label>
            <div className="flex flex-wrap gap-1.5">
              {EVENTS.map((e) => {
                const on = events.includes(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => toggle(e.id)}
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
