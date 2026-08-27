/**
 * `ghcr.io`, covered by the workspace's GitHub App rather than by a stored
 * credential.
 *
 * A sibling of RegistryCard and now literally built from the same shell
 * (registry-card-shell.tsx) rather than a lookalike that had drifted — they
 * share a list, so they share a silhouette. What differs is what the card
 * SAYS: there is no row behind this one, so there is nothing to edit, nothing
 * to rotate, and no password field to render, which is why it carries no
 * overflow menu and no Test button. Showing it as a normal entry with disabled
 * buttons would imply a credential exists somewhere; showing nothing at all
 * would leave an operator wondering why GHCR works without an entry. The
 * footer states the absence in words instead.
 *
 * Copy rule from the plan: never call it a token. The user's model is "my
 * GitHub is connected", and the whole selling point is that no secret exists
 * for them to think about.
 */

import { GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";

import { RegistryCardFooter, RegistryCardShell } from "./registry-card-shell";

export interface GhcrCapabilityView {
  available: boolean;
  reason: "ok" | "no-app" | "no-installation" | "missing-packages-permission";
  accountLogin: string | null;
  storedCredentialExists: boolean;
  permissionUrl: string | null;
}

/**
 * Render only when the App can actually serve GHCR AND the operator has not
 * stored their own credential for it. A stored row wins (see
 * `shouldDeriveGhcr`), and drawing both would state two different answers to
 * "what authenticates my pushes".
 */
export function shouldShowDerivedGhcr(capability: GhcrCapabilityView | undefined): boolean {
  return capability !== undefined && capability.available && !capability.storedCredentialExists;
}

export function GhcrDerivedCard({ capability }: { capability: GhcrCapabilityView }) {
  const { t } = useTranslation();
  const needsPermission = capability.reason === "missing-packages-permission";

  return (
    <RegistryCardShell
      monoTitle
      logo={
        <HugeiconsIcon
          icon={GithubIcon}
          strokeWidth={1.5}
          className="size-5 text-muted-foreground"
        />
      }
      title="ghcr.io"
      badge={t("registries.ghcr.badge")}
      // The account is the machine-readable identity line, matching
      // `user@host` on a stored credential; the explanation is prose below it.
      subtitle={capability.accountLogin ?? undefined}
      description={
        capability.accountLogin === null
          ? t("registries.ghcr.description")
          : t("registries.ghcr.descriptionAs", { account: capability.accountLogin })
      }
    >
      <RegistryCardFooter
        meta={
          needsPermission ? (
            <span className="text-amber-600 dark:text-amber-500">
              {t("registries.ghcr.needsPermission")}
            </span>
          ) : (
            <span>{t("registries.ghcr.noCredential")}</span>
          )
        }
      >
        {needsPermission && capability.permissionUrl !== null ? (
          <Button
            variant="outline"
            size="xs"
            className="shrink-0"
            render={
              <a href={capability.permissionUrl} target="_blank" rel="noreferrer">
                {t("registries.ghcr.review")}
              </a>
            }
          />
        ) : null}
      </RegistryCardFooter>
    </RegistryCardShell>
  );
}
