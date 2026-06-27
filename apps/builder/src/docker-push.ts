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
 *
 * Returns the pushed image's content digest (`sha256:…`), read back from the
 * local daemon's `RepoDigests` after the push lands. Null when it can't be
 * determined — digest capture is best-effort and never fails a good push.
 */

import type { LogSink } from "./log-stream";

import { runProcess } from "./run-process";

export interface PushCredentials {
  host: string;
  username: string;
  password: string;
}

export interface PushResult {
  /** Content digest of the pushed image (`sha256:…`), or null if unread. */
  digest: string | null;
}

export async function dockerPush(opts: {
  tags: string[];
  credentials: PushCredentials;
  sink: LogSink;
}): Promise<PushResult> {
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
    return { digest: await readDigest(opts.tags[0], opts.sink) };
  } finally {
    await runProcess({
      cmd: "docker",
      args: ["logout", ...(loginHost ? [loginHost] : [])],
      sink: opts.sink,
      echo: false,
    }).catch(() => undefined);
  }
}

/**
 * Read the pushed image's content digest from the local daemon. After a push,
 * docker records `<repo>@sha256:…` in the image's `RepoDigests`; we pull the
 * `sha256:…` portion out. Best-effort: any failure (no match, inspect error)
 * returns null rather than failing the build — the digest is metadata, the
 * push already succeeded.
 */
async function readDigest(tag: string | undefined, sink: LogSink): Promise<string | null> {
  if (!tag) return null;
  const inspect = await runProcess({
    cmd: "docker",
    args: ["inspect", "--format", '{{join .RepoDigests "\\n"}}', tag],
    sink,
    echo: false,
  }).catch(() => null);
  if (!inspect || inspect.exitCode !== 0) return null;
  // RepoDigests entries look like `registry/repo@sha256:abc…`. We take the
  // first sha256 found — with one registry per tag (our case) that's the only
  // entry; this is a best-effort fallback if there were ever several.
  const match = inspect.tail.match(/@(sha256:[a-f0-9]{64})/);
  return match?.[1] ?? null;
}
