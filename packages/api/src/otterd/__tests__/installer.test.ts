/**
 * The installer's otterd path, run as the shell it is: it installs only what
 * a release key embedded in the installer signed, refuses to run with no key
 * embedded, and ships the daemon's systemd unit verbatim.
 */
import { publicKeyFromSeed, sha256HexOf, signEnvelope } from "@otterdeploy/otterd-proto";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const ROOT = join(import.meta.dirname, "../../../../..");
const INSTALLER = join(ROOT, "scripts/install.sh");
const seed = new Uint8Array(32).fill(3);
const KEY = publicKeyFromSeed(seed);

/** Run `body` with the installer's functions loaded; returns exit code and output. */
function shell(body: string) {
  const p = Bun.spawnSync(
    ["bash", "-c", `OTTERDEPLOY_SOURCE_ONLY=1 source "${INSTALLER}"; ${body}`],
    { stdout: "pipe", stderr: "pipe" },
  );
  return { code: p.exitCode, out: `${p.stdout.toString()}${p.stderr.toString()}` };
}

/** A release directory with a signed manifest naming `binaries`. */
function release(signWith: Uint8Array, binaries: Record<string, Uint8Array>) {
  const dir = mkdtempSync(join(tmpdir(), "otterd-rel-"));
  mkdirSync(join(dir, "v0.3.0"));
  const manifest = {
    version: "0.3.0",
    artifacts: Object.entries(binaries).map(([name, bytes]) => ({
      ...(name === "otterd" ? {} : { name }),
      arch: "x86_64",
      sha256: sha256HexOf(bytes),
      size: bytes.length,
    })),
    protocol: { min: 1, max: 1 },
    journalFormat: 1,
    minRollbackVersion: "0.2.0",
    issuedAtUnixMs: 1_900_000_000_000,
  };
  const env = signEnvelope(
    signWith,
    "otterd/release-manifest/v1",
    new TextEncoder().encode(JSON.stringify(manifest)),
  );
  writeFileSync(join(dir, "v0.3.0/release.json"), JSON.stringify(env));
  for (const [name, bytes] of Object.entries(binaries)) {
    writeFileSync(join(dir, `v0.3.0/${name}-linux-x86_64`), bytes);
  }
  return dir;
}

const verify = (dir: string, keys: string) =>
  shell(
    `OTTERD_RELEASE_KEYS="${keys}"; otterd_verify_release "${dir}/v0.3.0/release.json" "${dir}/m.json" && jq -r .version "${dir}/m.json"`,
  );

describe("installer, otterd runtime", () => {
  it("refuses to run with no release key embedded", () => {
    const r = shell("RUNTIME=otterd; OTTERD_VERSION=0.3.0; otterd_require_release");
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("no release key embedded");
  });

  it("accepts a manifest signed by an embedded key, and nothing else", () => {
    const signed = release(seed, { otterd: new Uint8Array([1, 2, 3]) });
    expect(verify(signed, KEY)).toMatchObject({ code: 0, out: "0.3.0\n" });
    const other = release(new Uint8Array(32).fill(4), { otterd: new Uint8Array([1, 2, 3]) });
    expect(verify(other, KEY).code).not.toBe(0);
    const tampered = JSON.parse(readFileSync(join(signed, "v0.3.0/release.json"), "utf8"));
    tampered.payload = Buffer.from(
      Buffer.from(tampered.payload, "base64").toString().replace("0.3.0", "0.9.0"),
    ).toString("base64");
    writeFileSync(join(signed, "v0.3.0/release.json"), JSON.stringify(tampered));
    expect(verify(signed, KEY).code).not.toBe(0);
  });

  it("installs a binary only when it matches its signed entry, and never an unsigned one", () => {
    const good = new Uint8Array([9, 9, 9, 9]);
    const dir = release(seed, { otterd: good, "otterd-guard": new Uint8Array([7]) });
    const fetch = (name: string) =>
      shell(
        `OTTERD_RELEASE_KEYS="${KEY}"; OTTERD_VERSION=0.3.0; OTTERD_RELEASE_URL="file://${dir}"; otterd_arch() { printf x86_64; }
         otterd_verify_release "${dir}/v0.3.0/release.json" "${dir}/m.json" && otterd_fetch_binary "${dir}/m.json" ${name} "${dir}/out-${name}" && echo fetched`,
      );
    expect(fetch("otterd").out).toContain("fetched");
    expect(fetch("otterd-guard").out).toContain("fetched");
    const missing = fetch("otterd-dns");
    expect(missing.code).not.toBe(0);
    expect(missing.out).toContain("does not sign otterd-dns");
    writeFileSync(join(dir, "v0.3.0/otterd-linux-x86_64"), new Uint8Array([9, 9, 9, 8]));
    const swapped = fetch("otterd");
    expect(swapped.code).not.toBe(0);
    expect(swapped.out).toContain("does not match the signed otterd release");
  });

  it("ships the packaged systemd unit verbatim", () => {
    const script = readFileSync(INSTALLER, "utf8");
    const unit = script.split("<<'UNIT'\n")[1]?.split("\nUNIT\n")[0];
    const packaged = readFileSync(
      join(ROOT, "apps/otterd/packaging/systemd/otterd.service"),
      "utf8",
    );
    expect(`${unit}\n`).toBe(packaged);
  });
});

