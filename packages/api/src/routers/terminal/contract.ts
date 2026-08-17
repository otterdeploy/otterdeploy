import { oc } from "@orpc/contract";
/**
 * Discovery contract for the in-app terminal picker. Returns the set of
 * targets the operator can attach a shell to right now. Exec containers
 * + database consoles. SSH targets live on `server.list` (org-wide nodes).
 */
import { FRAMEWORK_KINDS } from "@otterdeploy/shared/framework";
import { ID_PREFIX, zSlug } from "@otterdeploy/shared/id";
import * as z from "zod";

import { projectIdField, resourceIdField } from "../project/contract/shared";

const tag = "terminal";
const basePath = "/terminal";

const terminalContainerSchema = z.object({
  /** Container id, passed to `terminal.mintTicket` (od-5j8.9), whose ticket
   *  then opens the /pty exec. */
  containerId: z.string(),
  /** Server-resolved project ownership used for capability scoping. */
  projectId: projectIdField,
  /** Display name (last segment of docker Names, slash-stripped). */
  name: z.string(),
  /** Image string for context display under the container row. */
  image: z.string(),
  /** Docker state ("running", "exited", …). Only "running" can be exec'd. */
  state: z.string(),
  /** otterdeploy.resource.type label value (drives picker grouping). */
  resourceType: z.enum(["service", "postgres", "redis", "mariadb", "mongodb"]),
  /** Detected framework for source-built services — the picker's icon
   *  fallback when the image ref resolves no brand mark. Null for databases
   *  and for services never built / not detected. */
  framework: z.enum(FRAMEWORK_KINDS).nullable(),
  /** Project slug (otterdeploy.project label). May be null on legacy rows. */
  projectSlug: zSlug(ID_PREFIX.project).nullable(),
  /** Friendly project name resolved from the DB. Null if the project slug
   *  isn't an active project in this org. */
  projectName: z.string().nullable(),
  /** Resource id (otterdeploy.resource.id label). Services only. */
  serviceResourceId: resourceIdField.nullable(),
  /** Swarm service name: the part before the .slot.taskId suffix. */
  serviceName: z.string().nullable(),
  /** Replica slot ("1", "2", …) parsed out of the swarm task name. */
  replicaSlot: z.string().nullable(),
});

const terminalDatabaseSchema = z.object({
  resourceId: resourceIdField,
  name: z.string(),
  engine: z.string(),
  projectSlug: zSlug(ID_PREFIX.project),
  projectName: z.string(),
});

const terminalTargetsSchema = z.object({
  containers: z.array(terminalContainerSchema),
  databases: z.array(terminalDatabaseSchema),
});

// GET input must be object/any/unknown for the OpenAPI generator; optional
// empty object keeps "no input" valid.
const listTargetsInput = z.object({}).optional();

// ---------------------------------------------------------------------------
// od-5j8.9: step-up + single-use ticket contracts for the /pty WS upgrade.
// The WS upgrade itself takes no target/credential input anymore: the ticket
// (minted here) is the only thing it accepts, and the ticket already carries
// the authorized target.
// ---------------------------------------------------------------------------

const shellTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("container"), containerId: z.string().min(1) }),
  z.object({ kind: z.literal("host") }),
]);

const stepUpInput = z.object({
  /** Required when the account has an authenticator app enabled. */
  totpCode: z
    .string()
    .regex(/^\d{6}(\d{2})?$/, "Enter the current authenticator code.")
    .optional(),
  /** Required otherwise. */
  password: z.string().min(1, "Enter your password.").optional(),
});

const stepUpOutput = z.object({
  /** ISO timestamp: the step-up grant is valid for minting tickets until
   *  this instant. */
  grantedUntil: z.string(),
});

const stepUpErrors = {
  INTERACTIVE_SESSION_REQUIRED: {
    status: 403,
    message: "Sign in with a browser session to open a shell." as const,
  },
  TWO_FACTOR_CODE_REQUIRED: {
    status: 400,
    message: "Enter the current authenticator code." as const,
  },
  PASSWORD_REQUIRED: {
    status: 400,
    message: "Enter your password." as const,
  },
  INVALID_STEP_UP: {
    status: 403,
    message: "That code or password is incorrect." as const,
  },
};

const mintTicketInput = z.object({ target: shellTargetSchema });

const mintTicketOutput = z.object({
  /** Single-use, presented once as `/pty?ticket=…`, then burned. */
  ticket: z.string(),
  expiresAt: z.string(),
});

const mintTicketErrors = {
  INTERACTIVE_SESSION_REQUIRED: {
    status: 403,
    message: "Sign in with a browser session to open a shell." as const,
  },
  STEP_UP_REQUIRED: {
    status: 412,
    message: "Re-authenticate to open a shell." as const,
  },
  FORBIDDEN: {
    status: 403,
    message: "You are not authorized to open a shell on that target." as const,
  },
  NOT_FOUND: {
    status: 404,
    message: "Target not found." as const,
  },
};

export const terminalContract = {
  targets: oc
    .meta({ path: `${basePath}/targets`, tag, method: "GET" })
    .input(listTargetsInput)
    .output(terminalTargetsSchema),
  /** Step-up re-authentication (password or TOTP, whichever the account
   *  uses). Grants a short window (see authz/step-up.ts) in which
   *  `mintTicket` will succeed without asking again. */
  stepUp: oc
    .errors(stepUpErrors)
    .meta({ path: `${basePath}/step-up`, tag, method: "POST" })
    .input(stepUpInput)
    .output(stepUpOutput),
  /** Mint a single-use, target-bound ticket for the /pty WS upgrade. Requires
   *  an interactive session with a live step-up grant. */
  mintTicket: oc
    .errors(mintTicketErrors)
    .meta({ path: `${basePath}/ticket`, tag, method: "POST" })
    .input(mintTicketInput)
    .output(mintTicketOutput),
};
