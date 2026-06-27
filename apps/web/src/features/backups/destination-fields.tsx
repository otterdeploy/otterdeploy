/**
 * Per-type field definitions for a backup destination plus the type-specific
 * config/secret inputs, factored out of the editor dialog so each stays within
 * the line budget.
 */
import { SquareLock01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Input } from "@/shared/components/ui/input";

import type { Destination } from "./data/destinations";

import { Field, type DestinationKind } from "./shared";

export const DEST_TYPE_FIELDS: Record<
  DestinationKind,
  {
    /** `half` fields pair up two-per-row; the rest span the full width. */
    config: { key: string; label: string; placeholder?: string; half?: boolean }[];
    secret: { key: string; label: string }[];
  }
> = {
  s3: {
    config: [
      { key: "bucket", label: "Bucket", half: true },
      { key: "region", label: "Region", placeholder: "us-east-1", half: true },
      {
        key: "endpoint",
        label: "Endpoint (optional)",
        placeholder: "https://s3.example.com",
      },
      { key: "prefix", label: "Prefix (optional)", placeholder: "backups/" },
    ],
    secret: [
      { key: "accessKeyId", label: "Access key ID" },
      { key: "secretAccessKey", label: "Secret access key" },
    ],
  },
  local: {
    config: [{ key: "path", label: "Path", placeholder: "/var/backups/otterdeploy" }],
    secret: [],
  },
  sftp: {
    config: [
      { key: "host", label: "Host", half: true },
      { key: "port", label: "Port", placeholder: "22", half: true },
      { key: "username", label: "Username" },
      { key: "path", label: "Remote path", placeholder: "/backups" },
    ],
    secret: [{ key: "password", label: "Password" }],
  },
};

/** Seed the editable config record from an existing destination (or blanks). */
export function configFromInitial(initial: Destination | null): Record<string, string> {
  const out: Record<string, string> = {};
  const cfg = (initial?.config ?? {}) as Record<string, unknown>;
  for (const f of DEST_TYPE_FIELDS[initial?.type ?? "s3"].config) {
    const v = cfg[f.key];
    out[f.key] = typeof v === "string" || typeof v === "number" ? String(v) : "";
  }
  return out;
}

export function DestinationTypeFields({
  type,
  config,
  onConfig,
  secret,
  onSecret,
  editing,
}: {
  type: DestinationKind;
  config: Record<string, string>;
  onConfig: (next: Record<string, string>) => void;
  secret: Record<string, string>;
  onSecret: (next: Record<string, string>) => void;
  editing: boolean;
}) {
  const fields = DEST_TYPE_FIELDS[type];
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        {fields.config.map((f) => (
          <Field key={f.key} label={f.label} className={f.half ? undefined : "col-span-2"}>
            <Input
              value={config[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => onConfig({ ...config, [f.key]: e.target.value })}
            />
          </Field>
        ))}
      </div>
      {fields.secret.length > 0 && (
        <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <HugeiconsIcon icon={SquareLock01Icon} className="size-3.5" />
            {editing
              ? "Leave blank to keep the stored credential"
              : "Encrypted at rest (AES-256 GCM)"}
          </div>
          {fields.secret.map((f) => (
            <Field key={f.key} label={f.label}>
              <Input
                type="password"
                value={secret[f.key] ?? ""}
                onChange={(e) => onSecret({ ...secret, [f.key]: e.target.value })}
              />
            </Field>
          ))}
        </div>
      )}
    </>
  );
}
