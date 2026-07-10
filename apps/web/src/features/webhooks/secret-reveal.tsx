/**
 * Masked secret field with eye-reveal + copy. The plaintext is never on the
 * row (the list procedures don't return it) — the first reveal/copy lazily
 * calls the passed `fetchSecret` (an RBAC-gated `reveal` procedure) and
 * caches the result for the component's lifetime.
 */
import { useState } from "react";

import { Copy01Icon, Tick02Icon, ViewIcon, ViewOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { copyToClipboard } from "@/shared/lib/clipboard";

const MASK = "••••••••••••••••••••••••••••";

export function SecretReveal({
  fetchSecret,
  label = "secret",
}: {
  fetchSecret: () => Promise<string>;
  /** For aria-labels + error copy ("HMAC secret", …). */
  label?: string;
}) {
  const [secret, setSecret] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const ensureSecret = async (): Promise<string | null> => {
    if (secret) return secret;
    setBusy(true);
    try {
      const value = await fetchSecret();
      setSecret(value);
      return value;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Couldn't reveal ${label}`);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    if (revealed) {
      setRevealed(false);
      return;
    }
    if (await ensureSecret()) setRevealed(true);
  };

  const copy = async () => {
    const value = await ensureSecret();
    if (!value) return;
    const ok = await copyToClipboard(value);
    if (!ok) {
      toast.error(`Couldn't copy ${label}`);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-center gap-1 rounded-md border bg-muted/40 py-1 pr-1 pl-2">
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
        {revealed && secret ? secret : MASK}
      </span>
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        disabled={busy}
        onClick={() => void toggle()}
        aria-label={revealed ? `Hide ${label}` : `Reveal ${label}`}
      >
        <HugeiconsIcon
          icon={revealed ? ViewOffIcon : ViewIcon}
          strokeWidth={2}
          className="size-3.5"
        />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        disabled={busy}
        onClick={() => void copy()}
        aria-label={`Copy ${label}`}
      >
        <HugeiconsIcon
          icon={copied ? Tick02Icon : Copy01Icon}
          strokeWidth={2}
          className="size-3.5"
        />
      </Button>
    </div>
  );
}
