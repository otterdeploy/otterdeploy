/**
 * Import-an-SSH-key dialog. The operator pastes a public-key line; we keep only
 * the public half (no private key on our side). Client-side we detect the type
 * for instant feedback, but the server re-validates with `ssh-keygen` on submit.
 */

import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import { orpc, queryClient } from "@/shared/server/orpc";

import type { SshKeyType } from "./data/ssh-keys";

function detectType(pubkey: string): SshKeyType | null {
  const t = pubkey.trim();
  if (!t) return null;
  if (t.startsWith("ssh-ed25519")) return "ed25519";
  if (t.startsWith("ssh-rsa")) return "rsa";
  if (t.startsWith("ecdsa-sha2-")) return "ecdsa";
  return null;
}

export function ImportKeyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const importKey = useMutation(
    orpc.sshKeys.import.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: orpc.sshKeys.list.queryKey(),
        });
      },
    }),
  );

  const form = useForm({
    defaultValues: { name: "", publicKey: "" },
    onSubmit: async ({ value }) => {
      try {
        await importKey.mutateAsync({
          name: value.name.trim(),
          publicKey: value.publicKey.trim(),
        });
        toast.success("SSH key imported");
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to import SSH key");
      }
    },
  });

  const setOpen = (next: boolean) => {
    if (!next) form.reset();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import SSH key</DialogTitle>
          <DialogDescription>
            Paste a public key. Only the public half is stored — keep the private key on your own
            machine.
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
          <form.Field
            name="name"
            validators={{
              onChange: ({ value }) => (value.trim().length === 0 ? "Name is required" : undefined),
            }}
          >
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="alice-laptop"
                  autoFocus
                />
                {field.state.meta.errors.map((err) => (
                  <FieldError key={String(err)}>{String(err)}</FieldError>
                ))}
              </Field>
            )}
          </form.Field>

          <form.Field
            name="publicKey"
            validators={{
              onChange: ({ value }) =>
                value.trim().length === 0 ? "Public key is required" : undefined,
            }}
          >
            {(field) => (
              <DetectField
                value={field.state.value}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
                errors={field.state.meta.errors.map(String)}
              />
            )}
          </form.Field>

          <DialogFooter className="mt-1">
            <Button size="sm" variant="outline" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <form.Subscribe selector={(s) => s.canSubmit}>
              {(canSubmit) => (
                <Button size="sm" type="submit" disabled={!canSubmit || importKey.isPending}>
                  {importKey.isPending ? "Importing…" : "Import"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DetectField({
  value,
  onChange,
  onBlur,
  errors,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  errors: string[];
}) {
  const detected = detectType(value);
  return (
    <Field>
      <FieldLabel htmlFor="ssh-public-key">Public key</FieldLabel>
      <Textarea
        id="ssh-public-key"
        rows={5}
        value={value}
        onBlur={onBlur}
        onChange={(e) => onChange(e.target.value)}
        placeholder="ssh-ed25519 AAAA…  alice@host"
        className="resize-y font-mono text-xs leading-relaxed"
      />
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Detected type:</span>
        {detected ? (
          <Badge variant="outline" className="font-mono text-[11px]">
            {detected}
          </Badge>
        ) : value.trim() ? (
          <span className="text-destructive">unrecognised — paste the full public-key line</span>
        ) : (
          <span>paste a public key above</span>
        )}
      </div>
      {errors.map((err) => (
        <FieldError key={err}>{err}</FieldError>
      ))}
    </Field>
  );
}
