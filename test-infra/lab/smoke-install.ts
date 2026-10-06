/**
 * Smoke steps b and c: the real public installer on cp, then the first admin
 * through the real bootstrap flow, then /health and a fresh sign-in.
 */
import { Result } from "better-result";
import * as z from "zod";

import type { SmokeContext } from "./smoke-context";

import { sessionSchema } from "./product";
import { LabError, type LabResult } from "./support";

/** The documented install command (apps/www/content/docs/start/install.mdx), with
 *  the installer's unattended flag (scripts/install.sh `-y/--yes`). */
export const INSTALL_COMMAND =
  "curl -fsSL https://get.otterdeploy.com/install.sh | bash -s -- --yes";
const INSTALL_DIR = "/data/otterdeploy/platform/source";

export async function installOtterdeploy(ctx: SmokeContext): Promise<LabResult<string>> {
  const { ssh, evidence, cpNode } = ctx;
  evidence.log(`running on cp: ${INSTALL_COMMAND}`);
  const run = await ssh.exec(cpNode.ipv4, INSTALL_COMMAND, 30 * 60_000);
  if (run.isErr()) return Result.err(run.error);
  evidence.write(
    "installer-terminal.log",
    `$ ${INSTALL_COMMAND}\n${run.value.stdout}\n--- stderr ---\n${run.value.stderr}`,
  );
  const log = await ssh.exec(cpNode.ipv4, `cat ${INSTALL_DIR}/install-*.log`, 60_000);
  if (log.isOk()) evidence.write("installer.log", log.value.stdout);
  if (run.value.code !== 0) {
    const tail = `${run.value.stdout}\n${run.value.stderr}`
      .trim()
      .split("\n")
      .slice(-20)
      .join("\n");
    return Result.err(
      new LabError(
        "install",
        `installer exited ${run.value.code}:\n${evidence.redactor.redact(tail)}`,
      ),
    );
  }
  const version = await ssh.must(
    cpNode.ipv4,
    `sed -n 's/^OTTERDEPLOY_VERSION=//p' ${INSTALL_DIR}/.env`,
  );
  if (version.isErr()) return Result.err(version.error);
  ctx.installedVersion = version.value.trim();
  return Result.ok(ctx.installedVersion);
}

export async function bootstrapAdmin(ctx: SmokeContext): Promise<LabResult<string>> {
  const { ssh, evidence, cp, cpNode } = ctx;
  // Read straight into memory; registered with the redactor before anything
  // could print it.
  const token = await ssh.must(
    cpNode.ipv4,
    `sed -n 's/^OTTERDEPLOY_BOOTSTRAP_TOKEN=//p' ${INSTALL_DIR}/.env`,
  );
  if (token.isErr()) return Result.err(token.error);
  const bootstrapToken = token.value.trim();
  if (bootstrapToken.length === 0)
    return Result.err(new LabError("bootstrap", "no bootstrap token in .env"));
  evidence.redactor.add(bootstrapToken);

  const config = await cp.auth("/public-config").then((r) => r.unwrapOr(null));
  if (config) evidence.json("api-public-config-before.json", config.json);

  // Without the token first: a fresh install must refuse.
  const refused = await cp.auth("/sign-up/email", {
    email: `intruder@${ctx.domain}`,
    password: ctx.password,
    name: "Intruder",
  });
  evidence.json(
    "api-sign-up-without-token.json",
    refused.isErr() ? { refused: refused.error.message } : refused.value,
  );
  if (refused.isOk())
    return Result.err(
      new LabError("bootstrap", "sign-up WITHOUT the bootstrap token was accepted"),
    );

  const signUp = await cp.auth(
    "/sign-up/email",
    { email: ctx.email, password: ctx.password, name: "Lab Owner" },
    { "x-otterdeploy-bootstrap-token": bootstrapToken },
  );
  if (signUp.isErr()) return Result.err(signUp.error);
  evidence.json("api-sign-up.json", signUp.value);

  const org = await cp.auth("/organization/create", {
    name: "Otter Lab",
    slug: `lab-${ctx.state.run}`,
  });
  if (org.isErr()) return Result.err(org.error);
  evidence.json("api-organization-create.json", org.value);
  const orgId = z.object({ id: z.string() }).safeParse(org.value.json);
  if (!orgId.success)
    return Result.err(new LabError("bootstrap", "organization/create returned no id"));
  const active = await cp.auth("/organization/set-active", { organizationId: orgId.data.id });
  if (active.isErr()) return Result.err(active.error);
  return Result.ok(orgId.data.id);
}

export async function healthAndSignIn(ctx: SmokeContext): Promise<LabResult<string>> {
  const { cp, evidence } = ctx;
  const health = await cp.getJson("/health");
  if (health.isErr()) return Result.err(health.error);
  evidence.json("api-health.json", health.value);
  const healthy = z
    .object({ ok: z.literal(true), version: z.string() })
    .safeParse(health.value.json);
  if (health.value.status !== 200 || !healthy.success) {
    return Result.err(
      new LabError(
        "health",
        `/health ${health.value.status}: ${JSON.stringify(health.value.json)}`,
      ),
    );
  }

  cp.clearSession();
  const signIn = await cp.auth("/sign-in/email", { email: ctx.email, password: ctx.password });
  if (signIn.isErr()) return Result.err(signIn.error);
  evidence.json("api-sign-in.json", signIn.value);
  const session = await cp.auth("/get-session");
  if (session.isErr()) return Result.err(session.error);
  evidence.json("api-get-session.json", session.value);
  const parsed = sessionSchema.safeParse(session.value.json);
  if (!parsed.success)
    return Result.err(new LabError("sign-in", "get-session returned no session"));
  if (parsed.data.user.email !== ctx.email)
    return Result.err(new LabError("sign-in", "session is for another user"));
  if (!parsed.data.session.activeOrganizationId) {
    return Result.err(new LabError("sign-in", "signed-in session has no active organization"));
  }
  return Result.ok(
    `health ok (version ${healthy.data.version}), signed in as ${parsed.data.user.email}`,
  );
}
