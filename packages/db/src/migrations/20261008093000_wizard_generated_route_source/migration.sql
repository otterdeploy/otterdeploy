-- od-mc6m: the new-service wizard's generated host lands as a GENERATED route.
--
-- The wizard stages the host it previewed (`project.resource.publicHostPreview`)
-- in the manifest's `domains` when a public port has no hostname of its own,
-- and apply used to add every manifest domain as a custom domain. So a fresh
-- install's first services carry their platform-minted sslip.io address as
-- `source = 'custom'`: the Public networking card keeps offering "Generate
-- domain", the row is treated as a domain the operator brought, and flows that
-- rewrite generated hosts skip it. Apply now mints that host through the
-- generated-route path; this backfills the rows it already wrote.
--
-- Only rows that are unmistakably the platform's own address are touched:
--
--   * a base (non-preview) http route of a SERVICE resource,
--   * whose host is exactly `<resource>-<project>.<IPv4>.sslip.io`, built from
--     the resource name and project slug with the same sanitising the minting
--     code applies (lowercase, runs of anything outside [a-z0-9-] become '-',
--     edge dashes stripped, 32 characters, 'x' when empty). Nobody types that
--     name by hand, and sslip.io resolves it by construction, so it cannot be
--     anyone else's domain,
--   * and whose ownership is already verified. Generated routes count as
--     verified by construction, so flipping a verified row changes nothing
--     about whether or how it is served; only how the dashboard reads it.
--     An unverified (multi-org, still pending) row is left as it is.
--
-- Hosts the wizard derived from an org base domain or a project custom domain
-- are NOT backfilled: those are real names an operator could equally have
-- typed, so the row alone cannot say which it was.
--
-- On a clean database this is a no-op.
DO $$
DECLARE
  matched integer;
BEGIN
  SELECT count(*) INTO matched
  FROM "proxy_route" pr
  JOIN "resource" r ON r.id = pr.resource_id
  JOIN "project" p ON p.id = r.project_id
  WHERE pr.source = 'custom'
    AND pr.preview_id IS NULL
    AND pr.type = 'http'
    AND pr.domain_verified_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM "service_resource" s WHERE s.resource_id = r.id)
    AND pr.domain ~ (
      '^'
      || coalesce(nullif(left(trim(both '-' from regexp_replace(lower(trim(r.name)), '[^a-z0-9-]+', '-', 'g')), 32), ''), 'x')
      || '-'
      || coalesce(nullif(left(trim(both '-' from regexp_replace(lower(trim(p.slug)), '[^a-z0-9-]+', '-', 'g')), 32), ''), 'x')
      || '\.[0-9]{1,3}(\.[0-9]{1,3}){3}\.sslip\.io$'
    );
  IF matched > 0 THEN
    RAISE NOTICE 'od-mc6m: % wizard-generated sslip.io route(s) recorded as custom; marking them generated', matched;
  END IF;
END $$;--> statement-breakpoint
UPDATE "proxy_route" pr
SET "source" = 'generated', "updated_at" = now()
FROM "resource" r, "project" p
WHERE r.id = pr.resource_id
  AND p.id = r.project_id
  AND pr.source = 'custom'
  AND pr.preview_id IS NULL
  AND pr.type = 'http'
  AND pr.domain_verified_at IS NOT NULL
  AND EXISTS (SELECT 1 FROM "service_resource" s WHERE s.resource_id = r.id)
  AND pr.domain ~ (
    '^'
    || coalesce(nullif(left(trim(both '-' from regexp_replace(lower(trim(r.name)), '[^a-z0-9-]+', '-', 'g')), 32), ''), 'x')
    || '-'
    || coalesce(nullif(left(trim(both '-' from regexp_replace(lower(trim(p.slug)), '[^a-z0-9-]+', '-', 'g')), 32), ''), 'x')
    || '\.[0-9]{1,3}(\.[0-9]{1,3}){3}\.sslip\.io$'
  );
