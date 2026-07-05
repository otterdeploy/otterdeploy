/**
 * Reads ?git_install=ok|error from the GitHub install-callback redirect,
 * surfaces a toast + refreshes the providers list, then strips the params
 * from the URL so a refresh doesn't re-fire.
 *
 * Mounted once in the `_app` layout — the callback can land anywhere now
 * (Git providers page by default, or the `returnTo` page the connect was
 * started from, e.g. the deploy wizard).
 */

import { useEffect } from "react";

import { useLocation } from "@tanstack/react-router";
import { toast } from "sonner";

import { orpc, queryClient } from "@/shared/server/orpc";

export function useInstallCallbackToast() {
  const search = useLocation({
    select: (l) => l.search as { git_install?: "ok" | "error"; reason?: string },
  });

  useEffect(() => {
    if (!search.git_install) return;
    if (search.git_install === "ok") {
      toast.success("GitHub connected");
      void queryClient.invalidateQueries({
        queryKey: orpc.git.list.queryKey({ input: undefined }),
      });
    } else {
      toast.error(`GitHub install failed: ${search.reason ?? "unknown"}`);
    }
    // Strip only the callback params — the landing page may carry its own
    // (e.g. ?new=service, which reopens the deploy wizard).
    const url = new URL(window.location.href);
    url.searchParams.delete("git_install");
    url.searchParams.delete("reason");
    window.history.replaceState({}, "", url);
  }, [search.git_install, search.reason]);
}
