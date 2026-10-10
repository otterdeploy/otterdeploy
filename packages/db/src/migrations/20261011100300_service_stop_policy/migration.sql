-- How the plain-Docker runtime stops a service container.
--
-- A compose stack's database child was stopped with docker's fixed 10 s grace
-- and killed mid-checkpoint on a redeploy; it panicked on its next start.
-- `stop_grace_period_ms` / `stop_signal` carry a compose file's own
-- `stop_grace_period` / `stop_signal` to the container. NULL = the runtime's
-- default for the kind of service (longer when it keeps a volume), the image's
-- own STOPSIGNAL.
ALTER TABLE "service_resource" ADD COLUMN "stop_grace_period_ms" integer;--> statement-breakpoint
ALTER TABLE "service_resource" ADD COLUMN "stop_signal" text;
