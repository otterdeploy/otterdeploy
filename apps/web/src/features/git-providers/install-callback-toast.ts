/**
 * Reads ?git_install=ok|error from the GitHub install-callback redirect,
 * surfaces a toast + refreshes the providers list, then strips the params
 * from the URL so a refresh doesn't re-fire.
 *
 * Mounted once in the `_app` layout. The callback can land anywhere now
 * (Git providers page by default, or the `returnTo` page the connect was
 * started from, e.g. the deploy wizard).
 */

import { useEffect } from "react";

import { useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { orpc, queryClient } from "@/shared/server/orpc";

// The callback params ride on whatever route the redirect lands on, so they
// are not in any route's search schema. Narrow them from the raw search
// object instead of casting it. Both selectors return primitives so the
// useLocation subscriptions stay referentially stable.
function gitInstallOf(search: object): "ok" | "error" | undefined {
  if (!("git_install" in search)) return undefined;
  const v = search.git_install;
  return v === "ok" || v === "error" ? v : undefined;
}

function reasonOf(search: object): string | undefined {
  if (!("reason" in search)) return undefined;
  return typeof search.reason === "string" ? search.reason : undefined;
}

export function useInstallCallbackToast() {
  const { t } = useTranslation();
  const gitInstall = useLocation({ select: (l) => gitInstallOf(l.search) });
  const reason = useLocation({ select: (l) => reasonOf(l.search) });

  useEffect(() => {
    if (!gitInstall) return;
    if (gitInstall === "ok") {
      toast.success(t("gitProviders.githubConnected"));
      void queryClient.invalidateQueries({
        queryKey: orpc.git.list.queryKey({ input: undefined }),
      });
    } else {
      toast.error(`GitHub install failed: ${reason ?? "unknown"}`);
    }
    // Strip only the callback params: the landing page may carry its own
    // (e.g. ?new=service, which reopens the deploy wizard).
    const url = new URL(window.location.href);
    url.searchParams.delete("git_install");
    url.searchParams.delete("reason");
    window.history.replaceState({}, "", url);
  }, [gitInstall, reason, t]);
}
