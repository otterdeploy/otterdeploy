/**
 * Add / edit a notification channel. Channel type is picked from a pill row
 * (locked in edit mode); the field set below adapts to the selected kind.
 * Submits raw form values — the page maps them onto the create/update
 * collection mutation. In edit mode the destination + secret start blank: leave
 * them empty to keep the stored values (the list only ever exposes a masked
 * target, never the secret).
 */
import { useForm } from "@tanstack/react-form";

import { SvglLogo } from "@/shared/components/brand/svgl-logo";
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

import { ChannelFields, PLACEHOLDERS } from "./channel-fields";
import { type Channel, type ChannelKind, KIND_META } from "./shared";

export interface ChannelFormValues {
  kind: ChannelKind;
  name: string;
  target: string;
  secret: string;
  config: Record<string, string>;
}

interface ChannelDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** null → create; a channel → edit that channel. */
  editing: Channel | null;
  submitting?: boolean;
  onSubmit: (values: ChannelFormValues) => void;
}

function editingDefaults(editing: Channel | null): ChannelFormValues {
  const config: Record<string, string> = {};
  for (const [k, v] of Object.entries(editing?.config ?? {})) {
    if (typeof v === "string") config[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") config[k] = String(v);
  }
  // target + secret stay blank in edit mode — the list only exposes a masked
  // target and never the secret.
  return {
    kind: editing?.kind ?? "slack",
    name: editing?.name ?? "",
    target: "",
    secret: "",
    config,
  };
}

export function ChannelDialog({
  open,
  onOpenChange,
  editing,
  submitting,
  onSubmit,
}: ChannelDialogProps) {
  const isEdit = editing !== null;

  const form = useForm({
    defaultValues: editingDefaults(editing),
    validators: {
      // The kind-adaptive inputs (target/secret/host/port) live in
      // ChannelFields, not as registered form.Fields, so we can't lean on
      // per-field distribution. Stash the whole error map on the form-level
      // error and read it back via errorMap.onSubmit.
      onSubmit: ({ value }) => {
        const found = validateChannel(value, isEdit);
        return Object.keys(found).length === 0 ? undefined : found;
      },
    },
    onSubmit: ({ value }) => onSubmit(value),
  });

  // Re-seed the form when the dialog opens (edit hydrates name/kind/config;
  // create resets to slack). No useEffect — reset runs in the open handler.
  const handleOpenChange = (next: boolean) => {
    if (next) form.reset(editingDefaults(editing));
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit notification channel" : "Add notification channel"}
          </DialogTitle>
          <DialogDescription>
            {isEdit ? (
              <>Leave the destination or secret blank to keep the stored value.</>
            ) : (
              <>
                Otterdeploy delivers a synthetic{" "}
                <span className="font-mono text-foreground">test.ping</span> event from the channel
                card so you can confirm the wiring before subscribing it to real events.
              </>
            )}
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
          <form.Subscribe
            selector={(s) => ({
              values: s.values,
              error: s.errorMap.onSubmit,
            })}
          >
            {({ values, error }) => {
              const errors = (error && typeof error === "object" ? error : {}) as Record<
                string,
                string
              >;
              return (
                <>
                  <KindPicker
                    value={values.kind}
                    isEdit={isEdit}
                    onChange={(k) => form.setFieldValue("kind", k)}
                  />
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="channel-name">Display name</Label>
                    <Input
                      id="channel-name"
                      aria-invalid={Boolean(errors.name)}
                      placeholder={PLACEHOLDERS[values.kind].name}
                      value={values.name}
                      onChange={(e) => form.setFieldValue("name", e.target.value)}
                    />
                    {errors.name && <p className="text-[11px] text-destructive">{errors.name}</p>}
                  </div>
                  <ChannelFields
                    kind={values.kind}
                    target={values.target}
                    setTarget={(v) => form.setFieldValue("target", v)}
                    secret={values.secret}
                    setSecret={(v) => form.setFieldValue("secret", v)}
                    config={values.config}
                    setConfigField={(key, value) =>
                      form.setFieldValue("config", (c) => ({
                        ...c,
                        [key]: value,
                      }))
                    }
                    errors={errors}
                  />
                </>
              );
            }}
          </form.Subscribe>

          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {isEdit ? "Save changes" : "Save channel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Kind pill picker — locked in edit mode (a channel can't change type). */
function KindPicker({
  value,
  isEdit,
  onChange,
}: {
  value: ChannelKind;
  isEdit: boolean;
  onChange: (k: ChannelKind) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-[11px] text-muted-foreground">Channel type</Label>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(KIND_META) as ChannelKind[]).map((k) => {
          const active = value === k;
          return (
            <button
              key={k}
              type="button"
              disabled={isEdit}
              onClick={() => onChange(k)}
              className={cn(
                "flex items-center gap-2 rounded-md border px-2.5 py-2 text-[12px] transition-colors",
                active ? "border-foreground bg-muted" : "border-border hover:bg-muted/50",
                isEdit && "cursor-not-allowed opacity-60",
              )}
            >
              <SvglLogo search={KIND_META[k].search} fallback={KIND_META[k].label} size={20} />
              <span>{KIND_META[k].label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const URL_RE = /^https?:\/\/.+/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Client-side validation. In edit mode `target`/`secret` may be left blank to
 * keep the stored value, so they're only format-checked when provided; in
 * create mode the required ones must be present.
 */
/** Format-check a non-empty destination for the kinds that constrain it. */
function targetFormatError(kind: ChannelKind, target: string): string | null {
  if (kind === "slack" || kind === "discord" || kind === "webhook")
    return URL_RE.test(target) ? null : "Enter a valid URL (https://…)";
  if (kind === "email") return EMAIL_RE.test(target) ? null : "Enter a valid email address";
  return null;
}

/** SMTP host/port checks — only relevant for the email + SMTP combo. */
function smtpErrors(config: Record<string, string>, isEdit: boolean): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!isEdit && !(config.host ?? "").trim()) errs.host = "SMTP host is required";
  const port = (config.port ?? "").trim();
  if (port && !/^\d+$/.test(port)) errs.port = "Port must be a number";
  return errs;
}

function validateChannel(v: ChannelFormValues, isEdit: boolean): Record<string, string> {
  const errs: Record<string, string> = {};
  const target = v.target.trim();

  if (!v.name.trim()) errs.name = "Display name is required";

  if (!isEdit && !target) {
    errs.target = "Required";
  } else if (target) {
    const targetErr = targetFormatError(v.kind, target);
    if (targetErr) errs.target = targetErr;
  }

  if (v.kind === "email" && v.config.client === "smtp")
    Object.assign(errs, smtpErrors(v.config, isEdit));

  // Telegram needs its bot token to deliver; required on create.
  if (v.kind === "telegram" && !isEdit && !v.secret.trim()) errs.secret = "Bot token is required";

  return errs;
}
