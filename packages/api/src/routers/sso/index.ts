/**
 * SSO provider reads for the active workspace.
 *
 * Delegates to better-auth's own `listSSOProviders` rather than querying
 * `sso_provider` directly, deliberately: that endpoint already performs the
 * admin check (`batchCheckOrgAdmin`) AND the redaction (`sanitizeProvider`,
 * which drops the client secret and all but the last four characters of the
 * client id). Re-implementing either here would create a second copy to keep
 * correct, and the redaction is exactly the thing you cannot afford to get
 * wrong twice.
 *
 * What this adds on top is SCOPE. The plugin returns every provider the caller
 * administers across all their organizations; this narrows to
 * `context.activeOrganizationId` before responding. Same reasoning as the
 * members router: better-auth re-checks membership itself, but this router's
 * own scope guard has to hold on its own, and a workspace settings page should
 * never receive another workspace's identity-provider metadata, not because
 * it is a leak (the caller administers both) but because filtering in the
 * browser is presentation, and presentation must never be load-bearing.
 */

import { auth } from "@otterdeploy/auth";
import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";

import type { SsoProviderView } from "./contract";

import { orgScopedProcedure } from "../../index";

/** Shape the plugin's sanitized provider into the contract's view. Unknown /
 *  extra fields (SAML config, SP metadata URLs) are dropped rather than passed
 *  through, so enabling SAML later cannot silently widen this response. */
function toProviderView(p: {
  providerId: string;
  issuer: string;
  domain: string;
  organizationId: string | null;
  oidcConfig?: { clientIdLastFour: string; discoveryEndpoint: string } | undefined;
}): SsoProviderView {
  return {
    providerId: p.providerId,
    issuer: p.issuer,
    domain: p.domain,
    // Brand at the boundary. The contract's output schema (`organizationIdField
    // .nullable()`) enforces the same prefix on the way out, so parsing here
    // fails no earlier than the response validation already would.
    organizationId:
      p.organizationId === null ? null : idSchema.organization.parse(p.organizationId),
    oidcConfig: p.oidcConfig
      ? {
          clientIdLastFour: p.oidcConfig.clientIdLastFour,
          discoveryEndpoint: p.oidcConfig.discoveryEndpoint,
        }
      : null,
  };
}

export const ssoRouter = {
  listProviders: orgScopedProcedure.sso.listProviders.handler(async ({ context }) => {
    context.log.set({
      target: { type: "organization", id: context.activeOrganizationId },
    });

    const res = await Result.tryPromise({
      try: () => auth.api.listSSOProviders({ headers: context.headers }),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    });
    if (res.isErr()) throw res.error;

    const providers = (res.value.providers ?? [])
      // The scope guard. Org-less (personal) providers fall out here too.
      // They belong to no workspace, so they are not this page's business.
      .filter((p) => p.organizationId === context.activeOrganizationId)
      .map(toProviderView);

    return { providers };
  }),
};
