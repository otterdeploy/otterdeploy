import { useMemo, useState } from "react";

import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { sessionQuery } from "@/lib/auth-queries";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/shared/components/ui/toggle-group";
import { orpc, queryClient } from "@/shared/server/orpc";

import { JoinCommandBlock } from "./join-command-block";
import { StepUpForm } from "./join-token-step-up";

export type JoinRole = "worker" | "manager";

interface JoinTokenPanelProps {
  role: JoinRole;
  onRoleChange: (role: JoinRole) => void;
}

interface EnrollmentSummary {
  id: string;
  role: JoinRole;
  status: "active" | "expired" | "redeemed" | "completed" | "revoked";
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
  return (
    <div className="grid gap-2">
      <span className="text-xs font-medium">Recent enrollment credentials</span>
      {enrollments.length === 0 ? (
        <p className="text-xs text-muted-foreground">No enrollment credentials created.</p>
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
  const [totpCode, setTotpCode] = useState("");
  const [password, setPassword] = useState("");
  // Which credential this account can present. The server accepts either
  // (verifyStepUpCredential) — asking for a code from someone who never set up
  // an authenticator is a form that can't be filled in.
  const sessionQ = useQuery(sessionQuery);
  const twoFactorEnabled = Boolean(
    (sessionQ.data?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled,
  );
  const [managerConfirmation, setManagerConfirmation] = useState("");
  const [created, setCreated] = useState<{
    id: string;
    credential: string;
    expiresAt: string;
  } | null>(null);

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
        toast.success("Enrollment revoked");
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

  const command = useMemo(() => {
    if (!created) return null;
    const url = `${window.location.origin}/api/node-enrollments/${created.id}/redeem`;
    return `( set -e; script="$(curl -fsS -X POST '${url}' -H 'Authorization: Bearer ${created.credential}')"; printf '%s\\n' "$script" | sudo sh )`;
  }, [created]);

  const stepUpInput = {
    role,
    totpCode: twoFactorEnabled ? totpCode : undefined,
    password: twoFactorEnabled ? undefined : password,
    managerConfirmation: role === "manager" ? managerConfirmation : undefined,
  };
  const credentialReady = twoFactorEnabled ? /^\d{6}(\d{2})?$/.test(totpCode) : password.length > 0;
  const canSubmit =
    credentialReady && (role !== "manager" || managerConfirmation === "ENROLL MANAGER");

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
        <ToggleGroupItem value="worker" aria-label="Worker enrollment">
          Worker
        </ToggleGroupItem>
        <ToggleGroupItem value="manager" aria-label="Manager enrollment">
          Manager
        </ToggleGroupItem>
      </ToggleGroup>

      <StepUpForm
        role={role}
        twoFactorEnabled={twoFactorEnabled}
        totpCode={totpCode}
        password={password}
        managerConfirmation={managerConfirmation}
        canSubmit={canSubmit}
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

      <EnrollmentHistory
        enrollments={enrollments.data ?? []}
        revoking={revoke.isPending}
        onRevoke={(id) => revoke.mutate({ id })}
      />
    </div>
  );
}
