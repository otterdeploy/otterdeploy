/**
 * What a host needs to join an otterd install, for the enroll command the
 * dashboard prints: the control URL, the SHA-256 pin of the control plane's
 * private CA, the control plane's signing key and a single-use token. The CA
 * and the key are read from the files the installer wrote under the data
 * folder; nothing secret leaves them.
 */
import { env } from "@otterdeploy/env/server";
import { DATA_ROOT } from "@otterdeploy/shared/paths";
import { Temporal } from "@otterdeploy/shared/temporal";
import { Result } from "better-result";
import { createHash, X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createEnrollToken } from "./registry";

export interface OtterdJoin {
  controlUrl: string;
  /** SHA-256 of the CA certificate's DER encoding, hex. */
  caPin: string;
  cpKey: string;
  token: string;
  /** The installer of this platform release, which pins the matching otterd. */
  installerUrl: string;
}

/** Node roles a dashboard enrollment role grants. */
const ROLES: Record<string, string[]> = {
  manager: ["worker", "edge"],
  worker: ["worker"],
};

const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** The installer of this release (pinned path), or the newest one. */
function installerUrl(): string {
  const v = env.OTTERDEPLOY_VERSION;
  return `${env.OTTERDEPLOY_GET_ORIGIN}${RELEASE_TAG.test(v) ? `/${v}` : ""}/install.sh`;
}

export async function otterdJoin(role: string): Promise<Result<OtterdJoin, string>> {
  const controlUrl = env.OTTERD_CP_CONTROL_URL;
  if (!controlUrl) return Result.err("OTTERD_CP_CONTROL_URL is not set for the otterd runtime");
  const dir = join(DATA_ROOT, "otterd-cp");
  const files = await Result.tryPromise({
    try: () =>
      Promise.all([
        readFile(join(dir, "ca.pem"), "utf8"),
        readFile(join(dir, "signing.pub"), "utf8"),
      ]),
    catch: (cause) => `the otterd control plane's CA or key is not readable: ${String(cause)}`,
  });
  if (files.isErr()) return Result.err(files.error);
  const [caPem, cpKey] = files.value;
  const ca = Result.try({
    try: () => new X509Certificate(caPem),
    catch: () => "the otterd control plane's CA is not a certificate",
  });
  if (ca.isErr()) return Result.err(ca.error);
  const token = await createEnrollToken(
    { roles: ROLES[role] ?? ["worker"], labels: {}, ttlMs: 30 * 60_000, by: "dashboard" },
    Temporal.Now.instant().epochMilliseconds,
  );
  if (token.isErr()) return Result.err(token.error.message);
  return Result.ok({
    controlUrl,
    caPin: createHash("sha256").update(ca.value.raw).digest("hex"),
    cpKey: cpKey.trim(),
    token: token.value.token,
    installerUrl: installerUrl(),
  });
}
