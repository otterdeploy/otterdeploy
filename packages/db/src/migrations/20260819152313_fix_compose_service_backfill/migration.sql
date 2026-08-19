-- Re-derive `compose_service` from the SWARM service name, which is the only
-- column that actually encodes the compose key.
--
-- The first backfill (20260818154953_cheerful_morg) guessed from the child's
-- RESOURCE name, and pickResourceName has two shapes that guess wrong:
--
--   a namesake child (compose key == stack name) is named `<stack>-service`,
--   so the guess read the literal word "service" as the key;
--   older children carry the bare compose name with no stack prefix, which
--   matched neither branch and stayed NULL.
--
-- `service_name` is composeSwarmServiceName(): `od-<projectSlug>-<stack>-<key>`,
-- built from the compose key itself on every reconcile. Strip the prefix and
-- what remains IS the key. Rows whose name was truncated at swarm's 63-char cap
-- are skipped rather than half-guessed; those heal on the stack's next deploy,
-- which writes the key directly.
UPDATE "service_resource" sr
SET "compose_service" = right(
  sr."service_name",
  -length('od-' || p."slug" || '-' || sres."name" || '-')
)
FROM "resource" sres, "project" p
WHERE sres."id" = sr."stack_id"
  AND p."id" = sres."project_id"
  AND sr."stack_id" IS NOT NULL
  AND length(sr."service_name") < 63
  AND starts_with(sr."service_name", 'od-' || p."slug" || '-' || sres."name" || '-');
