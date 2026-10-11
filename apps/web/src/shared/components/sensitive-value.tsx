/**
 * One control for every value that should not sit on screen in clear text: a
 * server address, a URL whose path is a credential, a connection string, a
 * join command, a signing secret.
 *
 *   - Masked by default, with a fixed-length mask, so the mask never gives
 *     away how long the value is.
 *   - Reveal on click; copy without revealing.
 *   - Masked again when it unmounts (any route or tab change), when the value
 *     it shows changes, and when the browser tab is hidden.
 *   - `prefix` and `suffix` stay readable (`root@` … `:22`), and `secret`
 *     masks just the part of a longer value that matters (the password in a
 *     connection string, the key in a command), so a masked row still says
 *     what it is.
 *   - The actions sit in a fixed slot, so revealing never moves the row.
 *
 * The value is either already on the page (`value`) or fetched on the first
 * reveal or copy (`fetchValue`, for an RBAC-gated reveal procedure), then kept
 * for the component's lifetime. `restricted` is for a value that exists but
 * that this viewer is not sent at all: the mask, and why, with nothing to
 * reveal.
 *
 * Masking hides a value from the screen. It does not protect a value from
 * whoever already received it: anything only some roles may see is withheld
 * by the server.
 */
import { useState } from "react";

import { Copy01Icon, Tick02Icon, ViewIcon, ViewOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Result } from "better-result";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { useRevealState } from "@/shared/hooks/use-reveal-state";
import { copyToClipboard } from "@/shared/lib/clipboard";
import { cn } from "@/shared/lib/utils";

const MASK = "••••••••••";

type Density = "field" | "inline" | "block";

interface SensitiveValueProps {
  /** For the reveal / copy labels and error messages ("server IP"). */
  label: string;
  /** The value, when it is already on the page. */
  value?: string;
  /** Fetches the value on the first reveal or copy. */
  fetchValue?: () => Promise<string>;
  /** The value exists but this viewer may not see it: why, as a tooltip. */
  restricted?: string;
  /** Mask only this part of `value`. Absent from `value`, everything is masked. */
  secret?: string;
  /** Always readable, before and after the masked part; copied with it. */
  prefix?: string;
  suffix?: string;
  /** `field`: a boxed field. `inline`: a cell in a key/value list. `block`: a
   *  multi-line command. */
  density?: Density;
  className?: string;
}

/** The readable text around each mask while masked: `["", ""]` is one mask
 *  and nothing else; a secret inside a longer value keeps the rest. */
function maskedParts(value: string | undefined, secret: string | undefined): string[] {
  if (value !== undefined && secret && value.includes(secret)) return value.split(secret);
  return ["", ""];
}

