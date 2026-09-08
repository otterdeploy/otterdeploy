/**
 * Copying, where copying is what the reader came to do.
 *
 * A row detail sheet is mostly read so that something in it can be pasted
 * somewhere else — an id into a search, a request id into a support thread, an
 * IP into a firewall rule. Selecting text out of a truncating cell is fiddly
 * and gets the whitespace wrong, so the value carries its own button.
 *
 * Feedback is gated on the write actually succeeding: `navigator.clipboard`
 * does not exist over plain http, which a self-hosted dashboard often is, and
 * a "Copied" flash that lied is worse than no button. See lib/clipboard.ts.
 */

import { useState } from "react";

import { CheckmarkCircle02Icon, Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { copyToClipboard } from "@/shared/lib/clipboard";
import { cn } from "@/shared/lib/utils";

/** Long enough to be read as confirmation, short enough not to be state. */
const CONFIRM_MS = 1_200;

export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  /** Names what is being copied, for the screen reader and the tooltip. */
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const ok = await copyToClipboard(value);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), CONFIRM_MS);
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={`Copy ${label}`}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors",
        "hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        className,
      )}
    >
      <HugeiconsIcon
        icon={copied ? CheckmarkCircle02Icon : Copy01Icon}
        strokeWidth={2}
        className={cn("size-3", copied && "text-info")}
      />
    </button>
  );
}

/**
 * A value's text form, for the clipboard.
 *
 * `null` for anything with no useful text — an object, a nullish cell — so the
 * caller can leave the button out rather than offer "[object Object]".
 */
export function copyableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value === "" ? null : value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const parts = value.map((member) => copyableText(member)).filter((part) => part !== null);
    return parts.length === 0 ? null : parts.join(", ");
  }
  return null;
}
