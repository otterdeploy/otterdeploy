/**
 * Connecting an external database: pick the engine, then describe the hop.
 *
 * Two steps because they are two different questions. The first screen is a
 * grid of engines with a paste field above it — pasting a URL answers both
 * questions at once and skips ahead with the fields filled in. The second is
 * the per-connection form: URL or discrete host/port/user fields (whichever
 * the reader has in front of them), and a TEST button that opens the draft URL
 * server-side before anything is saved — finding out a password is wrong must
 * not require storing it first.
 *
 * The URL stays write-only in every sense: sent through the mutation's
 * `metadata.secret` so it never enters the collection's cached rows, no
 * procedure returns it, and editing leaves it blank — meaning "keep the stored
 * credential". Server refusals are surfaced verbatim; a blocked metadata
 * address is worth reading, not paraphrasing.
 */
import { useState } from "react";

import { createId, ID_PREFIX } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { toast } from "sonner";
import * as z from "zod";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { orpc } from "@/shared/server/orpc";

import type { DataConnection } from "../data/connections";
import type { ConnectEngine } from "./connect-engines";
import type { ConnectDraft } from "./connect-form";

import { connectionCollectionFor } from "../data/connections";
import { CONNECT_ENGINES, EMPTY_FIELDS, fieldsFromUrl, urlFromFields } from "./connect-engines";
import { ConnectForm, EnginePicker } from "./connect-form";

/** The server's refusal detail, when the thrown error carries one. */
const errorDetail = z.object({ data: z.object({ reason: z.string() }) });
function reasonOf(cause: unknown): string {
  const detail = errorDetail.safeParse(cause);
  if (detail.success) return detail.data.data.reason;
  return cause instanceof Error ? cause.message : "The connection test failed.";
}

