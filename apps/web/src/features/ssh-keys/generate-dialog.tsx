/**
 * Generate-an-SSH-key dialog. Collects a name, key type, optional comment and
 * passphrase, then asks the server to run `ssh-keygen`. The private half never
 * leaves the cluster — on success we just close and the new key appears in the
 * list (operators copy the PUBLIC key from its card to their Git host).
 */

import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import type { SshKeyType } from "./data/ssh-keys";
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
import { Label } from "@/shared/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/components/ui/radio-group";
import { cn } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

const KEY_TYPES: { value: SshKeyType; label: string; sub: string }[] = [
  { value: "ed25519", label: "ed25519", sub: "Recommended · small, fast, modern" },
  { value: "ecdsa", label: "ecdsa", sub: "NIST curves · widely supported" },
  { value: "rsa", label: "rsa-4096", sub: "Legacy · maximum compatibility" },
];

export function GenerateKeyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const generate = useMutation(
    orpc.sshKeys.generate.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: orpc.sshKeys.list.queryKey(),
        });
      },
    }),
  );

  const form = useForm({
    defaultValues: {
      name: "",
      type: "ed25519" as SshKeyType,
      comment: "",
      passphrase: "",
    },
    onSubmit: async ({ value }) => {
      try {
        await generate.mutateAsync({
          name: value.name.trim(),
          type: value.type,
          comment: value.comment.trim() || undefined,
          passphrase: value.passphrase || undefined,
        });
        toast.success("SSH key generated");
        setOpen(false);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to generate SSH key",
        );
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
          <DialogTitle>Generate SSH key</DialogTitle>
          <DialogDescription>
            We run <code className="font-mono text-xs">ssh-keygen</code> on the
            cluster. The private key is encrypted at rest and never shown — copy
            the public key to your Git host or server.
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
              onChange: ({ value }) =>
                value.trim().length === 0 ? "Name is required" : undefined,
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
                  placeholder="otterdeploy-prod"
                  autoFocus
                />
                {field.state.meta.errors.map((err) => (
                  <FieldError key={String(err)}>{String(err)}</FieldError>
                ))}
              </Field>
            )}
          </form.Field>

          <form.Field name="type">
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <Label>Key type</Label>
                <RadioGroup
                  value={field.state.value}
                  onValueChange={(v) =>
                    typeof v === "string" &&
                    field.handleChange(v as SshKeyType)
                  }
                  className="gap-2"
                >
                  {KEY_TYPES.map((t) => (
                    <Label
                      key={t.value}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-md border p-3",
                        field.state.value === t.value && "bg-muted/50",
                      )}
                    >
                      <RadioGroupItem value={t.value} className="mt-0.5" />
                      <span className="flex flex-col gap-0.5">
                        <span className="font-mono text-sm">{t.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {t.sub}
                        </span>
                      </span>
                    </Label>
                  ))}
                </RadioGroup>
              </div>
            )}
          </form.Field>

          <form.Field name="comment">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Comment</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="otterdeploy@helio"
                  className="font-mono"
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="passphrase">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>
                  Passphrase (optional)
                </FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  type="password"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="leave empty for unattended use"
                  className="font-mono"
                />
              </Field>
            )}
          </form.Field>

          <DialogFooter className="mt-1">
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <form.Subscribe selector={(s) => s.canSubmit}>
              {(canSubmit) => (
                <Button
                  size="sm"
                  type="submit"
                  disabled={!canSubmit || generate.isPending}
                >
                  {generate.isPending ? "Generating…" : "Generate"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
