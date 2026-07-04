/**
 * "New GitHub App" dialog — creates a GitHub App for the org via GitHub's
 * manifest flow (no config, no env vars).
 *
 *   - Name: GitHub App names are GLOBALLY unique, so we pre-fill a random one.
 *   - Organization: blank → the App is created under the operator's personal
 *     account; a login → created under that org (a private App can only be
 *     installed where it's owned).
 *   - Self-hosted / Enterprise: optional GHE host to create the App on.
 *
 * On submit we get back a form-action URL + manifest JSON, build a hidden form
 * and auto-submit it — the browser leaves our origin, lands on GitHub's
 * app-creation page pre-filled, and on approval GitHub redirects to
 * `/api/integrations/github/manifest/callback`, which persists the creds and
 * forwards to the install URL. Reusing an existing App is the card's
 * "Reinstall" action (startConnect), not this creation form.
 */

import { useMemo, useState } from "react";

import { ArrowDown01Icon, GitBranchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import * as z from "zod";

import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { Spinner } from "@/shared/components/ui/spinner";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { PROVIDER_SEARCH } from "./shared";

interface ConnectDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

// Fields are always present (the form seeds ""), so no `.optional()` — that
// keeps the schema's type aligned with the all-string form values.
const schema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name is too long"),
  org: z.string(),
  host: z.string(),
});

/** Strip scheme/trailing slash; treat empty or github.com as "no GHE host". */
function normalizeHost(raw: string | undefined): string | undefined {
  const h = (raw ?? "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  return !h || h === "github.com" ? undefined : h;
}

function errMessages(errors: readonly unknown[]): string[] {
  return errors
    .map((e) => (typeof e === "string" ? e : (e as { message?: string } | undefined)?.message))
    .filter((m): m is string => Boolean(m));
}

export function ConnectDialog({ open, onOpenChange }: ConnectDialogProps) {
  // GitHub App names must be unique across all of GitHub — seed a random one.
  const defaultName = useMemo(() => `otterdeploy-${crypto.randomUUID().slice(0, 8)}`, []);
  const [enterpriseOpen, setEnterpriseOpen] = useState(false);

  const startManifest = useMutation({
    ...orpc.git.startManifest.mutationOptions(),
    onSuccess: (res) => {
      submitManifestForm(res.formActionUrl, res.manifestJson);
    },
    onError: (err) => toast.error(err.message ?? "Failed to start GitHub App creation"),
  });

  const form = useForm({
    defaultValues: { name: defaultName, org: "", host: "" },
    validators: { onChange: schema },
    onSubmit: ({ value }) => {
      startManifest.mutate({
        appName: value.name.trim(),
        accountLogin: value.org.trim() || undefined,
        host: normalizeHost(value.host),
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={GitBranchIcon} strokeWidth={2} className="size-3.5" />
            New GitHub App
          </DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Otterdeploy creates a GitHub App through GitHub's manifest flow — no config, no env
            vars. You'll review and approve it on GitHub, then pick which repos it can access.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="name">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name} className="text-[12px]">
                    Name
                  </FieldLabel>
                  <Input
                    id={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    className="font-mono text-[13px]"
                    disabled={startManifest.isPending}
                  />
                  {errMessages(field.state.meta.errors).map((m) => (
                    <FieldError key={m}>{m}</FieldError>
                  ))}
                </Field>
              )}
            </form.Field>

            <form.Field name="org">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name} className="text-[12px]">
                    Organization <span className="text-muted-foreground">(optional)</span>
                  </FieldLabel>
                  <Input
                    id={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="Personal account if blank"
                    className="font-mono text-[13px]"
                    disabled={startManifest.isPending}
                  />
                </Field>
              )}
            </form.Field>
          </div>

          <p className="-mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
            To install on an organization, enter its GitHub login — the App is created under that
            org so it can be installed there. You must be an owner of the org.
          </p>

          {/* ─── Self-hosted / Enterprise (collapsible) ─── */}
          <div className="rounded-lg border border-border">
            <button
              type="button"
              onClick={() => setEnterpriseOpen((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-[12.5px] font-medium"
            >
              Self-hosted / Enterprise GitHub
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                strokeWidth={2}
                className={cn(
                  "size-4 text-muted-foreground transition-transform",
                  enterpriseOpen && "rotate-180",
                )}
              />
            </button>
            {enterpriseOpen ? (
              <div className="border-t border-border px-3 py-3">
                <form.Field name="host">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor={field.name} className="text-[12px]">
                        GitHub host
                      </FieldLabel>
                      <Input
                        id={field.name}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="github.example.com"
                        className="font-mono text-[13px]"
                        disabled={startManifest.isPending}
                      />
                      <p className="pt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                        Leave blank for github.com. The API base is derived automatically (
                        <span className="font-mono">{"{host}/api/v3"}</span>).
                      </p>
                    </Field>
                  )}
                </form.Field>
              </div>
            ) : null}
          </div>

          <form.Subscribe selector={(s) => ({ canSubmit: s.canSubmit })}>
            {({ canSubmit }) => (
              <Button type="submit" size="lg" disabled={!canSubmit || startManifest.isPending}>
                <SvglLogo search={PROVIDER_SEARCH.github} fallback="GitHub" size={18} />
                {startManifest.isPending ? "Redirecting…" : "Continue on GitHub"}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * GitHub's manifest endpoint takes the manifest in a form field, not a query
 * param (the JSON is too big for a URL). We build a hidden form and submit it
 * from the operator's browser so GitHub sees a same-tab navigation it can
 * redirect back from.
 */
function submitManifestForm(actionUrl: string, manifestJson: string): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = actionUrl;
  // _top so iframed instances still leave their frame and land on
  // github.com fullscreen.
  form.target = "_top";

  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "manifest";
  input.value = manifestJson;
  form.appendChild(input);

  document.body.appendChild(form);
  form.submit();
}
