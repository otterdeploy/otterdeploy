/**
 * What stands between picking a database and browsing it: the session.
 *
 * Renders the connecting state, the failure with its reason, or — once the
 * server has proved the path — the workbench. The failure is a real
 * sentence from the runtime ("relay: the database container is not
 * running"), never a generic apology; that is the whole point of proving
 * the path before saying "connected".
 */
import type { ReactNode } from "react";

import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";
import { Spinner } from "@/shared/components/ui/spinner";

import type { WorkbenchTarget } from "../data/target";

import { useWorkbenchSession } from "../data/use-workbench-session";

export function ConnectGate({
  target,
  name,
  onChooseAnother,
  children,
}: {
  target: WorkbenchTarget;
  name: string;
  onChooseAnother: () => void;
  children: ReactNode;
}) {
  const { status, retry } = useWorkbenchSession(target);

  if (status.phase === "connected") return <>{children}</>;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Empty className="flex-1 justify-center">
        <EmptyHeader>
          {status.phase === "connecting" ? (
            <Spinner className="size-6 text-muted-foreground" />
          ) : (
            <HugeiconsIcon
              icon={Alert02Icon}
              strokeWidth={1.5}
              className="size-8 text-destructive"
            />
          )}
          <EmptyTitle>
            {status.phase === "connecting"
              ? `Connecting to ${name}…`
              : `Could not connect to ${name}`}
          </EmptyTitle>
          <EmptyDescription className="max-w-md">
            {status.phase === "connecting"
              ? "Opening a session and proving the path with one round trip."
              : status.reason}
          </EmptyDescription>
        </EmptyHeader>
        {status.phase === "error" ? (
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={retry}>
              Try again
            </Button>
            <Button size="sm" variant="ghost" onClick={onChooseAnother}>
              Choose another database
            </Button>
          </div>
        ) : null}
      </Empty>
    </div>
  );
}
