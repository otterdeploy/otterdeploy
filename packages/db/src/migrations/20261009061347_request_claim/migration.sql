-- Short-lived claims that make API key and invitation creates idempotent
-- across a double submit or a retried request. See src/request-claim.ts.
CREATE TABLE "request_claim" (
	"key" text PRIMARY KEY,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX "request_claim_expires_at_idx" ON "request_claim" ("expires_at");