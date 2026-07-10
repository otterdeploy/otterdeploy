/**
 * Upload a trusted CA certificate. Server-side validation requires an actual
 * CA (basicConstraints CA:TRUE) — server certs are pointed at "Upload custom"
 * instead. No private key is accepted here, ever.
 */
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

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

export function UploadCaDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const upload = useMutation(
    orpc.certificates.uploadCa.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.certificates.listCas.queryKey() });
      },
    }),
  );

  const form = useForm({
    defaultValues: { name: "", pem: "" },
    onSubmit: async ({ value }) => {
      try {
        const ca = await upload.mutateAsync({ name: value.name.trim(), pem: value.pem });
        toast.success(`Added ${ca.name} to the CA store`);
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to add CA");
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
          <DialogTitle>Upload trusted CA</DialogTitle>
          <DialogDescription>
            Stored as inventory — view and download the PEM from the table. Only a CA certificate
            (basicConstraints CA:TRUE) is accepted; no private key is ever uploaded here.
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
                  placeholder="internal-issuing-ca"
                  autoFocus
                />
                {field.state.meta.errors.map((err) => (
                  <FieldError key={String(err)}>{String(err)}</FieldError>
                ))}
              </Field>
            )}
          </form.Field>

          <form.Field
            name="pem"
            validators={{
              onChange: ({ value }) =>
                value.trim().length === 0
                  ? "CA certificate is required"
                  : value.includes("-----BEGIN")
                    ? undefined
                    : "Paste a PEM block (-----BEGIN CERTIFICATE-----)",
            }}
          >
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>CA certificate (PEM)</FieldLabel>
                <Textarea
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder={`-----BEGIN CERTIFICATE-----\nMIIFazCCA1OgAwIBAgIRAIIQ…\n-----END CERTIFICATE-----`}
                  rows={8}
                  className="font-mono text-xs"
                  spellCheck={false}
                />
                {field.state.meta.errors.map((err) => (
                  <FieldError key={String(err)}>{String(err)}</FieldError>
                ))}
              </Field>
            )}
          </form.Field>

          <DialogFooter className="mt-1">
            <Button size="sm" variant="outline" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <form.Subscribe selector={(s) => s.canSubmit}>
              {(canSubmit) => (
                <Button size="sm" type="submit" disabled={!canSubmit || upload.isPending}>
                  {upload.isPending ? "Validating…" : "Add CA"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
