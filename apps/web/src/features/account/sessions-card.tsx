/**
 * Active sessions — inline list of every device signed in to this account
 * (better-auth `listSessions`), with per-row revoke and a revoke-all-others
 * footer. Same data source and cache keys as the shell's sessions dialog.
 */

import { DeviceAccessIcon } from "@hugeicons/core-free-icons";
import { formatRelative } from "@otterdeploy/shared/format";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { SettingsFooter, SettingsSection } from "@/shared/components/settings-section";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ErrorState } from "@/shared/components/ui/error-state";
import { Skeleton } from "@/shared/components/ui/skeleton";

import {
  describeAgent,
  useAuthInvalidate,
  useCurrentSession,
  useSessions,
} from "./data/use-account";

export function SessionsCard() {
  const invalidate = useAuthInvalidate();
  const currentQ = useCurrentSession();
  const sessionsQ = useSessions();

  const currentToken = currentQ.data?.session?.token;
  const sessions = sessionsQ.data ?? [];
  // Current session first, then most recently active.
  const ordered = [...sessions].sort((a, b) => {
    if (a.token === currentToken) return -1;
    if (b.token === currentToken) return 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
  const otherCount = sessions.filter((s) => s.token !== currentToken).length;

  const revokeOne = useMutation({
    mutationFn: async (token: string) => {
      const res = await authClient.revokeSession({ token });
      if (res.error) throw new Error(res.error.message ?? "Failed to revoke");
    },
    onSuccess: async () => {
      await invalidate.sessions();
      toast.success("Session revoked");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to revoke"),
  });

  const revokeOthers = useMutation({
    mutationFn: async () => {
      const res = await authClient.revokeOtherSessions();
      if (res.error) throw new Error(res.error.message ?? "Failed");
    },
    onSuccess: async () => {
      await invalidate.sessions();
      toast.success("Signed out of all other sessions");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <SettingsSection
      icon={DeviceAccessIcon}
      title="Active sessions"
      description="Devices currently signed in to your account. Revoke any you don't recognise."
    >
      {sessionsQ.isPending ? (
        <div className="flex flex-col divide-y divide-border/60">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-52" />
              </div>
              <Skeleton className="h-7 w-16" />
            </div>
          ))}
        </div>
      ) : sessionsQ.isError ? (
        <div className="p-4">
          <ErrorState
            message={sessionsQ.error instanceof Error ? sessionsQ.error.message : undefined}
            onRetry={() => void sessionsQ.refetch()}
          />
        </div>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border/60">
            {ordered.map((s) => {
              const isCurrent = s.token === currentToken;
              return (
                <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium">
                        {describeAgent(s.userAgent)}
                      </span>
                      {isCurrent && <Badge variant="secondary">This device</Badge>}
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      {s.ipAddress || "unknown IP"} · signed in {formatRelative(s.createdAt)} ·
                      active {formatRelative(s.updatedAt)}
                    </div>
                  </div>
                  {!isCurrent && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      disabled={revokeOne.isPending}
                      onClick={() => revokeOne.mutate(s.token)}
                    >
                      Revoke
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          <SettingsFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={otherCount === 0 || revokeOthers.isPending}
              onClick={() => revokeOthers.mutate()}
            >
              {revokeOthers.isPending
                ? "Signing out…"
                : `Revoke ${otherCount} other session${otherCount === 1 ? "" : "s"}`}
            </Button>
          </SettingsFooter>
        </>
      )}
    </SettingsSection>
  );
}
