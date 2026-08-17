/**
 * Presentational field components for the inbound-endpoint dialog. Split out
 * of inbound-dialog.tsx so the dialog file stays within the size budget;
 * state lives in the dialog's form, these only render it.
 */

import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";

/** Endpoint name input. */
export function NameField({
  label,
  value,
  onBlur,
  onChange,
}: {
  label: string;
  value: string;
  onBlur: () => void;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="inbound-name">{label}</Label>
      <Input
        id="inbound-name"
        className="font-mono"
        placeholder="github-push-api"
        value={value}
        onBlur={onBlur}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Raw IP-allowlist textarea, parsed into entries on submit. */
export function AllowlistField({
  value,
  onBlur,
  onChange,
}: {
  value: string;
  onBlur: () => void;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="inbound-allowlist">
        IP allowlist{" "}
        <span className="font-normal text-muted-foreground">
          (one per line, IPv4 CIDR ok; empty allows any)
        </span>
      </Label>
      <Textarea
        id="inbound-allowlist"
        className="min-h-16 font-mono text-[12px]"
        placeholder={"140.82.112.0/20\n192.30.252.0/22"}
        value={value}
        onBlur={onBlur}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
