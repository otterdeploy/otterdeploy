/**
 * Mint dialog for ephemeral database URLs: TTL + scope + optional label, then
 * a shown-once result view (the password is never stored server-side, so the
 * URL cannot be re-fetched — closing the dialog discards it for good).
 */

import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { SettingsRowReadOnly } from "@/features/resources/components/_shared/settings-card";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Field, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { orpc } from "@/shared/server/orpc";

import { expiresIn } from "./ephemeral-shared";

const TTL_OPTIONS = [
  { label: "15 minutes", value: "15" },
  { label: "1 hour", value: "60" },
  { label: "8 hours", value: "480" },
  { label: "24 hours", value: "1440" },
  { label: "7 days", value: "10080" },
];

const SCOPE_OPTIONS = [
  { label: "Read-only", value: "read-only" },
  { label: "Read-write", value: "read-write" },
];

interface Minted {
  internalUrl: string;
  publicUrl: string | null;
  expiresAt: string;
}

function OptionSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ label: string; value: string }>;
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select value={value} onValueChange={(v) => v && onChange(v)} items={options}>
        <SelectTrigger className="text-[12.5px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-[12.5px]">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

export function EphemeralMintDialog({
  resourceId,
  open,
  onOpenChange,
  onMinted,
}: {
  resourceId: never;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMinted: () => Promise<unknown>;
}) {
  const [ttl, setTtl] = useState("60");
  const [scope, setScope] = useState("read-only");
  const [label, setLabel] = useState("");
  const [minted, setMinted] = useState<Minted | null>(null);

  const create = useMutation({
    ...orpc.database.ephemeralCreate.mutationOptions(),
    onSuccess: async (result) => {
      setMinted(result);
      await onMinted();
    },
    onError: (err) => toast.error(err.message ?? "Failed to mint the credential"),
  });

  const setOpen = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      // Reset for the next mint — the shown-once URL must not linger.
      setMinted(null);
      setLabel("");
      setTtl("60");
      setScope("read-only");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        {minted ? (
          <>
            <DialogHeader>
              <DialogTitle>Connection URL minted</DialogTitle>
              <DialogDescription>
                Copy it now — the password isn't stored, so this URL can't be shown again. It stops
                working {expiresIn(minted.expiresAt).replace("expires ", "")}.
              </DialogDescription>
            </DialogHeader>
            <div className="overflow-hidden rounded-md border bg-card">
              {minted.publicUrl && (
                <SettingsRowReadOnly label="Public URL" value={minted.publicUrl} />
              )}
              <SettingsRowReadOnly label="Internal URL" value={minted.internalUrl} />
            </div>
            {!minted.publicUrl && (
              <p className="text-[11px] text-muted-foreground">
                Only reachable from services on this project's network. Enable public access on this
                database to mint URLs that work from anywhere.
              </p>
            )}
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Mint an ephemeral URL</DialogTitle>
              <DialogDescription>
                Creates a temporary database role that expires on its own. Read-only grants SELECT
                on everything; read-write acts as the app user.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <OptionSelect
                  label="Expires after"
                  value={ttl}
                  onChange={setTtl}
                  options={TTL_OPTIONS}
                />
                <OptionSelect
                  label="Scope"
                  value={scope}
                  onChange={setScope}
                  options={SCOPE_OPTIONS}
                />
              </div>
              <Field>
                <FieldLabel>Label (optional)</FieldLabel>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. claude data-analysis agent"
                  maxLength={120}
                />
              </Field>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={create.isPending}
                onClick={() =>
                  create.mutate({
                    resourceId,
                    ttlMinutes: Number(ttl),
                    scope: scope as "read-only" | "read-write",
                    label: label.trim() || undefined,
                  })
                }
              >
                {create.isPending ? "Minting…" : "Mint URL"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
