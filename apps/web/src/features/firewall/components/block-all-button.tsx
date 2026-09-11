/**
 * Mass-block confirm: bans every listed offender IP in one CrowdSec batch.
 *
 * Lived in `features/edge-logs/components/edge-logs-block-ip.tsx` until the
 * access log moved onto the shared table shell, which deleted that file's other
 * half. It was always a firewall control — the edge log was just the first
 * place that needed one.
 */

import { useState } from "react";

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
} from "@/shared/components/ui/alert-dialog";
import { Button } from "@/shared/components/ui/button";

export function BlockAllButton({ count, onConfirm }: { count: number; onConfirm: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        {`Block ${count} IP${count === 1 ? "" : "s"}`}
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Block {count} IP{count === 1 ? "" : "s"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Every request from these IPs will be rejected at the Caddy edge (403) for 30 days,
            before it reaches any of your services. Each ban is individually reversible from the
            Firewall view.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
              setOpen(false);
            }}
          >
            Block all
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
