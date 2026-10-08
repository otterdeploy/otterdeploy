/**
 * "Self-signed": the one chip every surface uses when it offers a URL the edge
 * serves with a self-signed certificate. One vocabulary, per
 * DESIGN.md: the same word, tint and explanation on the Public networking row,
 * the graph card, the service header and a stack's Exposed services.
 *
 * Warning tint, not destructive: the site is up and serving, the visitor just
 * has to get past a browser warning. The word carries the state on its own
 * (never colour alone); the title says what it means and what fixes it.
 */

import { useTranslation } from "react-i18next";

import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/lib/utils";

export function SelfSignedBadge({ hint, className }: { hint?: string; className?: string }) {
  const { t } = useTranslation();
  return (
    <Badge
      variant="outline"
      className={cn("border-warning/30 bg-warning/10 text-warning", className)}
      title={hint ?? t("domains.certSelfSignedGeneratedHint")}
    >
      {t("domains.certSelfSigned")}
    </Badge>
  );
}
