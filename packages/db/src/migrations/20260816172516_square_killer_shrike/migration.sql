CREATE TABLE "edge_stat_day" (
	"host" text,
	"day" text,
	"requests" bigint NOT NULL,
	"bot_requests" bigint NOT NULL,
	"req_bytes" bigint NOT NULL,
	"res_bytes" bigint NOT NULL,
	"s2xx" integer NOT NULL,
	"s3xx" integer NOT NULL,
	"s4xx" integer NOT NULL,
	"s5xx" integer NOT NULL,
	"s_other" integer NOT NULL,
	"statuses" jsonb NOT NULL,
	"visitors" integer NOT NULL,
	"approximate" boolean NOT NULL,
	"countries" jsonb NOT NULL,
	"paths" jsonb NOT NULL,
	"referrers" jsonb NOT NULL,
	"browsers" jsonb NOT NULL,
	"oses" jsonb NOT NULL,
	"device_types" jsonb NOT NULL,
	"latency_buckets" integer[] NOT NULL,
	"latency_sum_ms" bigint NOT NULL,
	CONSTRAINT "edge_stat_day_pkey" PRIMARY KEY("host","day")
);
--> statement-breakpoint
CREATE TABLE "edge_stat_minute" (
	"host" text,
	"minute" integer,
	"requests" integer NOT NULL,
	"bot_requests" integer NOT NULL,
	"s2xx" integer NOT NULL,
	"s3xx" integer NOT NULL,
	"s4xx" integer NOT NULL,
	"s5xx" integer NOT NULL,
	"s_other" integer NOT NULL,
	"req_bytes" bigint NOT NULL,
	"res_bytes" bigint NOT NULL,
	"latency_buckets" integer[] NOT NULL,
	"latency_sum_ms" bigint NOT NULL,
	"latency_max_ms" integer NOT NULL,
	CONSTRAINT "edge_stat_minute_pkey" PRIMARY KEY("host","minute")
);
--> statement-breakpoint
CREATE INDEX "edge_stat_day_day_idx" ON "edge_stat_day" ("day");--> statement-breakpoint
CREATE INDEX "edge_stat_minute_minute_idx" ON "edge_stat_minute" ("minute");