/**
 * The "Add Custom Domain" panel of {@link ServiceNetworkingCard}.
 *
 * Three decisions in one place — the hostname, the container port it routes
 * to, and whether the name is actually free — so the operator learns about a
 * clash while typing rather than from a 409 after committing. The check is
 * advisory: `service.domains.add` re-validates and still owns the answer.
 */

import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { useEffect, useState } from "react";

import { Alert01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Spinner } from "@/shared/components/ui/spinner";
import { orpc } from "@/shared/server/orpc";

import type { PortChoice } from "./domain-row-parts";

import { PortPicker } from "./domain-row-parts";

/** Long enough that a name isn't checked on every keystroke, short enough
 *  that the verdict lands before the operator reaches for the button. */
const CHECK_DEBOUNCE_MS = 400;

const REASON_COPY: Record<"invalid" | "reserved" | "taken", string> = {
  invalid: "Not a valid hostname",
  reserved: "Reserved by this install",
  taken: "Already in use",
};

export function DomainAddForm({
  input,
  ports,
  adding,
  onSubmit,
  onCancel,
}: {
  input: { projectId: ProjectId; resourceId: ResourceId };
  ports: PortChoice[];
  adding: boolean;
  onSubmit: (value: { domain: string; port: number | undefined }) => void;
  onCancel: () => void;
}) {
  const [domain, setDomain] = useState("");
  const [port, setPort] = useState<number | undefined>(
    () => (ports.find((p) => p.isPrimary) ?? ports[0])?.containerPort,
  );
  const [debounced, setDebounced] = useState("");

  const trimmed = domain.trim().toLowerCase();
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(trimmed), CHECK_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [trimmed]);

  // Only ask once the name could plausibly be one — a lone "a" is not worth a
  // round trip, and "Not a valid hostname" while you're still typing the TLD
  // reads as an error you caused.
  const worthChecking = debounced.length > 3 && debounced.includes(".");
  const check = useQuery({
    ...orpc.service.domains.check.queryOptions({ input: { ...input, domain: debounced } }),
    enabled: worthChecking,
    staleTime: 10_000,
  });

  // A verdict for an older keystroke is worse than none — it can say
  // "Available" about a name that is no longer in the field.
  const settled = worthChecking && check.data?.domain === trimmed ? check.data : undefined;
  const checking = worthChecking && (check.isFetching || (!settled && !check.isError));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!trimmed || adding) return;
        onSubmit({ domain: trimmed, port });
      }}
      noValidate
      className="flex flex-col gap-2.5 border-t border-border/40 bg-muted/20 px-3 py-3"
    >
      <div className="text-[12px] font-medium">Add a custom domain</div>

      <Input
        autoFocus
        value={domain}
        onChange={(e) => setDomain(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        placeholder="app.example.com"
        aria-label="Domain"
        className="h-8 font-mono text-[12.5px]"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
      />

      {ports.length > 0 && (
        <PortPicker value={port} ports={ports} onChange={setPort} disabled={adding} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Availability checking={checking} verdict={settled} />
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="ghost" className="h-7" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            className="h-7"
            // A failed check doesn't block: the server is the authority, and
            // refusing to submit on a network hiccup would be a dead end.
            disabled={adding || trimmed.length === 0 || settled?.available === false}
          >
            {adding ? <Spinner className="size-3.5" /> : "Add domain"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function Availability({
  checking,
  verdict,
}: {
  checking: boolean;
  verdict: { available: boolean; reason: "ok" | "invalid" | "reserved" | "taken" } | undefined;
}) {
  if (checking) {
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <Spinner className="size-3" /> Checking…
      </span>
    );
  }
  if (!verdict) return <span />;
  if (verdict.available) {
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-primary">
        <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="size-3.5" />
        Available
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-destructive">
      <HugeiconsIcon icon={Alert01Icon} strokeWidth={2} className="size-3.5" />
      {verdict.reason === "ok" ? "Unavailable" : REASON_COPY[verdict.reason]}
    </span>
  );
}