/** The parser every install ran before the otterd runtime, verbatim. */
const PREVIOUS_PARSER = `old_parse() {
  local mode="install"
  for arg in "$@"; do
    case "$arg" in
      update)             mode="update" ;;
      firewall-status)    mode="firewall-status" ;;
      firewall-rollback)  mode="firewall-rollback" ;;
      -n|--dry-run)       DRY_RUN=true ;;
      -y|--yes)           ASSUME_YES=true ;;
      -v|--verbose)       VERBOSE=true ;;
      --firewall)         FIREWALL=true ;;
      --no-firewall)      FIREWALL=false ;;
      -h|--help)          usage; exit 0 ;;
      *) fail "Unknown argument: $arg (try --help)" ;;
    esac
  done
  MODE="$mode"
}`;

const FLAGS = [
  "update",
  "firewall-status",
  "firewall-rollback",
  "-n",
  "--dry-run",
  "-y",
  "--yes",
  "-v",
  "--verbose",
  "--firewall",
  "--no-firewall",
  "-h",
  "--help",
  "--bogus",
  "node-ish",
  "--dry-run=1",
];

/** Parse each argument list in a subshell; one line of settings (or the failure) per case. */
function parseAll(parser: string, cases: string[][]): string[] {
  const lines = cases.map(
    (args) =>
      `out="$(${parser} ${args.map((a) => `'${a}'`).join(" ")} >/dev/null 2>&1; ` +
      `echo "\${MODE:-}|$DRY_RUN|$ASSUME_YES|$VERBOSE|$FIREWALL")"; echo "$?|$out"`,
  );
  const r = shell(`set +eu; trap - ERR; ${PREVIOUS_PARSER}\n${lines.join("\n")}`);
  expect(r.code).toBe(0);
  return r.out.trim().split("\n");
}

describe("installer arguments", () => {
  it("parses every flag and pair the previous parser accepted the same way, and refuses the same", () => {
    const cases = [
      [],
      ...FLAGS.map((f) => [f]),
      ...FLAGS.flatMap((a) => FLAGS.map((b) => [a, b])),
      ["update", "--no-firewall", "-y", "-v"],
      ["-n", "--firewall", "firewall-status", "--yes"],
    ];
    expect(parseAll("parse_args", cases)).toEqual(parseAll("old_parse", cases));
  });

  it("an unknown argument fails with the same message", () => {
    for (const parser of ["parse_args", "old_parse"]) {
      const r = shell(`${PREVIOUS_PARSER}\n${parser} --bogus`);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("Unknown argument: --bogus (try --help)");
    }
  });
});
