/**
 * Ask a public Git remote which branch its HEAD points at, over Git's own
 * smart-HTTP protocol. No provider API and no git binary: one small POST of a
 * protocol-v2 `ls-refs` command, which GitHub, GitLab, Gitea/Forgejo and any
 * stock `git http-backend` answer with `<sha> HEAD symref-target:refs/heads/<b>`.
 * Unlike the GitHub REST API it is not charged against the 60 req/hr
 * anonymous budget the wizard's tree inspection already spends.
 *
 * A server that does not speak protocol v2 gets one fallback: the v0 ref
 * advertisement (`GET info/refs?service=git-upload-pack`), whose first line
 * carries `symref=HEAD:refs/heads/<b>` in its capability list.
 *
 * Best effort by design: any failure (egress policy, timeout, non-git host,
 * unparsable reply) resolves to null and the caller keeps its fallback.
 * Every request goes through `ghFetch`, the SSRF-hardened egress path.
 */

import { Result } from "better-result";

import { ghFetch } from "./github-app";

/** One pkt-line: 4 hex digits of total length (header included), then data. */
function pktLine(data: string): string {
  return `${(data.length + 4).toString(16).padStart(4, "0")}${data}`;
}

const LS_REFS_HEAD_REQUEST =
  pktLine("command=ls-refs\n") +
  "0001" +
  pktLine("symrefs\n") +
  pktLine("ref-prefix HEAD\n") +
  "0000";

/** A branch name we are willing to store: git's own rules are looser, but a
 *  name with whitespace or ref-forbidden characters is a parse error. */
const BRANCH_NAME = /^[^\s~^:?*[\\]{1,255}$/;

function cleanBranch(raw: string | undefined): string | null {
  if (!raw || !BRANCH_NAME.test(raw)) return null;
  return raw;
}

/** `<sha> HEAD symref-target:refs/heads/<branch>` from a v2 ls-refs reply. */
export function parseLsRefsHead(body: string): string | null {
  const match = /\bHEAD symref-target:refs\/heads\/(\S+)/.exec(body);
  return cleanBranch(match?.[1]);
}

/** `symref=HEAD:refs/heads/<branch>` from a v0 ref advertisement. */
export function parseAdvertisedHead(body: string): string | null {
  const match = /\bsymref=HEAD:refs\/heads\/(\S+)/.exec(body);
  return cleanBranch(match?.[1]);
}

function serviceUrl(cloneUrl: string, suffix: string): string | null {
  const parsed = Result.try(() => new URL(cloneUrl));
  if (parsed.isErr()) return null;
  const url = parsed.value;
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${suffix}`;
  return url.toString();
}

/** The body of a 2xx reply, or null for any failure (egress refusal, timeout,
 *  non-2xx, unreadable body). */
async function readOk(
  request: () => Promise<{ ok: boolean; text(): Promise<string> }>,
): Promise<string | null> {
  const body = await Result.tryPromise({
    try: async () => {
      const res = await request();
      return res.ok ? await res.text() : null;
    },
    catch: (cause) => cause,
  });
  return body.isOk() ? body.value : null;
}

async function lsRefsHead(cloneUrl: string): Promise<string | null> {
  const url = serviceUrl(cloneUrl, "git-upload-pack");
  if (!url) return null;
  const body = await readOk(() =>
    ghFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-git-upload-pack-request",
        Accept: "application/x-git-upload-pack-result",
        "Git-Protocol": "version=2",
        "User-Agent": "git/otterdeploy",
      },
      body: LS_REFS_HEAD_REQUEST,
    }),
  );
  return body === null ? null : parseLsRefsHead(body);
}

async function advertisedHead(cloneUrl: string): Promise<string | null> {
  const base = serviceUrl(cloneUrl, "info/refs");
  if (!base) return null;
  const url = `${base}?service=git-upload-pack`;
  const body = await readOk(() => ghFetch(url, { headers: { "User-Agent": "git/otterdeploy" } }));
  return body === null ? null : parseAdvertisedHead(body);
}

/** The remote's default branch (what its HEAD points at), or null when the
 *  remote cannot be asked. */
export async function resolveRemoteDefaultBranch(cloneUrl: string): Promise<string | null> {
  return (await lsRefsHead(cloneUrl)) ?? (await advertisedHead(cloneUrl));
}
