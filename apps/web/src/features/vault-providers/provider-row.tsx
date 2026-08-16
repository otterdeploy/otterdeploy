/**
 * One configured secret provider — name (the reference-token namespace),
 * kind, verification status, and the test / edit / delete actions.
 */

import { useState } from "react";

import { Delete02Icon, LockKeyIcon, PencilEdit02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";

import {
  KIND_LABELS,
  KIND_REF_HINTS,
  useRemoveVaultProvider,
  useTestVaultProvider,
  type VaultProvider,
} from "./data/vault-providers";

function StatusBadge({ provider }: { provider: VaultProvider }) {
  if (provider.status === "connected") {
    return (
      <Badge variant="outline" className="border-success/40 text-success">
        Connected
      </Badge>
    );
  }
  if (provider.status === "error") {
    return (
      <Badge
        variant="outline"
        className="border-destructive/40 text-destructive"
        title={provider.lastError ?? undefined}
      >
        Error
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Not verified
    </Badge>
  );
}

export function ProviderRow({
  provider,
  canManage,
  onEdit,
}: {
  provider: VaultProvider;
  canManage: boolean;
  onEdit: (provider: VaultProvider) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const test = useTestVaultProvider();
  const remove = useRemoveVaultProvider();

  const runTest = () => {
    test.mutate(
      { id: provider.id },
      {
        onSuccess: (result) =>
          result.ok
            ? toast.success(`"${provider.name}" is reachable`)
            : toast.error(result.error ?? "Connection test failed"),
        onError: (error) =>
          toast.error(error instanceof Error ? error.message : "Connection test failed"),
      },
    );
  };

  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      <HugeiconsIcon
        icon={LockKeyIcon}
        strokeWidth={1.5}
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-mono text-[13px] font-medium">{provider.name}</span>
          <span className="text-[11px] text-muted-foreground">{KIND_LABELS[provider.kind]}</span>
          <StatusBadge provider={provider} />
        </div>
        <span className="text-[11px] text-muted-foreground">
          {provider.credentialSet ? "Credential stored" : "No credential"}
          {provider.lastVerifiedAt
            ? ` · verified ${provider.lastVerifiedAt.toLocaleString()}`
            : " · never verified"}
        </span>
        {provider.status === "error" && provider.lastError ? (
          <span className="truncate text-[11px] text-destructive">{provider.lastError}</span>
        ) : null}
        <code className="mt-1 w-fit max-w-full truncate rounded bg-muted px-1.5 py-1 font-mono text-[10px]">
          {`\${{vault.${provider.name}.`}
          {KIND_REF_HINTS[provider.kind].split(" — ")[0]}
          {"}}"}
        </code>
      </div>

      {canManage ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="outline" size="sm" onClick={runTest} disabled={test.isPending}>
            {test.isPending ? "Testing…" : "Test"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={`Edit ${provider.name}`}
            onClick={() => onEdit(provider)}
          >
            <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            aria-label={`Remove ${provider.name}`}
            onClick={() => setConfirming(true)}
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
          </Button>

          <AlertDialog open={confirming} onOpenChange={setConfirming}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove this secret provider?</AlertDialogTitle>
                <AlertDialogDescription>
                  Any env var still referencing{" "}
                  <code className="font-mono">{`\${{vault.${provider.name}.…}}`}</code> will fail to
                  resolve on its next deploy. The provider's own secrets are not touched.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    setConfirming(false);
                    remove.mutate(
                      { id: provider.id },
                      {
                        onSuccess: () => toast.success("Provider removed"),
                        onError: (error) =>
                          toast.error(
                            error instanceof Error ? error.message : "Could not remove provider",
                          ),
                      },
                    );
                  }}
                >
                  Remove provider
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : null}
    </div>
  );
}
