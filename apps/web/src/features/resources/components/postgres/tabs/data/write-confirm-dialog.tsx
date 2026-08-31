/**
 * Confirm gate for write-mode SQL.
 *
 * Destructive statements (DROP / TRUNCATE / unscoped DELETE / UPDATE) require
 * typing the database name; other writes get a plain styled confirm. Either way
 * the statement about to run is shown.
 *
 * This is a UX gate, NOT the security boundary. What actually stops a write is
 * the session: a read-only connection is read-only at the server, so a
 * statement that gets past this dialog still cannot write. See
 * `Dialect.readOnlyConnectionParams`.
 */
import { TypedConfirmDialog } from "@/shared/components/typed-confirm-dialog";

import type { DataStudioController } from "./use-data-studio";

export function WriteConfirmDialog({
  studio,
  databaseName,
}: {
  studio: DataStudioController;
  databaseName: string;
}) {
  const pw = studio.table.pendingWrite;
  const destructive = pw?.severity === "destructive";
  return (
    <TypedConfirmDialog
      open={pw !== null}
      onOpenChange={(open) => {
        if (!open) studio.table.cancelPendingWrite();
      }}
      title={destructive ? "This statement is destructive" : "Run against the live database?"}
      description={
        destructive
          ? "It contains DROP, TRUNCATE, or a DELETE/UPDATE with no WHERE clause. It runs immediately and the data can't be recovered."
          : "INSERT / UPDATE / DELETE / DDL take effect immediately and can't be undone."
      }
      confirmPhrase={destructive ? databaseName : undefined}
      confirmLabel="Run statement"
      onConfirm={() => studio.table.confirmPendingWrite()}
    >
      {pw ? (
        <pre className="max-h-32 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground ring-1 ring-foreground/10">
          {pw.sql}
        </pre>
      ) : null}
    </TypedConfirmDialog>
  );
}
