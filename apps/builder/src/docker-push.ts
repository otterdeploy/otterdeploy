/**
 * Push a built image to its registry using credentials resolved from
 * the org's `container_registry` row.
 *
 * The push path is two steps:
 *   1. `docker login <host> -u <user> --password-stdin`
 *      Password goes over stdin so it never appears on argv or in env.
 *   2. `docker push <tag>` for each tag.
 *
 * `docker logout` runs unconditionally at the end so the credential
 * store on the builder host doesn't accumulate per-org tokens.
 */

import type { LogSink } from "./log-stream";
import { runProcess } from "./run-process";

export interface PushCredentials {
  host: string;
  username: string;
  password: string;
}

export async function dockerPush(opts: {
  tags: string[];
  credentials: PushCredentials;
  sink: LogSink;
}): Promise<void> {
  const { host, username, password } = opts.credentials;
  const loginHost = host === "docker.io" ? "" : host;

  opts.sink.system(`logging in to ${host} as ${username}`);
  const login = await runProcess({
    cmd: "docker",
    args: ["login", ...(loginHost ? [loginHost] : []), "-u", username, "--password-stdin"],
    sink: opts.sink,
    secrets: [password],
    stdin: password,
  });
  if (login.exitCode !== 0) {
    throw new Error(`docker login ${host} failed (exit ${login.exitCode})`);
  }

  try {
    for (const tag of opts.tags) {
      opts.sink.system(`pushing ${tag}`);
      const push = await runProcess({
        cmd: "docker",
        args: ["push", tag],
        sink: opts.sink,
        secrets: [password],
      });
      if (push.exitCode !== 0) {
        throw new Error(`docker push ${tag} failed (exit ${push.exitCode})`);
      }
    }
  } finally {
    await runProcess({
      cmd: "docker",
      args: ["logout", ...(loginHost ? [loginHost] : [])],
      sink: opts.sink,
      echo: false,
    }).catch(() => undefined);
  }
}
