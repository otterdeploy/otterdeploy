/**
 * External secret-manager hint for the wizard's variables step.
 *
 * Deliberately NOT a picker — the variables step's value cells already open
 * the full reference picker on `${{`, and vault entries flow through it like
 * any other source. This component only tells the operator that the
 * capability exists: which providers are connected (reference them as
 * `${{vault.<name>.<ref>}}`), or where to connect one when none are.
 */

import { Link, useParams } from "@tanstack/react-router";

import { useVaultProviders } from "@/features/vault-providers/data/vault-providers";

export function LinkedSecretsField() {
  const { orgSlug } = useParams({ strict: false });
  const providers = useVaultProviders();

  // Loading/error states render nothing: this is an optional hint, not a
  // surface worth a spinner inside the wizard.
  if (!orgSlug || providers.data === undefined) return null;

  if (providers.data.length === 0) {
    return (
      <p className="text-[11.5px] text-muted-foreground">
        Keeping secrets in Vault, Infisical or Doppler?{" "}
        <Link
          to="/$orgSlug/settings/workspace/secret-providers"
          params={{ orgSlug }}
          className="underline underline-offset-2 hover:text-foreground"
        >
          Connect a secret provider
        </Link>{" "}
        and reference them here as{" "}
        <code className="font-mono">{"${{vault.<provider>.<ref>}}"}</code> — values are fetched at
        deploy time, never stored.
      </p>
    );
  }

  return (
    <p className="text-[11.5px] text-muted-foreground">
      Secret providers connected ({providers.data.map((p) => p.name).join(", ")}) — reference
      their secrets in any value as{" "}
      <code className="font-mono">{"${{vault.<provider>.<ref>}}"}</code>; they resolve at deploy
      time.
    </p>
  );
}
