/**
 * Row actions for the trusted-CA table.
 *
 * Split from ./cas-table on the repo's existing `-parts` convention (see
 * custom-table-parts, servers-parts): the table owns layout and data, the
 * parts own a single row's confirm flow. Keeps both files inside the
 * file-length budget as the table grows.
 */

import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import { Button } from "@/shared/components/ui/button";

export function RemoveCaButton({
  name,
  disabled,
  onConfirm,
}: {
  name: string;
  disabled: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            disabled={disabled}
            aria-label={t("certificates.removeCa", { name })}
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("certificates.removeCaConfirm", { name })}</AlertDialogTitle>
          <AlertDialogDescription>{t("certificates.removeCaDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            render={
              <Button variant="outline" size="sm">
                {t("common.cancel")}
              </Button>
            }
          />
          <AlertDialogAction
            render={
              <Button
                size="sm"
                variant="ghost"
                className="bg-destructive/10 text-destructive hover:bg-destructive/20"
                onClick={onConfirm}
              >
                {t("common.remove")}
              </Button>
            }
          />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
