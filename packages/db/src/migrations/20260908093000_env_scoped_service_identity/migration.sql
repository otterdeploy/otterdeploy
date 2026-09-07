DROP INDEX "service_resource_service_name_unique";--> statement-breakpoint
DROP INDEX "service_resource_network_hostname_unique";--> statement-breakpoint
CREATE INDEX "service_resource_network_hostname_idx" ON "service_resource" ("network_name","internal_hostname");
