import { useMemo, useState } from "react";

import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useControlPlaneBaseUrl } from "@/features/shell/hooks/use-control-plane-base-url";
import { sessionQuery } from "@/lib/auth-queries";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/shared/components/ui/toggle-group";
import { orpc, queryClient } from "@/shared/server/orpc";

import { EnrollmentProgress, type EnrollmentProgressRow } from "./enrollment-progress";
import { JoinCommandBlock } from "./join-command-block";
import { StepUpForm, submitBlocker } from "./join-token-step-up";

export type JoinRole = "worker" | "manager";

interface JoinTokenPanelProps {
  role: JoinRole;
  onRoleChange: (role: JoinRole) => void;
}

/** Mirrors the `server.enrollments` row; the progress view needs its timestamps. */
type EnrollmentSummary = EnrollmentProgressRow;

interface CreatedEnrollment {
  id: string;
  credential: string;
  expiresAt: string;
}

/** `twoFactorEnabled` is a plugin field the base session user type doesn't
 *  declare, so it's read off the object structurally rather than asserted. */
function readTwoFactorEnabled(sessionUser: unknown): boolean {
  return Boolean(
    typeof sessionUser === "object" &&
    sessionUser !== null &&
    "twoFactorEnabled" in sessionUser &&
    sessionUser.twoFactorEnabled,
  );
}

/** The enrollment command is pasted into a shell on a DIFFERENT machine, so
 *  it must not carry this browser's incidental address. */
function buildJoinCommand(baseUrl: string, created: CreatedEnrollment | null): string | null {
  if (!created) return null;
  const url = `${baseUrl}/api/node-enrollments/${created.id}/redeem`;
  return `( set -e; script="$(curl -fsS -X POST '${url}' -H 'Authorization: Bearer ${created.credential}')"; printf '%s\\n' "$script" | sudo sh )`;
}

function buildStepUpInput(args: {
  role: JoinRole;
  twoFactorEnabled: boolean;
  totpCode: string;
  password: string;
  managerConfirmation: string;
}) {
  return {
    role: args.role,
    totpCode: args.twoFactorEnabled ? args.totpCode : undefined,
    password: args.twoFactorEnabled ? undefined : args.password,
    managerConfirmation: args.role === "manager" ? args.managerConfirmation : undefined,
  };
}

function isCredentialReady(twoFactorEnabled: boolean, totpCode: string, password: string): boolean {
  return twoFactorEnabled ? /^\d{6}(\d{2})?$/.test(totpCode) : password.length > 0;
}

/** Track whatever enrollment is still in flight. Preferring the one this
 *  session just created, so progress survives a reload or a reopened dialog
 *  instead of living only in `created`. */
function findTrackedEnrollment(
  rows: EnrollmentSummary[],
  createdId: string | undefined,
): EnrollmentSummary | undefined {
  return (
    rows.find((row) => row.id === createdId) ??
    rows.find((row) => row.status === "redeemed") ??
    rows.find((row) => row.status === "active")
  );
}

