/**
 * Smoke steps b and c: the real public installer on cp, then the first admin
 * through the real bootstrap flow, then /health and a fresh sign-in.
 */
import { Result } from "better-result";
import * as z from "zod";

import type { SmokeContext } from "./smoke-context";

import { sessionSchema } from "./product";
import { describeCause, LabError, type LabResult } from "./support";

/** The documented install command (apps/www/content/docs/start/install.mdx), with
 *  the installer's unattended flag (scripts/install.sh `-y/--yes`). */
export const INSTALL_COMMAND =
  "curl -fsSL https://get.otterdeploy.com/install.sh | bash -s -- --yes";
const INSTALL_DIR = "/data/otterdeploy/platform/source";

/**
 * How the installer is run on cp.
 *
 * "terminal" (default): inside an interactive SSH session with a TTY, which is
 * what an operator following the docs has. The installer then prints the
 * bootstrap token to that terminal; it is registered with the redactor before
 * any of the output is written anywhere.
 *
 * "unattended": no TTY (CI, cloud-init, `ssh host cmd`). As of v0.21.0 the
 * installer brings the stack up and then exits 1 in report_bootstrap_token:
 * `[ -w /dev/tty ]` passes without a controlling terminal, the redirect to
 * /dev/tty fails with ENXIO, and set -e aborts (misattributed to the CrowdSec
 * bouncer step). Kept selectable so that finding can be re-checked.
 */
export type InstallMode = "terminal" | "unattended";

async function readBootstrapToken(ctx: SmokeContext): Promise<LabResult<string>> {
  // Straight into memory, and registered with the redactor before anything
  // that might contain it is printed or written.
  const token = await ctx.ssh.must(
    ctx.cpNode.ipv4,
    `sed -n 's/^OTTERDEPLOY_BOOTSTRAP_TOKEN=//p' ${INSTALL_DIR}/.env`,
  );
  if (token.isErr()) return Result.err(token.error);
  const value = token.value.trim();
  if (value.length === 0)
    return Result.err(new LabError("bootstrap", "no bootstrap token in .env"));
  ctx.evidence.redactor.add(value);
  ctx.bootstrapToken = value;
  return Result.ok(value);
}

/** Where `--installer <path>` puts the local script on cp. */
const UPLOADED_INSTALLER = "/root/otterdeploy-install.sh";

/**
 * The command to run on cp. Default: the public one. With `--installer <path>`
 * the local script is uploaded first and piped into bash with the SAME flags,
 * so stdin is a pipe exactly as under `curl | bash` (only the script's source
 * differs; images, compose and the release lookup are the published ones).
 */
async function installCommand(ctx: SmokeContext): Promise<LabResult<string>> {
  const path = ctx.localInstaller;
  if (!path) return Result.ok(INSTALL_COMMAND);
  const script = await Result.tryPromise({
    try: () => Bun.file(path).text(),
    catch: (cause) => new LabError("installer", `cannot read ${path}: ${describeCause(cause)}`),
  });
  if (script.isErr()) return Result.err(script.error);
  const sha256 = new Bun.CryptoHasher("sha256").update(script.value).digest("hex");
  const uploaded = await ctx.ssh.exec(
    ctx.cpNode.ipv4,
    `umask 077 && cat > ${UPLOADED_INSTALLER} && sha256sum ${UPLOADED_INSTALLER}`,
    60_000,
    script.value,
  );
  if (uploaded.isErr()) return Result.err(uploaded.error);
  if (uploaded.value.code !== 0 || !uploaded.value.stdout.startsWith(sha256)) {
    return Result.err(new LabError("installer", `upload failed: ${uploaded.value.stderr}`));
  }
  ctx.evidence.log(`uploaded local installer ${path} (sha256 ${sha256})`);
  return Result.ok(`cat ${UPLOADED_INSTALLER} | bash -s -- --yes`);
}

export async function installOtterdeploy(ctx: SmokeContext): Promise<LabResult<string>> {
  const { ssh, evidence, cpNode } = ctx;
  const command = await installCommand(ctx);
  if (command.isErr()) return Result.err(command.error);
  const installCmd = command.value;
  evidence.log(`running on cp (${ctx.installMode}): ${installCmd}`);
  const run =
    ctx.installMode === "terminal"
      ? await ssh.execInTerminal(cpNode.ipv4, installCmd, 30 * 60_000)
      : await ssh.exec(cpNode.ipv4, installCmd, 30 * 60_000);
  if (run.isErr()) return Result.err(run.error);
  // Before any output is persisted: the terminal transcript carries the token.
  const token = await readBootstrapToken(ctx);
  const transcript = `${run.value.stdout}\n--- stderr ---\n${run.value.stderr}`;
  evidence.write(
    "installer-terminal.log",
    `$ ${installCmd}  (mode: ${ctx.installMode})\n${transcript}`,
  );
  const hint = transcript.includes("First-account bootstrap token is in");
  evidence.log(`installer exited ${run.value.code} (env-file token hint printed: ${hint})`);
  const log = await ssh.exec(cpNode.ipv4, `cat ${INSTALL_DIR}/install-*.log`, 60_000);
  if (log.isOk()) evidence.write("installer.log", log.value.stdout);
  if (run.value.code !== 0) {
    const tail = transcript.trim().split("\n").slice(-20).join("\n");
    return Result.err(
      new LabError(
        "install",
        `installer exited ${run.value.code}:\n${evidence.redactor.redact(tail)}`,
      ),
    );
  }
  if (token.isErr()) return Result.err(token.error);
  const version = await ssh.must(
    cpNode.ipv4,
    `sed -n 's/^OTTERDEPLOY_VERSION=//p' ${INSTALL_DIR}/.env`,
  );
  if (version.isErr()) return Result.err(version.error);
  ctx.installedVersion = version.value.trim();
  return Result.ok(ctx.installedVersion);
}

export async function bootstrapAdmin(ctx: SmokeContext): Promise<LabResult<string>> {
  const { evidence, cp } = ctx;
  const bootstrapToken = ctx.bootstrapToken ?? (await readBootstrapToken(ctx)).unwrapOr(null);
  if (!bootstrapToken)
    return Result.err(new LabError("bootstrap", "could not read the bootstrap token"));

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
