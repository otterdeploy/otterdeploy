CREATE TABLE "server_metric" (
	"seq" bigserial PRIMARY KEY,
	"server_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"ts" timestamp DEFAULT now() NOT NULL,
	"cpu_pct" double precision,
	"cpu_user_pct" double precision,
	"cpu_system_pct" double precision,
	"cpu_iowait_pct" double precision,
	"cpu_steal_pct" double precision,
	"mem_used_pct" double precision NOT NULL,
	"mem_available_bytes" bigint NOT NULL,
	"mem_total_bytes" bigint NOT NULL,
	"mem_cached_bytes" bigint,
	"mem_buffers_bytes" bigint,
	"zfs_arc_bytes" bigint,
	"swap_used_pct" double precision,
	"disk_used_pct" double precision,
	"disk_free_bytes" bigint,
	"disk_read_bytes_per_sec" bigint,
	"disk_write_bytes_per_sec" bigint,
	"load_avg_1" double precision,
	"load_avg_5" double precision,
	"load_avg_15" double precision,
	"net_rx_bytes_per_sec" bigint,
	"net_tx_bytes_per_sec" bigint
);
--> statement-breakpoint
CREATE INDEX "server_metric_server_ts_idx" ON "server_metric" ("server_id","ts");--> statement-breakpoint
CREATE INDEX "server_metric_org_ts_idx" ON "server_metric" ("organization_id","ts");--> statement-breakpoint
ALTER TABLE "server_metric" ADD CONSTRAINT "server_metric_server_id_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "server"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "server_metric" ADD CONSTRAINT "server_metric_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;