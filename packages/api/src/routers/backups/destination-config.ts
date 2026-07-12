/**
 * Structural validation for backup-destination config, shared by create/update
 * and the credential test. Passing this doesn't guarantee a working
 * destination (bad creds or an unwritable path still fail at runtime) — it
 * guarantees the engine has the fields it needs to ATTEMPT an upload, so a
 * half-filled form can't save a destination that only fails after a full
 * dump/encrypt/stage cycle.
 */

export type DestinationType = "s3" | "local" | "sftp";

/** Required non-secret config keys per destination type. */
export const REQUIRED_CONFIG: Record<DestinationType, string[]> = {
  s3: ["bucket"],
  local: ["path"],
  sftp: ["host"],
};

/** Required config keys that are absent or blank. */
export function missingConfigKeys(
  type: DestinationType,
  config: Record<string, unknown> | null | undefined,
): string[] {
  return REQUIRED_CONFIG[type].filter((k) => {
    const v = config?.[k];
    return v == null || (typeof v === "string" && v.trim() === "");
  });
}

/** True when a non-local destination carries no usable credential value. */
export function missingSecret(
  type: DestinationType,
  secret: Record<string, string> | undefined,
): boolean {
  if (type === "local") return false;
  return !Object.values(secret ?? {}).some((v) => v.trim() !== "");
}
