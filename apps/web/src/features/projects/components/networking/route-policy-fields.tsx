/**
 * Every editable field of the typed route policy, in one grid. Split out of
 * route-directives-dialog so that file stays a dialog + save shell: the field
 * list grows every time the control plane learns a new safe directive, and it
 * has no state of its own beyond the draft.
 */

import type { RoutePolicy } from "@otterdeploy/shared/route-policy";

import { useId } from "react";

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

export function RoutePolicyFields({
  draft,
  update,
}: {
  draft: RoutePolicy;
  update: <K extends keyof RoutePolicy>(key: K, value: RoutePolicy[K]) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {/* First, and deliberately: it is the only field here that decides
          whether the upstream is reachable AT ALL rather than how its
          responses are dressed. A gRPC backend behind the HTTP/1.1 default is
          simply unreachable, with nothing in the edge logs to say why. */}
      <SelectField
        label="Upstream protocol"
        value={draft.upstreamProtocol}
        options={[
          { value: "http", label: "HTTP/1.1 (default)" },
          { value: "h2c", label: "HTTP/2 cleartext (gRPC)" },
        ]}
        onChange={(value) => update("upstreamProtocol", value)}
      />
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
