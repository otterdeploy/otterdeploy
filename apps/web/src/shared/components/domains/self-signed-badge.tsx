/**
 * "Self-signed": the one chip every surface uses when it offers a URL the edge
 * serves with a self-signed certificate. One vocabulary, per
 * DESIGN.md: the same word, tint and explanation on the Public networking row,
 * the graph card, the service header and a stack's Exposed services.
 *
 * Info tint, the one colour "self-signed" wears everywhere (this chip, the
 * Networking table's TLS cell, Edge → Certificates; see SELF_SIGNED_TONE). A
 * self-signed certificate on a generated address is the expected state of a
 * fresh install, not degradation: DESIGN.md keeps warning for pending/degraded
 * and info for neutral facts the operator should know. The word carries the
 * state on its own (never colour alone); the title says what it means and
 * what fixes it.
 */

import { useTranslation } from "react-i18next";

import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/lib/utils";

import { SELF_SIGNED_TONE } from "./self-signed-tone";

export function SelfSignedBadge({ hint, className }: { hint?: string; className?: string }) {
  const { t } = useTranslation();
  return (
    <Badge
      variant="outline"
      className={cn(SELF_SIGNED_TONE.chip, className)}
      title={hint ?? t("domains.certSelfSignedGeneratedHint")}
    >
      {t("domains.certSelfSigned")}
    </Badge>
  );
}
