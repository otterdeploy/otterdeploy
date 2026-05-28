CREATE TABLE "device_code" (
	"id" text PRIMARY KEY NOT NULL,
	"device_code" text NOT NULL,
	"user_code" text NOT NULL,
	"user_id" text,
	"client_id" text,
	"scope" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"last_polled_at" timestamp,
	"polling_interval" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "device_code_device_code_unique" UNIQUE("device_code"),
	CONSTRAINT "device_code_user_code_unique" UNIQUE("user_code")
);
--> statement-breakpoint
CREATE INDEX "device_code_user_code_idx" ON "device_code" USING btree ("user_code");--> statement-breakpoint
CREATE INDEX "device_code_device_code_idx" ON "device_code" USING btree ("device_code");