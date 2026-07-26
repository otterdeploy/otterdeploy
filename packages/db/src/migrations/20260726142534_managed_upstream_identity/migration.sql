-- Compose sub-services now carry the same `od-` prefix as every other swarm
-- service (PLATFORM.service.serviceNamePrefix). A bare `${stack}-${service}` is
-- indistinguishable from any other alias on the overlay network, so
-- caddy/route-validation.ts could not tell a legitimate upstream from an
-- arbitrary container and rejected every compose route.
UPDATE "service_resource"
SET "service_name" = left('od-' || "service_name", 63)
WHERE "stack_id" IS NOT NULL
  AND "service_name" NOT LIKE 'od-%';--> statement-breakpoint
-- HTTP routes created before service/expose.ts wrote the swarm identity stored
-- the container's internal hostname instead ("web" rather than
-- "od-storefront-web"), which fails the same validation. Point each route at
-- its resource's actual service name.
UPDATE "proxy_route" AS pr
SET "upstream_host" = sr."service_name"
FROM "service_resource" AS sr
WHERE sr."resource_id" = pr."resource_id"
  AND pr."type" = 'http'
  AND pr."upstream_host" <> sr."service_name";
