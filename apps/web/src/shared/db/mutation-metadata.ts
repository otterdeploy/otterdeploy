/**
 * Cast-free readers for TanStack DB mutation metadata.
 *
 * `PendingMutation.metadata` is `unknown` by design — it's whatever the
 * mutating component attached. The house rule is no `as` casts, so instead of
 * every onInsert/onUpdate asserting its expected shape, these narrow with
 * runtime checks: wrong or missing metadata degrades to `undefined`, which is
 * also the honest answer — the caller attached nothing usable.
 */

function field(meta: unknown, key: string): unknown {
  if (typeof meta !== "object" || meta === null) return undefined;
  for (const [k, v] of Object.entries(meta)) {
    if (k === key) return v;
  }
  return undefined;
}

/** The write-only secret a form attached for the server call (registry
 *  passwords, webhook signing secrets) — never part of the collection row. */
export function metadataSecret(meta: unknown): string | undefined {
  const value = field(meta, "secret");
  return typeof value === "string" ? value : undefined;
}

/** Same slot when the form attaches a MAP of write-only credentials
 *  (backup destination config: accessKey/secretKey/…). Any non-string
 *  value voids the whole record — a partially-typed shape is a caller
 *  bug, not something to forward to the server. */
export function metadataSecretRecord(meta: unknown): Record<string, string> | undefined {
  const raw = field(meta, "secret");
  if (typeof raw !== "object" || raw === null) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string") return undefined;
    out[key] = value;
  }
  return out;
}

/** One-shot callback for a server-generated credential the UI must show
 *  exactly once (api key plaintext). */
export function metadataOnKey(meta: unknown): ((key: string) => void) | undefined {
  const value = field(meta, "onKey");
  if (typeof value !== "function") return undefined;
  return (key: string) => {
    value(key);
  };
}
