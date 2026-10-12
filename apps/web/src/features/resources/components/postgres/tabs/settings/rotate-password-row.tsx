/**
 * The Maintenance card's "Rotate password" row and its confirm dialog. Calls
 * `project.resource.database.postgres.rotatePassword`: the backend sets the
 * new password on the engine, saves it with the connection strings, and
 * redeploys every service in this environment that connects with it. The
 * dialog then lists those services, because a rotation that left one behind
 * is the part the user has to act on.
 */

import type { InferRouterOutputs } from "@orpc/server";
import type { AppRouter } from "@otterdeploy/api/routers/index";

import { useId, useState } from "react";

import { Key01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { isDefinedError } from "@orpc/client";
import { useMutation } from "@tanstack/react-query";

import { RESOURCE_COLLECTION_KEY } from "@/features/resources/data/resource";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Label } from "@/shared/components/ui/label";
import { orpc, queryClient } from "@/shared/server/orpc";

import type { PostgresBodyProps } from "../../types";

type Resource = PostgresBodyProps["resource"];

/** Engines whose password the backend can change in place. The others are
 *  refused up front by the API; the row says so instead of offering a click. */
const ROTATABLE: ReadonlySet<Resource["engine"]> = new Set(["postgres", "mariadb", "mongodb"]);

const ENGINE_NAME: Record<Resource["engine"], string> = {
  postgres: "Postgres",
  mariadb: "MariaDB",
  mongodb: "MongoDB",
  redis: "Redis",
  clickhouse: "ClickHouse",
};

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export function RotatePasswordRow({ resource }: { resource: Resource }) {
  const [open, setOpen] = useState(false);
  const rotatable = ROTATABLE.has(resource.engine);

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2.5">
      <div className="flex flex-col">
        <span className="text-[13px] font-medium">Rotate password</span>
        <span className="text-[11px] text-muted-foreground">
          {rotatable
            ? "Set a new password on the database and redeploy every service that uses it."
            : `Not available for ${ENGINE_NAME[resource.engine]} yet: its password can't be changed in place.`}
        </span>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={!rotatable}
        className="gap-1.5"
        onClick={() => setOpen(true)}
      >
        <HugeiconsIcon icon={Key01Icon} strokeWidth={2} className="size-3.5" />
        Rotate
      </Button>
      {rotatable && <RotatePasswordDialog resource={resource} open={open} onOpenChange={setOpen} />}
    </div>
  );
}

function RotatePasswordDialog({
  resource,
  open,
  onOpenChange,
}: {
  resource: Resource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [endSessions, setEndSessions] = useState(true);
  const endSessionsId = useId();
  const isPostgres = resource.engine === "postgres";

  const rotate = useMutation({
    ...orpc.project.resource.database.postgres.rotatePassword.mutationOptions(),
    // The row's password and connection strings changed: the panel reads
    // them from the resource collection. The dialog itself reports the
    // outcome, so there is no toast on top of it.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RESOURCE_COLLECTION_KEY }),
  });

  const close = (next: boolean) => {
    if (rotate.isPending) return;
    onOpenChange(next);
    if (!next) {
      rotate.reset();
      setEndSessions(true);
    }
  };

  const title = rotate.isSuccess
    ? "Password rotated"
    : rotate.isError
      ? "Password not rotated"
      : `Rotate the password for “${resource.name}”?`;

  return (
    <AlertDialog open={open} onOpenChange={close}>
      <AlertDialogContent className="data-[size=default]:sm:max-w-[520px]">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription render={<div />}>
            {rotate.isSuccess ? (
              <RotationResult result={rotate.data} />
            ) : rotate.isError ? (
              <RotationRefusal
                message={rotate.error.message}
                // Both typed refusals mean the backend changed nothing: the
                // engine, the row and the stored variables still agree.
                nothingChanged={
                  isDefinedError(rotate.error) &&
                  (rotate.error.code === "ROTATION_FAILED" ||
                    rotate.error.code === "ROTATION_UNSUPPORTED")
                }
              />
            ) : (
              <p>
                A new password is set on the database and saved, then every service in this
                environment that connects to it is redeployed with it. Anything else using the
                current password, such as a local client or an outside app, stops connecting until
                you give it the new one.
              </p>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {isPostgres && !rotate.isSuccess && !rotate.isError && (
          <div className="flex items-start gap-2.5 rounded-md border px-3 py-2.5">
            <Checkbox
              id={endSessionsId}
              className="mt-0.5"
              checked={endSessions}
              disabled={rotate.isPending}
              onCheckedChange={(checked) => setEndSessions(checked === true)}
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <Label htmlFor={endSessionsId} className="text-[13px] font-medium">
                Close connections opened with the current password
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Postgres keeps an open session after its password changes. Leave this on if the
                password may have leaked.
              </p>
            </div>
          </div>
        )}

        <AlertDialogFooter>
          {rotate.isSuccess || rotate.isError ? (
            <Button size="sm" onClick={() => close(false)}>
              {rotate.isSuccess ? "Done" : "Close"}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={rotate.isPending}
                onClick={() => close(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={rotate.isPending}
                onClick={() =>
                  rotate.mutate({
                    projectId: resource.projectId,
                    resourceId: resource.resourceId,
                    terminateSessions: isPostgres && endSessions,
                  })
                }
              >
                {rotate.isPending ? "Rotating…" : "Rotate password"}
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type RotationOutput =
  InferRouterOutputs<AppRouter>["project"]["resource"]["database"]["postgres"]["rotatePassword"];

function RotationResult({ result }: { result: RotationOutput }) {
  const failed = result.dependents.filter((d) => d.error !== null || d.status === "error");
  return (
    <div className="flex flex-col gap-3">
      <p>
        {result.dependents.length === 0
          ? "No service uses this database, so nothing was redeployed."
          : failed.length > 0
            ? `${count(failed.length, "service")} didn't come back on the new password. Redeploy ${failed.length === 1 ? "it" : "them"} from the graph.`
            : `Redeployed ${count(result.dependents.length, "service")} with the new password.`}{" "}
        The new password is on the Variables tab.
      </p>
      {result.dependents.length > 0 && (
        <ul className="overflow-hidden rounded-md border">
          {result.dependents.map((d) => (
            <li
              key={d.resourceId}
              className="flex items-baseline justify-between gap-3 border-b border-border/40 px-3 py-2 last:border-b-0"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] text-foreground">{d.name}</span>
                {d.error && <span className="text-[11px] text-destructive">{d.error}</span>}
              </span>
              <span
                className={
                  d.error !== null || d.status === "error"
                    ? "shrink-0 font-mono text-[11px] text-destructive"
                    : "shrink-0 font-mono text-[11px] text-muted-foreground"
                }
              >
                {d.status}
              </span>
            </li>
          ))}
        </ul>
      )}
      {(result.rewrittenVariables > 0 || result.terminatedSessions !== null) && (
        <ul className="flex flex-col gap-1 text-[12px]">
          {result.rewrittenVariables > 0 && (
            <li>
              Updated {count(result.rewrittenVariables, "stored variable")} that held the old
              password.
            </li>
          )}
          {result.terminatedSessions !== null && (
            <li>
              Closed {count(result.terminatedSessions, "connection")} opened with the old password.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function RotationRefusal({
  message,
  nothingChanged,
}: {
  message: string;
  nothingChanged: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-destructive">{message}</p>
      {nothingChanged && <p>Nothing was changed. The current password still works.</p>}
    </div>
  );
}
