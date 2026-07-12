/**
 * oRPC contract for `type: compose` resources — a Docker Compose stack. See
 * docs/designs/compose.md.
 */
import { oc } from "@orpc/contract";
import * as z from "zod";

import { projectIdField, resourceIdField } from "../project/contract/shared";

const tag = "compose";
const basePath = "/projects/{projectId}/compose";

const composeServiceSummarySchema = z.object({
  name: z.string(),
  image: z.string().nullable(),
  hasBuild: z.boolean(),
  ports: z.array(z.number()),
  // Older rows (pre-volumes) won't carry this — default to [] so the view
  // validates against historical data without a migration.
  volumes: z.array(z.string()).default([]),
});

const composeExposedSchema = z.object({
  service: z.string(),
  port: z.number().int(),
  domain: z.string(),
});

const composeViewSchema = z.object({
  resourceId: resourceIdField,
  name: z.string(),
  source: z.enum(["inline", "git"]),
  composeContent: z.string().nullable(),
  stackName: z.string(),
  services: z.array(composeServiceSummarySchema),
  /** Which service:port pairs are published, and on what domain. */
  exposed: z.array(composeExposedSchema).default([]),
});

/** Stateless parse for the wizard preview — never touches the DB. */
const parsePreviewSchema = z.object({
  valid: z.boolean(),
  error: z.string().nullable(),
  /** 1-based line/column of a YAML syntax error, when known. */
  errorLine: z.number().nullable(),
  errorColumn: z.number().nullable(),
  /** Compose's top-level `name:`, if the file declares one. */
  name: z.string().nullable(),
  /** `${VAR}` refs the file uses — the wizard asks the user to fill these in. */
  vars: z.array(z.object({ name: z.string(), default: z.string().nullable() })),
  services: z.array(composeServiceSummarySchema),
  warnings: z.array(z.string()),
});

const deployResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().nullable(),
  status: z.string(),
});

const sharedErrors = {
  NOT_FOUND: { status: 404, message: "Compose resource or project not found" as const },
  CONFLICT: { status: 409, message: "A resource with that name already exists" as const },
  INVALID_INPUT: { status: 422, message: "Invalid compose file" as const },
};

export const composeContract = {
  // Stateless: validate + summarize a pasted file for the wizard preview.
  parse: oc
    .meta({ path: `${basePath}/parse`, tag, method: "POST" })
    .input(z.object({ projectId: projectIdField, content: z.string() }))
    .output(parsePreviewSchema),

  list: oc
    .meta({ path: basePath, tag, method: "GET" })
    .input(z.object({ projectId: projectIdField }))
    .output(z.array(composeViewSchema)),

  get: oc
    .errors({ NOT_FOUND: sharedErrors.NOT_FOUND })
    .meta({ path: `${basePath}/{resourceId}`, tag, method: "GET" })
    .input(z.object({ projectId: projectIdField, resourceId: resourceIdField }))
    .output(composeViewSchema),

  create: oc
    .errors({
      NOT_FOUND: sharedErrors.NOT_FOUND,
      CONFLICT: sharedErrors.CONFLICT,
      INVALID_INPUT: sharedErrors.INVALID_INPUT,
    })
    .meta({ path: basePath, tag, method: "POST" })
    .input(
      z.object({
        projectId: projectIdField,
        /** Optional — derived from the file's `name:` / first service / repo. */
        name: z.string().max(63).optional(),
        /** `inline` = paste the file; `git` = build it from the project repo. */
        source: z.enum(["inline", "git"]).default("inline"),
        /** Required for `inline` (single-file). */
        composeContent: z.string().optional(),
        /** Multi-file inline stack: the compose file + supporting files
         *  (Dockerfiles/build contexts, env_file targets, bind-mounted scripts).
         *  When set, `composePath` names which entry is the compose file. */
        files: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
        /** Bound repo id (git source) — the repo picker's selection. Clones via
         *  the GitHub App installation token, so private repos work. Preferred
         *  over `gitRepoUrl`. */
        gitRepoId: z.string().optional(),
        /** Public GitHub repo URL (git source) — legacy paste path; used when no
         *  `gitRepoId` is bound. */
        gitRepoUrl: z.string().optional(),
        /** Branch (git source; default the repo's main). */
        gitRef: z.string().optional(),
        /** Path to the compose file within `sourceSubdir` (git source; default
         *  auto-detect compose.yml / docker-compose.yml). */
        composePath: z.string().optional(),
        /** Root directory within the repo the stack builds from (git source;
         *  the compose file + `build:` contexts resolve relative to it). */
        sourceSubdir: z.string().optional(),
        /** Values for the file's `${VAR}` refs — written as project variables. */
        variables: z
          .array(
            z.object({
              key: z.string(),
              value: z.string(),
              secret: z.boolean().optional(),
            }),
          )
          .default([]),
        /** `service:port` pairs to publish a domain for. */
        exposed: z.array(z.object({ service: z.string(), port: z.number().int() })).default([]),
        /** Deploy immediately after create (default true). */
        deploy: z.boolean().default(true),
      }),
    )
    .output(
      z.object({
        resourceId: resourceIdField,
        services: z.array(composeServiceSummarySchema),
        warnings: z.array(z.string()),
        deploy: deployResultSchema,
      }),
    ),

  redeploy: oc
    .errors({ NOT_FOUND: sharedErrors.NOT_FOUND })
    .meta({ path: `${basePath}/{resourceId}/redeploy`, tag, method: "POST" })
    .input(z.object({ projectId: projectIdField, resourceId: resourceIdField }))
    .output(deployResultSchema),

  delete: oc
    .errors({ NOT_FOUND: sharedErrors.NOT_FOUND })
    .meta({ path: `${basePath}/{resourceId}`, tag, method: "DELETE" })
    .input(z.object({ projectId: projectIdField, resourceId: resourceIdField }))
    .output(z.object({ ok: z.boolean() })),

  // Replace the stored compose YAML of an INLINE stack, re-parse it, and keep
  // the project manifest in lockstep. Takes effect on the next redeploy. Git
  // stacks are rejected — their file lives in the repo.
  updateContent: oc
    .errors({
      NOT_FOUND: sharedErrors.NOT_FOUND,
      INVALID_INPUT: sharedErrors.INVALID_INPUT,
    })
    .meta({ path: `${basePath}/{resourceId}/content`, tag, method: "POST" })
    .input(
      z.object({
        projectId: projectIdField,
        resourceId: resourceIdField,
        composeContent: z.string().min(1),
      }),
    )
    .output(composeViewSchema),

  // Replace which service:port pairs are publicly exposed on a LIVE stack —
  // re-mints the Caddy routes without re-staging the manifest.
  setExposed: oc
    .errors({ NOT_FOUND: sharedErrors.NOT_FOUND })
    .meta({ path: `${basePath}/{resourceId}/exposed`, tag, method: "POST" })
    .input(
      z.object({
        projectId: projectIdField,
        resourceId: resourceIdField,
        exposed: z.array(
          z.object({
            service: z.string(),
            port: z.number().int(),
            domain: z.string().default(""),
          }),
        ),
      }),
    )
    .output(composeViewSchema),
};