/** All of the dialog's state and actions; the component only renders it. */
function useConnectDraft(organizationId: string, existing: DataConnection | undefined) {
  const editing = existing !== undefined;
  const [engine, setEngine] = useState<ConnectEngine | null>(null);
  const [draft, setDraft] = useState<ConnectDraft>({
    name: existing?.name ?? "",
    url: "",
    fields: EMPTY_FIELDS,
    visibility: existing?.visibility ?? "org",
    environment: existing?.environment ?? "other",
    requireTls: existing?.requireTls ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<string | null>(null);

  // Editing skips the picker: the engine is already a fact about the row.
  const activeEngine =
    engine ?? (editing ? (CONNECT_ENGINES.find((e) => e.id === existing.engine) ?? null) : null);

  const patch = (next: Partial<ConnectDraft>) => {
    setDraft((d) => ({ ...d, ...next }));
    setTested(null);
  };

  /** URL wins; else assembled from the fields; else "" (= keep, when editing). */
  const effectiveUrl = () => {
    if (draft.url.trim() !== "") return draft.url.trim();
    return activeEngine === null ? "" : urlFromFields(activeEngine, draft.fields);
  };

  const acceptUrl = (raw: string) => {
    const parsed = fieldsFromUrl(raw);
    if (parsed === null) patch({ url: raw });
    else {
      setEngine(parsed.engine);
      patch({ url: raw, fields: parsed.fields });
    }
  };

  const runTest = async () => {
    setError(null);
    setTested(null);
    const url = effectiveUrl();
    if (url === "" && !editing) {
      setError("Nothing to test yet — paste a URL or fill in a host.");
      return;
    }
    setTesting(true);
    const result = await Result.tryPromise({
      try: () =>
        url === "" && existing !== undefined
          ? orpc.data.testConnection.call({ id: existing.id })
          : orpc.data.testUrl.call({ url }),
      catch: reasonOf,
    });
    setTesting(false);
    if (result.isErr()) setError(result.error);
    else setTested(`Connected — ${result.value.serverVersion} · ${result.value.durationMs}ms`);
  };

  /** Returns true when saved, so the caller can close the dialog. */
  const submit = () => {
    setError(null);
    const outcome = saveConnection(
      connectionCollectionFor(organizationId),
      draft,
      effectiveUrl(),
      activeEngine,
      existing,
    );
    if (outcome !== null) {
      setError(outcome);
      return false;
    }
    toast.success(editing ? "Connection updated" : "Connection saved");
    return true;
  };

  return {
    editing,
    activeEngine,
    setEngine,
    draft,
    patch,
    acceptUrl,
    error,
    testing,
    tested,
    runTest,
    submit,
  };
}

export function ConnectDialog({
  organizationId,
  open,
  onOpenChange,
  existing,
}: {
  organizationId: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Set when editing; the URL field then means "replace the credential". */
  existing?: DataConnection;
}) {
  const c = useConnectDraft(organizationId, existing);
  const title = c.editing
    ? "Edit connection"
    : c.activeEngine === null
      ? "Connect a database"
      : `Connect ${c.activeEngine.label}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {c.activeEngine === null
              ? "Paste a connection string, or pick the engine."
              : "The URL is encrypted at rest and never sent back to the browser."}
          </DialogDescription>
        </DialogHeader>

        {c.activeEngine === null ? (
          <EnginePicker onAcceptUrl={c.acceptUrl} onPick={c.setEngine} />
        ) : (
          <ConnectForm
            engine={c.activeEngine}
            draft={c.draft}
            editing={c.editing}
            error={c.error}
            tested={c.tested}
            patch={c.patch}
            onAcceptUrl={c.acceptUrl}
            onBack={c.editing ? undefined : () => c.setEngine(null)}
          />
        )}

        {c.activeEngine !== null ? (
          <DialogFooter className="sm:justify-between">
            <Button
              variant="outline"
              size="sm"
              disabled={c.testing}
              onClick={() => void c.runTest()}
            >
              {c.testing ? "Testing…" : "Test connection"}
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => c.submit() && onOpenChange(false)}>
                {c.editing ? "Save" : "Save connection"}
              </Button>
            </div>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Apply the draft to the collection. Returns an error message, or null.
 *
 * The URL travels in the mutation's `metadata.secret`, never on the row: a
 * write-only field must not end up in the collection's cached data, where
 * every reader of the connection list would be holding a live credential.
 */
function saveConnection(
  connections: ReturnType<typeof connectionCollectionFor>,
  draft: ConnectDraft,
  url: string,
  engine: ConnectEngine | null,
  existing: DataConnection | undefined,
): string | null {
  // A production connection is read-only, full stop. The gate is the
  // CONNECTION, not a per-edit approval — so this is derived, never asked.
  const defaultAccess = draft.environment === "production" ? "read-only" : "read-write";

  const attempt = Result.try({
    try: () => {
      if (existing !== undefined) {
        connections.update(
          existing.id,
          { metadata: url === "" ? undefined : { secret: url } },
          (row) => {
            row.name = draft.name;
            row.visibility = draft.visibility;
            row.environment = draft.environment;
            row.defaultAccess = defaultAccess;
            row.requireTls = draft.requireTls;
          },
        );
        return;
      }
      connections.insert(
        {
          // Replaced by the server's row on refetch; engine and host are
          // parsed from the URL there, so these are optimistic placeholders.
          id: createId(ID_PREFIX.dataConnection),
          name: draft.name,
          engine: engine?.id ?? "postgres",
          displayHost: draft.fields.host,
          displayDatabase: draft.fields.database,
          visibility: draft.visibility,
          environment: draft.environment,
          defaultAccess,
          requireTls: draft.requireTls,
          createdAt: new Date(),
          lastConnectedAt: null,
        },
        { metadata: { secret: url } },
      );
    },
    catch: (cause) => (cause instanceof Error ? cause.message : "Could not save the connection."),
  });

  return attempt.isErr() ? attempt.error : null;
}
