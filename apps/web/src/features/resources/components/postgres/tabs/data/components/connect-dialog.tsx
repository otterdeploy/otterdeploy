/**
 * Saving an external database URL.
 *
 * The URL field is write-only in every sense: it is sent through the mutation's
 * `metadata.secret` so it never enters the collection's cached rows, no
 * procedure returns it, and editing an existing connection leaves it blank —
 * meaning "keep the stored credential" rather than "clear it".
 *
 * The form deliberately surfaces the server's refusal verbatim. A blocked
 * loopback or metadata address is not a validation nit; it is worth reading.
 */
import { useState } from "react";

import { useForm } from "@tanstack/react-form";
import { Result } from "better-result";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

import type { DataConnection } from "../data/connections";

import { connectionsCollection } from "../data/connections";

type Visibility = DataConnection["visibility"];
type Environment = DataConnection["environment"];

interface ConnectDraft {
  name: string;
  /** Blank when editing means "keep the stored credential". */
  url: string;
  visibility: Visibility;
  environment: Environment;
  requireTls: boolean;
}

export function ConnectDialog({
  open,
  onOpenChange,
  existing,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Set when editing; the URL field then means "replace the credential". */
  existing?: DataConnection;
}) {
  const [error, setError] = useState<string | null>(null);
  const editing = existing !== undefined;

  // Annotated, not asserted: the literal widens to `string` inside an inline
  // object, and the repo bans assertions — so the shape is declared once here
  // and the literals are checked against it.
  const defaultValues: ConnectDraft = {
    name: existing?.name ?? "",
    url: "",
    visibility: existing?.visibility ?? "org",
    environment: existing?.environment ?? "other",
    requireTls: existing?.requireTls ?? true,
  };

  const form = useForm({
    defaultValues,
    onSubmit: ({ value }) => {
      setError(null);
      const outcome = saveConnection(value, existing);
      if (outcome !== null) {
        // The server's own words: "169.254.169.254 is a loopback, private or
        // metadata address…" is the whole explanation, and paraphrasing it into
        // "invalid URL" would throw away the only useful part.
        setError(outcome);
        return;
      }
      toast.success(editing ? "Connection updated" : "Connection saved");
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit connection" : "Connect a database"}</DialogTitle>
          <DialogDescription>
            Point the workbench at a Postgres or MySQL database otterdeploy doesn&rsquo;t run. The
            URL is encrypted and never sent back to the browser.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <form.Field name="name">
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="conn-name">Name</Label>
                <Input
                  id="conn-name"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="neon-analytics"
                />
              </div>
            )}
          </form.Field>

          <form.Field name="url">
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="conn-url">
                  Connection URL{editing ? " (leave blank to keep the current one)" : ""}
                </Label>
                <Input
                  id="conn-url"
                  type="password"
                  autoComplete="off"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="postgresql://user:password@host/database"
                  className="font-mono text-[12px]"
                />
              </div>
            )}
          </form.Field>

          <div className="flex gap-3">
            <form.Field name="environment">
              {(field) => (
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label>Environment</Label>
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => field.handleChange(v === "production" ? v : "other")}
                  >
                    <SelectTrigger size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="other">Not production</SelectItem>
                      <SelectItem value="production">Production (read-only)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </form.Field>

            <form.Field name="visibility">
              {(field) => (
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label>Visible to</Label>
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => field.handleChange(v === "private" ? v : "org")}
                  >
                    <SelectTrigger size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="org">Everyone in this org</SelectItem>
                      <SelectItem value="private">Only me</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </form.Field>
          </div>

          <form.Field name="requireTls">
            {(field) => (
              <label className="flex items-center gap-2 text-[13px]">
                <Checkbox
                  checked={field.state.value}
                  onCheckedChange={(v) => field.handleChange(Boolean(v))}
                />
                Require TLS
                <span className="text-muted-foreground">
                  — the hop leaves the cluster, so this should stay on
                </span>
              </label>
            )}
          </form.Field>

          {error !== null ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void form.handleSubmit()}>
            {editing ? "Save" : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Apply the draft to the collection. Returns an error message, or null on success.
 *
 * The URL travels in the mutation's `metadata.secret`, never on the row: a
 * write-only field must not end up in the collection's cached data, where every
 * reader of the connection list would be holding a live credential.
 */
function saveConnection(value: ConnectDraft, existing: DataConnection | undefined): string | null {
  // A production connection is read-only, full stop. The gate is the
  // CONNECTION, not a per-edit approval — so this is derived, never asked.
  const defaultAccess = value.environment === "production" ? "read-only" : "read-write";

  const attempt = Result.try({
    try: () => {
      if (existing !== undefined) {
        connectionsCollection.update(
          existing.id,
          { metadata: value.url === "" ? undefined : { secret: value.url } },
          (draft) => {
            draft.name = value.name;
            draft.visibility = value.visibility;
            draft.environment = value.environment;
            draft.defaultAccess = defaultAccess;
            draft.requireTls = value.requireTls;
          },
        );
        return;
      }
      connectionsCollection.insert(
        {
          // Replaced by the server's row on refetch; the engine and host are
          // parsed from the URL there, so the optimistic values are placeholders.
          id: crypto.randomUUID(),
          name: value.name,
          engine: "postgres",
          displayHost: "",
          displayDatabase: "",
          visibility: value.visibility,
          environment: value.environment,
          defaultAccess,
          requireTls: value.requireTls,
          createdAt: new Date(),
          lastConnectedAt: null,
        },
        { metadata: { secret: value.url } },
      );
    },
    catch: (cause) => (cause instanceof Error ? cause.message : "Could not save the connection."),
  });

  return attempt.isErr() ? attempt.error : null;
}
