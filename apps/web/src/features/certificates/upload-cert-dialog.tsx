/**
 * Upload / replace a custom certificate. Collects the PEM chain (leaf first)
 * and the unencrypted private key; the server validates that the chain
 * parses, the key pairs with the leaf and the hostname is covered BEFORE
 * anything is stored. The success toast reports the REAL edge outcome
 * (`applied`) — "stored but not installed" is shown as exactly that.
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
import { orpc } from "@/shared/server/orpc";

import type { CustomCertificate } from "./data/certificates";

import { invalidateCertificates } from "./data/certificates";

const CERT_PLACEHOLDER = `-----BEGIN CERTIFICATE-----\nMIIDxTCCAq2gAwIBAgIQ…\n-----END CERTIFICATE-----`;
const KEY_PLACEHOLDER = `-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEF…\n-----END PRIVATE KEY-----`;

function reportOutcome(result: { applied: boolean; applyError: string | null }, hostname: string) {
  if (result.applied) {
    toast.success(`Certificate for ${hostname} installed at the edge`);
  } else {
    toast.warning(`Certificate for ${hostname} stored — but not installed`, {
      description: result.applyError ?? "Installation did not complete.",
      duration: 10_000,
    });
  }
}

export function UploadCertDialog({
  open,
  onOpenChange,
  replaceTarget,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** When set, the dialog replaces this cert's material (hostname fixed). */
  replaceTarget?: CustomCertificate;
}) {
  const upload = useMutation(
    orpc.certificates.uploadCustom.mutationOptions({
      onSuccess: () => invalidateCertificates(),
    }),
  );
  const replace = useMutation(
    orpc.certificates.replaceCustom.mutationOptions({
      onSuccess: () => invalidateCertificates(),
    }),
  );
  const pending = upload.isPending || replace.isPending;

  const form = useForm({
    defaultValues: { hostname: "", certPem: "", keyPem: "" },
    onSubmit: async ({ value }) => {
      try {
        if (replaceTarget) {
          const result = await replace.mutateAsync({
            id: replaceTarget.id,
            certPem: value.certPem,
            keyPem: value.keyPem,
          });
          reportOutcome(result, replaceTarget.hostname);
        } else {
          const result = await upload.mutateAsync({
            hostname: value.hostname.trim() || undefined,
            certPem: value.certPem,
            keyPem: value.keyPem,
          });
          reportOutcome(result, result.certificate.hostname);
        }
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to upload certificate");
      }
    },
  });

  const setOpen = (next: boolean) => {
    if (!next) form.reset();
    onOpenChange(next);
  };

  const requirePem = (kind: string) => (value: string) => {
    if (value.trim().length === 0) return `${kind} is required`;
    if (!value.includes("-----BEGIN")) return `Paste a PEM block (-----BEGIN …-----)`;
    return undefined;
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {replaceTarget
              ? `Replace certificate · ${replaceTarget.hostname}`
              : "Upload custom certificate"}
          </DialogTitle>
          <DialogDescription>
            The chain and key are validated before anything is stored: the PEM must parse, the key
            must pair with the leaf, and the hostname must be covered by its CN/SANs. The private
            key is encrypted at rest and never shown again.
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
          {replaceTarget ? null : (
            <form.Field name="hostname">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Hostname (optional)</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="derived from the certificate's CN when left empty"
                    className="font-mono"
                    autoFocus
                  />
                </Field>
              )}
            </form.Field>
          )}

          <form.Field
            name="certPem"
            validators={{ onChange: ({ value }) => requirePem("Certificate chain")(value) }}
          >
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Certificate chain (PEM, leaf first)</FieldLabel>
                <Textarea
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder={CERT_PLACEHOLDER}
                  rows={6}
                  className="font-mono text-xs"
                  spellCheck={false}
                />
                {field.state.meta.errors.map((err) => (
                  <FieldError key={String(err)}>{String(err)}</FieldError>
                ))}
              </Field>
            )}
          </form.Field>

          <form.Field
            name="keyPem"
            validators={{ onChange: ({ value }) => requirePem("Private key")(value) }}
          >
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Private key (PEM, unencrypted)</FieldLabel>
                <Textarea
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder={KEY_PLACEHOLDER}
                  rows={5}
                  className="font-mono text-xs"
                  spellCheck={false}
                />
                {field.state.meta.errors.map((err) => (
                  <FieldError key={String(err)}>{String(err)}</FieldError>
                ))}
              </Field>
            )}
          </form.Field>

          <p className="text-xs text-muted-foreground">
            Custom certificates are not auto-renewed — replace the material here before it expires.
          </p>

          <DialogFooter className="mt-1">
            <Button size="sm" variant="outline" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <form.Subscribe selector={(s) => s.canSubmit}>
              {(canSubmit) => (
                <Button size="sm" type="submit" disabled={!canSubmit || pending}>
                  {pending ? "Validating…" : replaceTarget ? "Replace" : "Upload"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
