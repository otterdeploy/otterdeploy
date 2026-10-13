/**
 * otterd release manifests from the command line.
 *
 *   manifest       --version V --binary [NAME:]ARCH=FILE… --protocol MIN-MAX
 *                  --journal-format N --min-rollback V [--issued-at MS] --out PAYLOAD
 *   signing-input  --payload PAYLOAD --out FILE      bytes an offline key signs
 *   sign           --payload PAYLOAD --seed-file FILE --out RELEASE
 *                  (FILE holds the base64 32-byte Ed25519 seed)
 *   assemble       --payload PAYLOAD --public-key B64 --signature-file FILE --out RELEASE
 *                  (FILE holds the 64-byte signature, raw or base64)
 *   verify         --release RELEASE --keys KEYS [--binary [NAME:]ARCH=FILE…] [--at MS]
 *                  (KEYS is a release key set, as pinned on nodes)
 *
 * NAME defaults to `otterd`; list every binary of the release (otterd,
 * otterd-guard, otterd-dns, otterd-net, otterd-recover) for each arch.
 *
 * `sign` is the release job's path, with the seed from its secret store;
 * `signing-input` + `assemble` is the offline path, for a key that never
 * leaves its machine, for example
 * `openssl pkeyutl -sign -rawin -inkey release.pem -in input.bin -out sig.bin`.
 * Both check the result against the public key before writing it.
 */
import { releaseKeySet, signedEnvelope } from "@otterdeploy/otterd-proto";
import { Temporal } from "@otterdeploy/shared/temporal";
import { Result } from "better-result";
import { parseArgs } from "node:util";

import {
  buildManifest,
  detachedSigner,
  seedSigner,
  signRelease,
  signingInputOf,
  verifyRelease,
} from "./manifest";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    version: { type: "string" },
    binary: { type: "string", multiple: true },
    protocol: { type: "string" },
    "journal-format": { type: "string" },
    "min-rollback": { type: "string" },
    "issued-at": { type: "string" },
    payload: { type: "string" },
    "seed-file": { type: "string" },
    "public-key": { type: "string" },
    "signature-file": { type: "string" },
    release: { type: "string" },
    keys: { type: "string" },
    at: { type: "string" },
    out: { type: "string" },
  },
});

const need = (name: keyof typeof values): string => {
  const v = values[name];
  if (typeof v !== "string" || v.length === 0) throw new Error(`--${name} is required`);
  return v;
};

const read = async (path: string) => new Uint8Array(await Bun.file(path).arrayBuffer());
const json = async (path: string): Promise<unknown> => JSON.parse(await Bun.file(path).text());
const write = (path: string, data: string | Uint8Array) => Bun.write(path, data);

async function binaries() {
  return Promise.all(
    (values.binary ?? []).map(async (spec) => {
      // `name:arch=FILE`, or `arch=FILE` for the otterd binary itself.
      const [target = "", file = ""] = spec.split("=", 2);
      const [name, arch = ""] = target.includes(":") ? target.split(":", 2) : [undefined, target];
      return { ...(name ? { name } : {}), arch, bytes: await read(file) };
    }),
  );
}

/** Raw 64 bytes, or base64 text of them. */
function signatureOf(bytes: Uint8Array): Uint8Array {
  return bytes.length === 64
    ? bytes
    : new Uint8Array(Buffer.from(new TextDecoder().decode(bytes).trim(), "base64"));
}

async function command(name: string | undefined): Promise<Result<string, string>> {
  switch (name) {
    case "manifest": {
      const [min = "", max = min] = need("protocol").split("-");
      const built = buildManifest({
        version: need("version"),
        binaries: await binaries(),
        protocol: { min: Number(min), max: Number(max) },
        journalFormat: Number(need("journal-format")),
        minRollbackVersion: need("min-rollback"),
        issuedAtUnixMs: values["issued-at"]
          ? Number(values["issued-at"])
          : Temporal.Now.instant().epochMilliseconds,
      });
      if (built.isErr()) return Result.err(built.error);
      await write(need("out"), built.value.payload);
      return Result.ok(JSON.stringify(built.value.manifest, null, 2));
    }
    case "signing-input":
      await write(need("out"), signingInputOf(await read(need("payload"))));
      return Result.ok(`wrote ${need("out")}`);
    case "sign":
    case "assemble": {
      const signer =
        name === "sign"
          ? seedSigner(
              new Uint8Array(
                Buffer.from((await Bun.file(need("seed-file")).text()).trim(), "base64"),
              ),
            )
          : detachedSigner(need("public-key"), signatureOf(await read(need("signature-file"))));
      const signed = await signRelease(await read(need("payload")), signer);
      if (signed.isErr()) return Result.err(signed.error);
      await write(need("out"), `${JSON.stringify(signed.value, null, 2)}\n`);
      return Result.ok(`wrote ${need("out")} (key ${signed.value.keyId})`);
    }
    case "verify": {
      const release = signedEnvelope.parse(await json(need("release")));
      const keys = releaseKeySet.parse(await json(need("keys")));
      const at = values.at ? Number(values.at) : Temporal.Now.instant().epochMilliseconds;
      return verifyRelease(release, keys, at, await binaries()).map(
        (m) =>
          `release ${m.version} verifies (${m.artifacts.map((a) => `${a.name ?? "otterd"}:${a.arch}`).join(", ")})`,
      );
    }
    default:
      return Result.err("usage: otterd-release manifest|signing-input|sign|assemble|verify …");
  }
}

const outcome = await Result.tryPromise({
  try: () => command(positionals[0]),
  catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
});
const result = outcome.andThen((r) => r);
if (result.isErr()) {
  process.stderr.write(`${result.error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${result.value}\n`);
}
