import type { RoutePolicy } from "@otterdeploy/shared/route-policy";

import { useId, useState } from "react";

import { Settings02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { idSchema } from "@otterdeploy/shared/id";
import { toast } from "sonner";

import {
  proxyRoutesCollection,
  RoutePolicyRejectedError,
} from "@/features/projects/data/proxy-routes";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Switch } from "@/shared/components/ui/switch";
import { Textarea } from "@/shared/components/ui/textarea";

const copyPolicy = (policy: RoutePolicy): RoutePolicy => ({ ...policy });

/**
 * One policy dropdown.
 *
 * Uses the app's Select rather than a bare `<select>`: the native control paints
 * its popup from the OS, so it ignored the theme entirely: a light system menu
 * over the dark dialog, with the platform's own chevron next to our tokens. The
 * options here are also long enough ("Strict origin when cross-origin") to need
 * the popup width our Select gives them.
 */
function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {/* `items` is what lets the trigger show the option's label instead of
          its wire value: "Same origin", not "same-origin". */}
      <Select
        value={value}
        onValueChange={(next) => {
          // The wire value can only be one of the rendered options; look it up
          // so the narrow value comes from `options` rather than a cast.
          const picked = options.find((option) => option.value === next);
          if (picked) onChange(picked.value);
        }}
        items={options}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Every editable field of the route policy, in one grid. Split out of
 *  RoutePolicyButton so that component stays a dialog + save shell instead of
 *  a 160-line form: the field list grows every time the control plane learns a
 *  new safe directive, and it has no state of its own beyond the draft. */
function RoutePolicyFields({
  draft,
  update,
}: {
  draft: RoutePolicy;
  update: <K extends keyof RoutePolicy>(key: K, value: RoutePolicy[K]) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField
        label="Compression"
        value={draft.compression}
        options={[
          { value: "off", label: "Off" },
          { value: "gzip", label: "Gzip" },
          { value: "zstd", label: "Zstandard" },
          { value: "gzip-zstd", label: "Zstandard + gzip" },
        ]}
        onChange={(value) => update("compression", value)}
      />
      <div className="grid gap-1.5">
        <Label htmlFor="route-body-limit">Request body limit (MiB)</Label>
        <Input
          id="route-body-limit"
          type="number"
          min={1}
          max={100}
          placeholder="No additional limit"
          value={draft.maxRequestBodyMb ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            update("maxRequestBodyMb", value === "" ? null : Number(value));
          }}
        />
      </div>
      <SelectField
        label="HSTS"
        value={draft.hsts}
        options={[
          { value: "off", label: "Off" },
          { value: "one-year", label: "One year" },
          { value: "one-year-subdomains", label: "One year + subdomains" },
          { value: "preload", label: "Preload eligible" },
        ]}
        onChange={(value) => update("hsts", value)}
      />
      <SelectField
        label="Frame policy"
        value={draft.frameOptions}
        options={[
          { value: "off", label: "Off" },
          { value: "deny", label: "Deny" },
          { value: "sameorigin", label: "Same origin" },
        ]}
        onChange={(value) => update("frameOptions", value)}
      />
      <SelectField
        label="Referrer policy"
        value={draft.referrerPolicy}
        options={[
          { value: "off", label: "Off" },
          { value: "no-referrer", label: "No referrer" },
          { value: "same-origin", label: "Same origin" },
          { value: "strict-origin", label: "Strict origin" },
          {
            value: "strict-origin-when-cross-origin",
            label: "Strict origin when cross-origin",
          },
        ]}
        onChange={(value) => update("referrerPolicy", value)}
      />
      <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
        <div>
          <Label htmlFor="route-nosniff">Content type nosniff</Label>
          <p className="text-xs text-muted-foreground">Emit X-Content-Type-Options.</p>
        </div>
        <Switch
          id="route-nosniff"
          checked={draft.contentTypeNosniff}
          onCheckedChange={(checked) => update("contentTypeNosniff", checked)}
        />
      </div>
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor="route-csp">Content-Security-Policy</Label>
        <Textarea
          id="route-csp"
          value={draft.contentSecurityPolicy ?? ""}
          maxLength={4_096}
          placeholder="Leave empty to omit the header"
          className="min-h-20 font-mono text-xs"
          onChange={(event) => update("contentSecurityPolicy", event.target.value.trim() || null)}
        />
      </div>
    </div>
  );
}

export function RoutePolicyButton({
  routeId,
  domain,
  routePolicy,
}: {
  routeId: string;
  domain: string;
  routePolicy: RoutePolicy;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(() => copyPolicy(routePolicy));

  const update = <K extends keyof RoutePolicy>(key: K, value: RoutePolicy[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    // The row model widens ids to string; re-brand at the mutation boundary.
    const tx = proxyRoutesCollection.update(idSchema.proxyRoute.parse(routeId), (row) => {
      row.routePolicy = draft;
    });
    try {
      await tx.isPersisted.promise;
      toast.success("Route policy applied");
      setOpen(false);
    } catch (error) {
      toast.error(
        error instanceof RoutePolicyRejectedError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Failed to save route policy",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft(copyPolicy(routePolicy));
      }}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Edit safe route policy"
        title="Route policy"
        onClick={() => setOpen(true)}
      >
        <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} className="size-3.5" />
      </Button>

      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Route policy</DialogTitle>
          <DialogDescription>
            Safe edge behavior for <span className="font-mono">{domain}</span>. The control plane
            generates the Caddy configuration; raw directives and upstream overrides are not
            accepted.
          </DialogDescription>
        </DialogHeader>

        <RoutePolicyFields draft={draft} update={update} />

        <DialogFooter>
          <Button variant="outline" size="sm" disabled={saving} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            {saving ? "Applying…" : "Save & apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