function useCopied() {
  const [copied, setCopied] = useState(false);
  const flash = () => {
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return { copied, flash };
}

const ACTIONS: Record<Density, string> = {
  field: "flex shrink-0 items-center gap-1",
  // -my-1: the buttons must not make a key/value row taller than its neighbours.
  inline: "-my-1 ml-1.5 inline-flex w-[3.25rem] shrink-0 items-center justify-end gap-0.5",
  block: "absolute top-2 right-2 flex items-center gap-1",
};

const ICON_BUTTON: Record<Density, string> = {
  field: "size-6",
  inline: "size-6 text-muted-foreground hover:text-foreground",
  block: "size-7 bg-background",
};

function MaskedValue({
  density,
  shown,
  label,
  prefix,
  suffix,
}: {
  density: Density;
  /** The value when revealed; the text around each mask when not. */
  shown: string | string[];
  label: string;
  prefix: string;
  suffix: string;
}) {
  const open = typeof shown === "string";
  const text = (
    <>
      {prefix}
      {open
        ? shown
        : shown.map((part, i) => (
            // oxlint-disable-next-line react/no-array-index-key -- the parts are positional by construction (split on one secret) and never reorder.
            <span key={i}>
              {part}
              {i < shown.length - 1 ? (
                <span aria-hidden className="tracking-[0.08em] text-muted-foreground">
                  {MASK}
                </span>
              ) : null}
            </span>
          ))}
      {suffix}
      {open ? null : <span className="sr-only">({label} hidden)</span>}
    </>
  );
  if (density === "block") {
    return <code className="block break-words whitespace-pre-wrap">{text}</code>;
  }
  return (
    <span className={cn("min-w-0 truncate font-mono", density === "field" && "flex-1 text-[11px]")}>
      {text}
    </span>
  );
}

const FRAME: Record<Density, string> = {
  field: "flex items-center gap-1 rounded-md border bg-muted/40 py-1 pr-1 pl-2",
  inline: "inline-flex max-w-full min-w-0 items-center justify-end align-bottom",
  block:
    "relative rounded-md border bg-muted/50 p-3 pr-20 font-mono text-[12px] leading-relaxed text-foreground/90",
};

/** The value as the page has it, or as fetched on the first reveal or copy. */
function useSource(label: string, value?: string, fetchValue?: () => Promise<string>) {
  const [fetched, setFetched] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const plain = value ?? fetched;

  const ensure = async (): Promise<string | null> => {
    if (plain !== null) return plain;
    if (!fetchValue) return null;
    setBusy(true);
    const result = await Result.tryPromise({
      try: fetchValue,
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    });
    setBusy(false);
    if (result.isErr()) {
      toast.error(result.error.message || `Couldn't reveal the ${label}`);
      return null;
    }
    setFetched(result.value);
    return result.value;
  };

  return { plain, busy, ensure };
}

function Actions({
  density,
  label,
  open,
  copied,
  busy,
  onToggle,
  onCopy,
}: {
  density: Density;
  label: string;
  open: boolean;
  copied: boolean;
  busy: boolean;
  onToggle: () => void;
  onCopy: () => void;
}) {
  const variant = density === "block" ? "outline" : "ghost";
  return (
    <span className={ACTIONS[density]}>
      <Button
        type="button"
        size="icon"
        variant={variant}
        className={ICON_BUTTON[density]}
        disabled={busy}
        aria-pressed={open}
        aria-label={open ? `Hide ${label}` : `Reveal ${label}`}
        title={open ? "Hide" : "Reveal"}
        onClick={onToggle}
      >
        <HugeiconsIcon icon={open ? ViewOffIcon : ViewIcon} strokeWidth={2} className="size-3.5" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant={variant}
        className={cn(ICON_BUTTON[density], copied && "text-success")}
        disabled={busy}
        aria-label={copied ? "Copied" : `Copy ${label}`}
        title="Copy without revealing"
        onClick={onCopy}
      >
        <HugeiconsIcon
          icon={copied ? Tick02Icon : Copy01Icon}
          strokeWidth={2}
          className="size-3.5"
        />
      </Button>
    </span>
  );
}

function RevealableValue({
  label,
  value,
  fetchValue,
  secret,
  prefix,
  suffix,
  density,
  className,
}: Omit<SensitiveValueProps, "restricted"> & { prefix: string; suffix: string; density: Density }) {
  // The value it was revealed for: a different value is masked again.
  const [openFor, setOpenFor] = useRevealState<string | null>(null);
  const { copied, flash } = useCopied();
  const { plain, busy, ensure } = useSource(label, value, fetchValue);
  const open = plain !== null && openFor === plain;

  const toggle = async () => {
    if (open) {
      setOpenFor(null);
      return;
    }
    const next = await ensure();
    if (next !== null) setOpenFor(next);
  };

  const copy = async () => {
    const next = await ensure();
    if (next === null) return;
    if (!(await copyToClipboard(`${prefix}${next}${suffix}`))) {
      toast.error(`Couldn't copy the ${label}`);
      return;
    }
    flash();
  };

  return (
    <div className={cn(FRAME[density], className)}>
      <MaskedValue
        density={density}
        shown={open ? plain : maskedParts(value, secret)}
        label={label}
        prefix={prefix}
        suffix={suffix}
      />
      <Actions
        density={density}
        label={label}
        open={open}
        copied={copied}
        busy={busy}
        onToggle={() => void toggle()}
        onCopy={() => void copy()}
      />
    </div>
  );
}

export function SensitiveValue({
  restricted,
  prefix = "",
  suffix = "",
  density = "field",
  ...props
}: SensitiveValueProps) {
  if (restricted === undefined) {
    return <RevealableValue {...props} prefix={prefix} suffix={suffix} density={density} />;
  }
  return (
    <span className={cn(FRAME[density], props.className)} title={restricted}>
      <MaskedValue
        density={density}
        shown={["", ""]}
        label={props.label}
        prefix={prefix}
        suffix={suffix}
      />
      <span className="sr-only">{restricted}</span>
    </span>
  );
}