function EnrollmentHistory({
  enrollments,
  revoking,
  onRevoke,
}: {
  enrollments: EnrollmentSummary[];
  revoking: boolean;
  onRevoke: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-2">
      <span className="text-xs font-medium">{t("servers.enrollment.recent")}</span>
      {enrollments.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("servers.enrollment.none")}</p>
      ) : (
        <div className="divide-y rounded-md border">
          {enrollments.map((enrollment) => (
            <div key={enrollment.id} className="flex items-center gap-2 px-3 py-2 text-xs">
              <Badge variant="secondary">{enrollment.role}</Badge>
              <code className="min-w-0 flex-1 truncate text-muted-foreground">{enrollment.id}</code>
              <span className="text-muted-foreground">{enrollment.status}</span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Revoke ${enrollment.id}`}
                disabled={
                  revoking || enrollment.status === "revoked" || enrollment.status === "completed"
                }
                onClick={() => onRevoke(enrollment.id)}
              >
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function JoinTokenPanel({ role, onRoleChange }: JoinTokenPanelProps) {
  const { t } = useTranslation();
  const [totpCode, setTotpCode] = useState("");
  const [password, setPassword] = useState("");
  // Which credential this account can present. The server accepts either
  // (verifyStepUpCredential), asking for a code from someone who never set up
  // an authenticator is a form that can't be filled in.
  const sessionQ = useQuery(sessionQuery);
  const twoFactorEnabled = readTwoFactorEnabled(sessionQ.data?.user);
  const [managerConfirmation, setManagerConfirmation] = useState("");
  const [created, setCreated] = useState<CreatedEnrollment | null>(null);

  const enrollments = useQuery({
    ...orpc.server.enrollments.queryOptions(),
    refetchInterval: 5000,
  });
  const create = useMutation(
    orpc.server.createEnrollment.mutationOptions({
      onSuccess: (value) => {
        setCreated(value);
        setTotpCode("");
        setPassword("");
        void queryClient.invalidateQueries({ queryKey: orpc.server.enrollments.queryKey() });
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const revoke = useMutation(
    orpc.server.revokeEnrollment.mutationOptions({
      onSuccess: (_value, variables) => {
        toast.success(t("servers.enrollment.revoked"));
        setCreated((current) => (current?.id === variables.id ? null : current));
        void queryClient.invalidateQueries({ queryKey: orpc.server.enrollments.queryKey() });
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const rotate = useMutation(
    orpc.server.rotateJoinCredential.mutationOptions({
      onSuccess: () => {
        toast.success(`${role === "manager" ? "Manager" : "Worker"} join credential rotated`);
        setTotpCode("");
        setPassword("");
        setCreated(null);
        void queryClient.invalidateQueries({ queryKey: orpc.server.enrollments.queryKey() });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const baseUrl = useControlPlaneBaseUrl();
  const command = useMemo(() => buildJoinCommand(baseUrl, created), [created, baseUrl]);

  const stepUpInput = buildStepUpInput({
    role,
    twoFactorEnabled,
    totpCode,
    password,
    managerConfirmation,
  });
  const credentialReady = isCredentialReady(twoFactorEnabled, totpCode, password);
  const rows: EnrollmentSummary[] = enrollments.data ?? [];
  const tracked = findTrackedEnrollment(rows, created?.id);

  // Gate and explanation are one value. See submitBlocker. While the session is
  // still loading we hold submission rather than guess at twoFactorEnabled, which
  // would render the wrong credential field and reject on the server.
  const blockedReason = submitBlocker({
    sessionPending: sessionQ.isPending,
    twoFactorEnabled,
    credentialReady,
    role,
    managerConfirmation,
  });

  return (
    <div className="flex flex-col gap-4">
      <ToggleGroup
        value={[role]}
        onValueChange={(next) => {
          const value = next[0];
          if (value === "worker" || value === "manager") {
            onRoleChange(value);
            setCreated(null);
          }
        }}
        className="self-start"
      >
        <ToggleGroupItem value="worker" aria-label={t("servers.enrollment.worker")}>
          Worker
        </ToggleGroupItem>
        <ToggleGroupItem value="manager" aria-label={t("servers.enrollment.manager")}>
          Manager
        </ToggleGroupItem>
      </ToggleGroup>

      <StepUpForm
        role={role}
        twoFactorEnabled={twoFactorEnabled}
        totpCode={totpCode}
        password={password}
        managerConfirmation={managerConfirmation}
        blockedReason={blockedReason}
        creating={create.isPending}
        rotating={rotate.isPending}
        onTotpCodeChange={setTotpCode}
        onPasswordChange={setPassword}
        onManagerConfirmationChange={setManagerConfirmation}
        onCreate={() => create.mutate({ ...stepUpInput, ttlMinutes: 10 })}
        onRotate={() => rotate.mutate(stepUpInput)}
      />

      {command && created ? (
        <div className="grid gap-2">
          <p className="text-xs text-muted-foreground">
            Shown once. It expires {new Date(created.expiresAt).toLocaleTimeString()} and can enroll
            one {role}. Completion rotates Docker&apos;s underlying {role} token.
          </p>
          <JoinCommandBlock command={command} />
        </div>
      ) : null}

      {tracked ? (
        <div className="grid gap-2 rounded-md border bg-muted/20 p-3">
          <span className="text-xs font-medium">{t("servers.enrollment.progress")}</span>
          <EnrollmentProgress row={tracked} />
        </div>
      ) : null}

      <EnrollmentHistory
        enrollments={enrollments.data ?? []}
        revoking={revoke.isPending}
        onRevoke={(id) => revoke.mutate({ id })}
      />
    </div>
  );
}
