-- A compose stack's own variables.
--
-- Until now a stack's `${VAR}` values lived in `project_env_var`, one bag per
-- (project, environment) that EVERY stack in the project interpolates against.
-- Template variable names are generic, so installing one template rotated a
-- credential another stack was running on. New writes go to this table; the
-- deploy reads it first and falls back to the project bag.
CREATE TABLE "stack_env_var" (
	"id" text PRIMARY KEY,
	"stack_resource_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"is_secret" boolean DEFAULT true NOT NULL,
	"sealed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "stack_env_var_unique" ON "stack_env_var" ("stack_resource_id","key");--> statement-breakpoint
CREATE INDEX "stack_env_var_stack_resource_id_idx" ON "stack_env_var" ("stack_resource_id");--> statement-breakpoint
ALTER TABLE "stack_env_var" ADD CONSTRAINT "stack_env_var_stack_resource_id_compose_resource_resource_id_fkey" FOREIGN KEY ("stack_resource_id") REFERENCES "compose_resource"("resource_id") ON DELETE CASCADE;--> statement-breakpoint
-- Data: give each stack its own copy of the project variables only IT uses.
--
-- COPY, never move, and never rewrite a value. Every stack still resolves
-- exactly the value it resolved before this migration (the copy shadows an
-- identical project row), so nothing a running stack depends on changes. The
-- project row stays: a service may reach it through `${{project.KEY}}`, and
-- those references sit inside encrypted service env values this statement
-- cannot read. `value` is copied verbatim (ciphertext stays ciphertext: the
-- env-vars envelope is bound to its domain, not to a table or row).
--
-- "Only it uses" = the key appears as a `${KEY}` reference in exactly one
-- stack of the project: in its compose file, or in a supporting file the stack
-- interpolates. A key two stacks reference is left shared in the project bag,
-- where both keep reading it; neither can rotate it any more, because a stack
-- install now writes its own bag. The bag a stack read until now is the
-- project's MAIN environment (`project.environment_id`), whatever the stack's
-- own stamp, so that is the bag copied from. `(?<!\$)` skips compose's `$${X}`
-- escape, which is a literal, not a reference.
WITH "stack_ref" AS (
	SELECT DISTINCT
		"cr"."resource_id" AS "stack_resource_id",
		"r"."project_id" AS "project_id",
		"p"."environment_id" AS "environment_id",
		"m"[1] AS "key"
	FROM "compose_resource" "cr"
	JOIN "resource" "r" ON "r"."id" = "cr"."resource_id"
	JOIN "project" "p" ON "p"."id" = "r"."project_id"
	CROSS JOIN LATERAL regexp_matches(
		coalesce("cr"."compose_content", '') || E'\n' || coalesce((
			SELECT string_agg("f"->>'content', E'\n')
			FROM jsonb_array_elements("cr"."files") AS "f"
			WHERE coalesce(("f"->>'interpolate')::boolean, false)
		), ''),
		'(?<!\$)\$\{([A-Za-z_][A-Za-z0-9_]*)',
		'g'
	) AS "m"
	WHERE "p"."environment_id" IS NOT NULL
),
"exclusive_ref" AS (
	SELECT "sr".*
	FROM "stack_ref" "sr"
	WHERE NOT EXISTS (
		SELECT 1 FROM "stack_ref" "other"
		WHERE "other"."project_id" = "sr"."project_id"
			AND "other"."key" = "sr"."key"
			AND "other"."stack_resource_id" <> "sr"."stack_resource_id"
	)
)
INSERT INTO "stack_env_var" ("id", "stack_resource_id", "key", "value", "is_secret", "sealed", "created_at", "updated_at")
SELECT
	'stenv_' || replace(gen_random_uuid()::text, '-', ''),
	"er"."stack_resource_id",
	"pev"."key",
	"pev"."value",
	"pev"."is_secret",
	"pev"."sealed",
	"pev"."created_at",
	now()
FROM "exclusive_ref" "er"
JOIN "project_env_var" "pev"
	ON "pev"."project_id" = "er"."project_id"
	AND "pev"."environment_id" = "er"."environment_id"
	AND "pev"."key" = "er"."key"
ON CONFLICT ("stack_resource_id", "key") DO NOTHING;
