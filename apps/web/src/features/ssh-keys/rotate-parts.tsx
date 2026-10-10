/**
 * The words and per-server marks of the rotate dialog, for each moment of a
 * rotation: before (what will happen, and a warning for a server that's down),
 * while it runs, and after (what happened on each server, and why a server
 * that failed did).
 */

import { Alert02Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { RotateServerResult } from "./data/ssh-keys";
import type { KeyServer } from "./data/use-key-servers";

import { isUnreachable } from "./data/key-copy";
import { listNames, plural } from "./data/ssh-keys";

export type Outcome =
  | { kind: "rotated"; fingerprint: string; results: RotateServerResult[] }
  | { kind: "failed"; results: RotateServerResult[] };

const strong = (text: string) => <strong className="font-medium text-foreground">{text}</strong>;

function FailedCopy({ results }: { results: RotateServerResult[] }) {
  const failed = results.filter((r) => r.outcome === "failed").map((r) => r.name);
  return (
    <p>
      {strong(listNames(failed))} couldn't take the new key, so nothing changed: the stored key is
      the same and every server still accepts it.
    </p>
  );
}

function RotatedCopy({ results }: { results: RotateServerResult[] }) {
  if (results.length === 0) return <p>New keypair in place.</p>;
  const kept = results.filter((r) => r.outcome === "old_key_kept").map((r) => r.name);
  const gone = results.length === 1 ? "it" : "all of them";
  return (
    <p>
      Re-authorized on {plural(results.length, "server")}.{" "}
      {kept.length === 0
        ? `The old key is gone from ${gone}.`
        : `Removing the old key failed on ${listNames(kept)}: it no longer signs otterdeploy in there, but it's still in authorized_keys, so remove it by hand.`}
    </p>
  );
}

function BeforeCopy({ servers }: { servers: KeyServer[] }) {
  if (servers.length === 0) {
    return (
      <p>
        No server uses this key, so nothing in otterdeploy is affected. A new keypair replaces this
        one; if you pasted the old public key somewhere by hand, it stops working there.
      </p>
    );
  }
  const one = servers.length === 1;
  const down = servers.filter(isUnreachable).map((s) => s.name);
  return (
    <div className="flex flex-col gap-2">
      <p>
        otterdeploy reaches {strong(one ? (servers[0]?.name ?? "") : `${servers.length} servers`)}{" "}
        with this key. Rotating makes a new keypair and swaps it on {one ? "it" : "each one"}: sign
        in with the current key, add the new public key, check it works, then remove the old one.
      </p>
      {down.length > 0 ? (
        <p className="flex items-start gap-1.5 text-warning">
          <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {listNames(down)} {down.length === 1 ? "is" : "are"} down. Unless{" "}
            {down.length === 1 ? "it answers" : "they answer"}, the rotation stops there and changes
            nothing.
          </span>
        </p>
      ) : null}
    </div>
  );
}

export function RotateCopy({
  servers,
  outcome,
}: {
  servers: KeyServer[];
  outcome: Outcome | null;
}) {
  if (outcome?.kind === "failed") return <FailedCopy results={outcome.results} />;
  if (outcome?.kind === "rotated") return <RotatedCopy results={outcome.results} />;
  return <BeforeCopy servers={servers} />;
}

/** The reason behind every server that reported one, under the list. */
export function RotateErrors({ outcome }: { outcome: Outcome | null }) {
  const withError = outcome?.results.filter((r) => r.error) ?? [];
  if (withError.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
      {withError.map((r) => (
        <li key={r.serverId} className="[overflow-wrap:anywhere]">
          <span className="font-mono text-foreground">{r.name}</span>: {r.error}
        </li>
      ))}
    </ul>
  );
}

/** Below the list: the safety promise before, the new fingerprint after. */
export function RotateFootnote({
  servers,
  outcome,
}: {
  servers: KeyServer[];
  outcome: Outcome | null;
}) {
  if (outcome?.kind === "rotated") {
    return (
      <div className="flex min-w-0 items-baseline gap-2.5 text-xs">
        <span className="shrink-0 text-muted-foreground">New fingerprint</span>
        <code className="font-mono text-[11.5px] [overflow-wrap:anywhere]">
          {outcome.fingerprint}
        </code>
      </div>
    );
  }
  if (outcome === null && servers.length > 0) {
    return (
      <p className="text-sm text-muted-foreground">
        If a server can't take the new key, nothing changes: every server keeps the current key and
        stays reachable.
      </p>
    );
  }
  return null;
}

const OUTCOME = {
  reauthorized: { label: "re-authorized", tone: "text-success", icon: Tick02Icon },
  old_key_kept: { label: "re-authorized, old key kept", tone: "text-warning", icon: Alert02Icon },
  failed: { label: "couldn't take the new key", tone: "text-destructive", icon: Alert02Icon },
  rolled_back: { label: "unchanged", tone: "text-muted-foreground", icon: null },
  rollback_failed: { label: "unchanged, unused key left", tone: "text-warning", icon: Alert02Icon },
} as const;

export function ServerOutcome({
  server,
  pending,
  result,
}: {
  server: KeyServer;
  pending: boolean;
  result: RotateServerResult | undefined;
}) {
  if (pending) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <span
          aria-hidden
          className="size-2.5 animate-spin rounded-full border-[1.5px] border-current border-r-transparent motion-reduce:animate-none"
        />
        re-authorizing…
      </span>
    );
  }
  if (!result) {
    return isUnreachable(server) ? (
      <span className="text-destructive">{server.state?.detail ?? "down"}</span>
    ) : (
      <span className="text-muted-foreground">will be re-authorized</span>
    );
  }
  const o = OUTCOME[result.outcome];
  return (
    <span className={`inline-flex min-w-0 items-center gap-1 ${o.tone}`}>
      {o.icon ? <HugeiconsIcon icon={o.icon} strokeWidth={2} className="size-3 shrink-0" /> : null}
      <span className="truncate">{o.label}</span>
    </span>
  );
}
