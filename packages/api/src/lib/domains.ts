/**
 * Public-FQDN resolver — single source of truth for "what hostname does
 * this resource live at?" across services and databases.
 *
 * Resolution walks most-specific → least-specific and stops at the first
 * level that has a usable value. Each level also exposes whether its
 * domain is verified, which the cert-issuance path uses to decide
 * between ACME (Let's Encrypt for verified real domains) and
 * `tls internal` (self-signed for sslip and unverified fallbacks).
 *
 *   1. Resource override     — service.publicDomain (literal FQDN)
 *   2. Project custom domain — project.customDomain ➜ `<resource>.<customDomain>`
 *   3. Org base domain       — org.baseDomain ➜ `<resource>-<project>.<kindBase>.<baseDomain>`
 *   4. sslip.io fallback     — `<resource>-<project>.<serverIp>.sslip.io`
 *
 * No "platform default" branch: the `*.otterdeploy.dev` constants are
 * only correct for the SaaS install that actually owns that domain.
 * That install seeds `org.baseDomain` for its main org explicitly; every
 * other install reaches sslip when nothing higher is set, which works
 * out of the box without any DNS the operator doesn't own.
 *
 * The "kindBase" subdomain (`apps` for services, `db` for databases)
 * keeps the two namespaces non-colliding under a shared org base.
 * Project-custom and resource-override paths skip kindBase — at that
 * level the operator has already picked a name and we trust it.
 */

export type ResourceKind = "service" | "database";

export interface DomainContext {
  /** sanitized — lowercase, hyphen-safe slug, ≤63 chars */
  resourceSlug: string;
  /** sanitized project slug */
  projectSlug: string;
  kind: ResourceKind;
}

export interface DomainSources {
  /** Per-resource override (service.publicDomain). Literal FQDN. */
  resourceOverride: string | null;
  /** Project-level apex (project.customDomain). */
  projectCustomDomain: string | null;
  projectCustomDomainVerifiedAt: Date | null;
  /** Org-level apex (organization.baseDomain). */
  orgBaseDomain: string | null;
  orgBaseDomainVerifiedAt: Date | null;
  /** Platform settings — used for sslip.io fallback. */
  serverIp: string | null;
}

export interface ResolvedDomain {
  /** The FQDN to publish. Always non-empty. */
  fqdn: string;
  /** Which level of the chain provided the value. Drives the UI badge
   *  ("Custom domain", "Org domain", "Platform default", "sslip fallback")
   *  and the cert-issuance decision. */
  source:
    | "resource-override"
    | "project-custom"
    | "org-base"
    | "sslip-fallback";
  /** True only when this domain was verified (TXT record check). Drives
   *  ACME issuance — unverified domains fall back to self-signed certs
   *  even when they pass through to a real-looking FQDN. */
  verified: boolean;
}

const kindBase = (kind: ResourceKind): string =>
  kind === "service" ? "apps" : "db";

export function resolvePublicDomain(
  ctx: DomainContext,
  sources: DomainSources,
): ResolvedDomain {
  // 1. Per-resource literal FQDN — verified-by-presence (the operator
  //    typed it themselves; we still expect their DNS to point here).
  if (sources.resourceOverride && sources.resourceOverride.trim().length > 0) {
    return {
      fqdn: sources.resourceOverride.trim().toLowerCase(),
      source: "resource-override",
      verified: true,
    };
  }

  // 2. Project apex — `<resource>.<projectCustomDomain>`. The project's
  //    custom domain IS the apex; we drop the project slug from the
  //    subdomain (no `web-myproj.myproj.acme.com`, just `web.myproj.acme.com`).
  if (
    sources.projectCustomDomain &&
    sources.projectCustomDomain.trim().length > 0
  ) {
    return {
      fqdn: `${ctx.resourceSlug}.${sources.projectCustomDomain.trim().toLowerCase()}`,
      source: "project-custom",
      verified: sources.projectCustomDomainVerifiedAt != null,
    };
  }

  // 3. Org base — `<resource>-<project>.<kindBase>.<baseDomain>`. Mirrors
  //    the platform-default pattern (`*.apps.otterdeploy.dev` /
  //    `*.db.otterdeploy.dev`) so service and database namespaces don't
  //    collide under a shared org apex.
  if (sources.orgBaseDomain && sources.orgBaseDomain.trim().length > 0) {
    return {
      fqdn: `${ctx.resourceSlug}-${ctx.projectSlug}.${kindBase(ctx.kind)}.${sources.orgBaseDomain.trim().toLowerCase()}`,
      source: "org-base",
      verified: sources.orgBaseDomainVerifiedAt != null,
    };
  }

  // 4. sslip.io fallback — works without any DNS setup at all. Uses the
  //    server's public IP as the rightmost label of a free sslip.io
  //    subdomain. Cert is self-signed (sslip can't get Let's Encrypt and
  //    we don't try). Verified=false so the rest of the pipeline knows
  //    not to attempt ACME issuance for this name.
  const ip = sources.serverIp?.trim() || "127.0.0.1";
  return {
    fqdn: `${ctx.resourceSlug}-${ctx.projectSlug}.${ip}.sslip.io`,
    source: "sslip-fallback",
    verified: false,
  };
}
