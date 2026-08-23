/**
 * `ghcr.io`, covered by the workspace's GitHub App rather than by a stored
 * credential.
 *
 * Visually a sibling of RegistryCard but deliberately not one: there is no row
 * behind it, so there is nothing to edit, nothing to rotate, and no password
 * field to render. Showing it as a normal entry with disabled buttons would
 * imply a credential exists somewhere; showing nothing at all would leave an
 * operator wondering why GHCR works without an entry.
 *
 * Copy rule from the plan: never call it a token. The user's model is "my
 * GitHub is connected", and the whole selling point is that no secret exists
 * for them to think about.
 */

import { GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";

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
    <div className="flex items-start gap-3 rounded-md border p-4 ring-1 ring-foreground/5">
      <HugeiconsIcon
        icon={GithubIcon}
        strokeWidth={1.5}
        className="mt-0.5 size-5 shrink-0 text-muted-foreground"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[13px] font-medium">ghcr.io</span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {t("registries.ghcr.badge")}
          </span>
        </div>

        <p className="text-[13px] text-muted-foreground">
          {capability.accountLogin === null
            ? t("registries.ghcr.description")
            : t("registries.ghcr.descriptionAs", { account: capability.accountLogin })}
        </p>

        {needsPermission ? (
          <p className="mt-1 text-[13px] text-muted-foreground">
            {t("registries.ghcr.needsPermission")}
          </p>
        ) : null}
      </div>

      {needsPermission && capability.permissionUrl !== null ? (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          render={
            <a href={capability.permissionUrl} target="_blank" rel="noreferrer">
              {t("registries.ghcr.review")}
            </a>
          }
        />
      ) : null}
    </div>
  );
}
