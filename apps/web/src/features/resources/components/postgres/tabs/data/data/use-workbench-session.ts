/**
 * The workbench session: opened when a target is picked, closed when it is
 * left.
 *
 * Nothing about a database is reachable until `openSession` says so. For a
 * managed database that call starts the tunnel into its container and proves
 * it with one round trip; for an external one it proves the credentials. So
 * the hook's "connecting" is a real state with a real end — a version string
 * or the reason — and not a spinner over a request that may or may not be
 * about to fail.
 *
 * Closing is tied to unmount, which is every way of leaving: switching
 * databases (the route remounts on target), navigating away, closing the
 * tab (the server's idle reaper covers the one the browser cannot report).
 */
import { useEffect, useState } from "react";

import { useMutation } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

import type { WorkbenchTarget } from "./target";

import { errMessage } from "../use-data-studio-sql";
import { targetKey } from "./target";

type SessionStatus =
  | { phase: "connecting" }
  | { phase: "connected"; serverVersion: string; tunneled: boolean }
  | { phase: "error"; reason: string };

export function useWorkbenchSession(target: WorkbenchTarget) {
  const [status, setStatus] = useState<SessionStatus>({ phase: "connecting" });
  // `mutateAsync` / `mutate` are stable across renders, so the effect below
  // depends on them without re-running on every render.
  const { mutateAsync: openAsync } = useMutation(orpc.data.openSession.mutationOptions());
  const { mutate: closeNow } = useMutation(orpc.data.closeSession.mutationOptions());

  const key = targetKey(target);
  useEffect(() => {
    let alive = true;
    openAsync({ target })
      .then((r) => {
        if (alive) {
          setStatus({ phase: "connected", serverVersion: r.serverVersion, tunneled: r.tunneled });
        }
      })
      .catch((error: unknown) => {
        if (alive) setStatus({ phase: "error", reason: errMessage(error) });
      });
    return () => {
      alive = false;
      // Best effort and fire-and-forget: the page is going away. The server
      // reaps anything this does not reach.
      closeNow({ target });
    };
    // `key` stands in for `target`, which is a fresh object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, openAsync, closeNow]);

  const retry = () => {
    setStatus({ phase: "connecting" });
    openAsync({ target })
      .then((r) =>
        setStatus({ phase: "connected", serverVersion: r.serverVersion, tunneled: r.tunneled }),
      )
      .catch((error: unknown) => setStatus({ phase: "error", reason: errMessage(error) }));
  };

  return { status, retry };
}
