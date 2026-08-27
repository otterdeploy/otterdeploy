/**
 * `ghcr.io`, covered by the workspace's GitHub App rather than by a stored
 * credential.
 *
 * A sibling of RegistryCard and now literally built from the same shell
 * (registry-card-shell.tsx) rather than a lookalike that had drifted — they
 * share a list, so they share a silhouette. What differs is what the card
 * SAYS: there is no row behind this one, so there is nothing to edit, nothing
 * to rotate, and no password field to render, which is why it passes no
 * `actions`. Showing it as a normal entry with disabled buttons would imply a
 * credential exists somewhere; showing nothing at all would leave an operator
 * wondering why GHCR works without an entry.
 *
 * Copy rule from the plan: never call it a token. The user's model is "my
 * GitHub is connected", and the whole selling point is that no secret exists
 * for them to think about.
 */

import { GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";

import { RegistryCardShell } from "./registry-card-shell";

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
  const account = capability.accountLogin;

  return (
    <RegistryCardShell
      monoTitle
      logo={
        <HugeiconsIcon
          icon={GithubIcon}
          strokeWidth={1.5}
          className="size-[18px] text-muted-foreground"
        />
      }
      title="ghcr.io"
      badge={t("registries.ghcr.badge")}
      // The account IS the identity line here, the way `user@host` is on a
      // stored credential. There is no username and no secret to name.
      subtitle={account ?? t("registries.ghcr.authValue")}
      // Amber while the packages grant is missing: the App is installed but
      // pushes will fail, which is a state to act on rather than a healthy one.
      tone={needsPermission ? "idle" : "ok"}
      meta={
        needsPermission ? (
          <span className="text-amber-600 dark:text-amber-500">
            {t("registries.ghcr.needsGrant")}
          </span>
        ) : (
          // Says the one thing the face can't otherwise: there is no secret
          // here to create, rotate, or leak.
          <span>{t("registries.ghcr.nothingToRotate")}</span>
        )
      }
      actions={
        needsPermission && capability.permissionUrl !== null ? (
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            render={
              <a href={capability.permissionUrl} target="_blank" rel="noreferrer">
                {t("registries.ghcr.review")}
              </a>
            }
          />
        ) : undefined
      }
    />
  );
}
