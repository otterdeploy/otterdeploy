/**
 * Push a built image to its registry using credentials resolved from
 * the org's `container_registry` row.
 *
 * `dockerLogin`/`dockerLogout`/`dockerPushTags` are the primitives — split out
 * so the pipeline can log in BEFORE building (needed when the build itself
 * pushes straight from the remote buildkitd via `--push`, see
 * `pipeline-steps.ts`'s `buildAndPublishImage`) instead of only after. `docker
 * login`'s password goes over stdin so it never appears on argv or in env.
 *
 * `dockerPush` composes all three for the LOAD-mode fallback path (no remote
 * buildkitd, or no registry benefit from pushing directly): login → push each
 * tag → logout, unconditionally, so the credential store on the builder host
 * never accumulates per-org tokens. Returns the pushed image's content digest
 * (`sha256:…`), read back from the local daemon's `RepoDigests` after the push
 * lands — null when it can't be determined (best-effort; never fails a good
 * push).
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

/** `docker login <host> -u <user> --password-stdin`. Throws on failure. */
export async function dockerLogin(credentials: PushCredentials, sink: LogSink): Promise<void> {
  const { host, username, password } = credentials;
  const loginHost = host === "docker.io" ? "" : host;
  sink.system(`logging in to ${host} as ${username}`);
  const login = await runProcess({
    cmd: "docker",
    args: ["login", ...(loginHost ? [loginHost] : []), "-u", username, "--password-stdin"],
    sink,
    secrets: [password],
    stdin: password,
  });
  if (login.exitCode !== 0) {
    throw new Error(`docker login ${host} failed (exit ${login.exitCode})`);
  }
}

/** `docker logout <host>`. Best-effort — never throws (a failed logout must
 *  never surface as a build/push failure). */
export async function dockerLogout(credentials: PushCredentials, sink: LogSink): Promise<void> {
  const loginHost = credentials.host === "docker.io" ? "" : credentials.host;
  await runProcess({
    cmd: "docker",
    args: ["logout", ...(loginHost ? [loginHost] : [])],
    sink,
    echo: false,
  }).catch(() => undefined);
}

/** `docker push <tag>` for each tag (assumes an active login), then reads the
 *  pushed digest back from the local daemon. Used only by the LOAD-mode
 *  fallback — the image must already be `--load`ed locally for `docker push`
 *  (and the `docker inspect` digest read) to have anything to act on. */
export async function dockerPushTags(opts: {
  tags: string[];
  sink: LogSink;
  /** Values to mask in logged command/output — pass the login password even
   *  though it's not on this command's argv, defensively. */
  secrets?: string[];
}): Promise<PushResult> {
  for (const tag of opts.tags) {
    opts.sink.system(`pushing ${tag}`);
    const push = await runProcess({
      cmd: "docker",
      args: ["push", tag],
      sink: opts.sink,
      secrets: opts.secrets,
    });
    if (push.exitCode !== 0) {
      throw new Error(`docker push ${tag} failed (exit ${push.exitCode})`);
    }
  }
  return { digest: await readDigest(opts.tags[0], opts.sink) };
}

export async function dockerPush(opts: {
  tags: string[];
  credentials: PushCredentials;
  sink: LogSink;
}): Promise<PushResult> {
  await dockerLogin(opts.credentials, opts.sink);
  try {
    return await dockerPushTags({
      tags: opts.tags,
      sink: opts.sink,
      secrets: [opts.credentials.password],
    });
  } finally {
    await dockerLogout(opts.credentials, opts.sink);
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
