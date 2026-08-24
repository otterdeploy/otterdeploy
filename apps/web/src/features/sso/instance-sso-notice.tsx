/**
 * "Enterprise SSO is off for this installation."
 *
 * The workspace SSO page can register providers whether or not the method is
 * switched on in Instance → Access, and that is deliberate: an operator has to
 * be able to configure an identity provider before enabling it. But a page that
 * silently accepts a provider nobody can use is dishonest, so it says so.
 *
 * Reads the PUBLIC config rather than `organization.getSignInMethods`, which is
 * install-admin only. A workspace admin who is not an install admin still needs
 * this answer, and "which sign-in methods does this installation offer" is
 * already public: it is what the sign-in page renders itself from.
 */

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { fetchAuthPublicConfig } from "@/features/auth/data/registration-mode";

export function InstanceSsoDisabledNotice() {
  const { t } = useTranslation();
  const config = useQuery({
    // Same key as the sign-in page so the two share one cached answer.
    queryKey: ["auth", "public-config"],
    queryFn: fetchAuthPublicConfig,
    retry: false,
  });

  // Absent while loading and on failure: a page that cannot reach the server
  // should not assert that a feature is disabled.
  if (config.data?.signIn.sso !== false) return null;

  return (
    <div className="mb-4 rounded-md border border-dashed p-3 text-[13px] text-muted-foreground">
      {t("sso.instanceDisabled")}
    </div>
  );
}
