-- At most one primary base route per resource.
--
-- Two concurrent `domains.add` calls on a service with no domain both read
-- "no routes yet" and both inserted isPrimary = true; nothing in the schema
-- said otherwise. The writers now serialize on the resource row, and this
-- partial unique index is the backstop.
--
-- An existing install can already hold a resource with two primaries. Before
-- the index, every resource keeps exactly one: the route whose domain the
-- service mirrors as its public domain (what the panel and PUBLIC_URL already
-- show), else the oldest. The others become ordinary routes; they keep
-- serving, only the canonical flag moves.
--
-- (The route_policy default below is drizzle-kit catching the column default
-- up with the schema's DEFAULT_ROUTE_POLICY; it changes no existing row.)
ALTER TABLE "proxy_route" ALTER COLUMN "route_policy" SET DEFAULT '{"compression":"off","maxRequestBodyMb":null,"hsts":"off","contentTypeNosniff":false,"frameOptions":"off","referrerPolicy":"off","contentSecurityPolicy":null,"upstreamProtocol":"http"}';--> statement-breakpoint
UPDATE "proxy_route" AS "pr"
SET "is_primary" = false
WHERE "pr"."is_primary"
  AND "pr"."preview_id" IS NULL
  AND "pr"."resource_id" IS NOT NULL
  AND "pr"."id" <> (
    SELECT "keep"."id"
    FROM "proxy_route" AS "keep"
    LEFT JOIN "service_resource" AS "sr" ON "sr"."resource_id" = "keep"."resource_id"
    WHERE "keep"."resource_id" = "pr"."resource_id"
      AND "keep"."is_primary"
      AND "keep"."preview_id" IS NULL
    ORDER BY ("keep"."domain" = "sr"."public_domain") DESC NULLS LAST,
      "keep"."created_at",
      "keep"."id"
    LIMIT 1
  );--> statement-breakpoint
CREATE UNIQUE INDEX "proxy_route_one_primary_per_resource" ON "proxy_route" ("resource_id") WHERE "is_primary" and "preview_id" is null;
