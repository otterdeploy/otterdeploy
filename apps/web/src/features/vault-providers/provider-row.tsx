/**
 * One configured secret provider: name (the reference-token namespace),
 * kind, verification status, and the test / edit / delete actions.
 */

import { useState } from "react";

import { Delete02Icon, PencilEdit02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";
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
import { ProviderMark } from "./kind-logos";

function StatusBadge({ provider }: { provider: VaultProvider }) {
  const { t } = useTranslation();
  if (provider.status === "connected") {
    return (
      <Badge variant="outline" className="border-success/40 text-success">
        {t("vault.statusConnected")}
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
        {t("vault.statusError")}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-warning/30 text-warning">
      {t("vault.statusUnverified")}
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
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const test = useTestVaultProvider();
  const remove = useRemoveVaultProvider();

  const runTest = () => {
    test.mutate(
      { id: provider.id },
      {
        onSuccess: (result) =>
          result.ok
            ? toast.success(t("vault.testReachable", { name: provider.name }))
            : toast.error(result.error ?? t("vault.testFailed")),
        onError: (error) =>
          toast.error(error instanceof Error ? error.message : t("vault.testFailed")),
      },
    );
  };

  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      <ProviderMark kind={provider.kind} />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-mono text-[13px] font-medium">{provider.name}</span>
          <span className="text-[11px] text-muted-foreground">{KIND_LABELS[provider.kind]}</span>
          <StatusBadge provider={provider} />
        </div>
        {provider.status === "error" && provider.lastError ? (
          <span className="truncate text-[11px] text-destructive">{provider.lastError}</span>
        ) : null}
        <code className="mt-1 w-fit max-w-full truncate rounded bg-muted px-1.5 py-1 font-mono text-[10px]">
          {`\${{vault.${provider.name}.`}
          {KIND_REF_HINTS[provider.kind].split(": ")[0]}
          {"}}"}
        </code>
      </div>

      {canManage ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="outline" size="sm" onClick={runTest} disabled={test.isPending}>
            {test.isPending ? t("vault.testing") : t("vault.test")}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t("vault.editProvider", { name: provider.name })}
            onClick={() => onEdit(provider)}
          >
            <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            aria-label={t("vault.removeProviderAria", { name: provider.name })}
            onClick={() => setConfirming(true)}
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
          </Button>

          <AlertDialog open={confirming} onOpenChange={setConfirming}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("vault.removeConfirmTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("vault.removeConfirmBefore")}{" "}
                  <code className="font-mono">{`\${{vault.${provider.name}.…}}`}</code>{" "}
                  {t("vault.removeConfirmAfter")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("vault.keepIt")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    setConfirming(false);
                    remove.mutate(
                      { id: provider.id },
                      {
                        onSuccess: () => toast.success(t("vault.providerRemoved")),
                        onError: (error) =>
                          toast.error(
                            error instanceof Error ? error.message : t("vault.removeError"),
                          ),
                      },
                    );
                  }}
                >
                  {t("vault.removeProvider")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : null}
    </div>
  );
}
