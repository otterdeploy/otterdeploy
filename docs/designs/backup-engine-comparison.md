# Backup Engine Comparison — `rustic_core` vs Borgmatic

**Status:** Research / decision doc · **Last verified:** 2026-07-14
**Extends:** [`borgmatic-evaluation.md`](./borgmatic-evaluation.md), [`hetzner-backups.md`](./hetzner-backups.md)

## The decision, reframed

There are **two separable questions**, and conflating them is what makes this confusing:

1. **Which repository FORMAT** — Borg vs restic. *This is the strategic call.*
2. **Which IMPLEMENTATION** — borgmatic/borg (Python+C subprocess), restic-go (Go subprocess),
   or **`rustic_core` (Rust library embedded via napi-rs)**. *This is reversible*, because
   restic-go and rustic_core **read/write the same format**.

The headline: **for otterdeploy the restic format beats the Borg format** on the three axes that
match your architecture (S3-native destinations, lock-free multi-tenant concurrency, true WORM
immutability). `rustic_core` is the *embeddable Rust* expression of that format. So the real contest
isn't "rustic_core vs Borgmatic" on even ground — it's "a restic-format engine (which fits) vs a
Borg-format wrapper (which doesn't), with a maturity tax on the Rust side."

---

## Head-to-head (the axes that matter for otterdeploy)

| Dimension | **`rustic_core`** (embed via napi-rs) | **Borgmatic** (shell out to borg) |
|---|---|---|
| Layer | **Library** (restic format) | CLI **wrapper** over the `borg` binary |
| Integration | **In-process native addon**, typed TS | Spawn CLI, parse `--json`/`--log-json` |
| Language/runtime in image | Rust static lib (no runtime) | **Python + borg** + version matrix |
| **S3 / object-store destinations** | ✅ **native via OpenDAL** (S3, B2, MinIO…) | ❌ **borg can't** — needs SSH/FS/rclone-mount |
| Fits your `local`/`s3`/`sftp` model | ✅ directly (incl. S3) | ⚠️ sftp/local only; S3 needs a shim |
| DB dumps | **keep your `docker exec` dump → `ChildStdoutSource`** | native hooks (pg/mysql/mongo/sqlite; no redis) |
| Dedup / encryption / compression | CDC dedup, AES-256+Poly1305 (always on), zstd | CDC dedup, AES-256+HMAC, lz4/zstd |
| **Concurrency (multi-tenant fan-in)** | ✅ **fully lock-free** (parallel backups *and* prune) | ❌ borg single exclusive lock; **borgmatic can't run concurrent instances** |
| **Immutability** | ✅ **S3 Object Lock = true WORM** + append-only default | ⚠️ SSH forced-command append-only (client-only, weaker) |
| Retention | time/count (`KeepOptions`) — **no size cap** | time/count (`keep_*`) — **no size cap** |
| `maxStorageGb` equivalent | ❌ none (keep yours) | ❌ none (keep yours) |
| Integrity check | `check` (+ read-data / subset) | `check` incl. probabilistic `spot` |
| Cold storage (Glacier) | ✅ hot/cold + warm-up | ❌ |
| Recovery tooling | ⚠️ **no `recover` command** | borg has more repair/recover |
| License (for embedding) | ✅ **Apache-2.0 / MIT** | borg BSD; **borgmatic GPLv3** (don't embed; shell only) |
| Maturity | ⚠️ **pre-1.0, "early development"** | production/stable (borg decade-hardened) |
| API stability | ❌ **~30 breaking changes, one per minor** | CLI is stable; no library API at all |
| Bus factor | ⚠️ **1 engine author** (aawsome) | ⚠️ **1 maintainer** (witten) — a wash |
| Proven as an embedded lib | ❌ **0 external users; no napi binding exists** | n/a (it's a CLI; widely run) |
| Escape hatch | ✅ **restic-go can restore rustic repos** | restore needs borg |

---

## Where `rustic_core` genuinely wins for *your* product

1. **S3-native** — the single sharpest friction from the Borg evaluation disappears. Your flagship
   `s3` destination (and `local`/`sftp`) are all first-class via OpenDAL, no subprocess, no mount.
2. **Lock-free concurrency** — many services backing up to shared repos concurrently, and prune runs
   *parallel* to backups. Borg serializes on one exclusive lock; **borgmatic explicitly forbids
   concurrent instances on one host** — a direct clash with a multi-tenant fan-in.
3. **Native embedding** — an N-API addon in-process (Bun supports N-API), no Python/borg in the
   image, typed TS surface, structured errors → typed JS errors. The core is **synchronous** with
   internal rayon parallelism, so a napi-rs `AsyncTask` on the libuv threadpool avoids any
   tokio-bridging trap.
4. **DB dumps still fit — and this neutralizes Borgmatic's main draw.** Borgmatic's big selling point
   was native DB hooks. But you already own the dump logic (`engine-helpers.ts` + `exec.ts` do
   `docker exec pg_dump`). `rustic_core`'s **`ChildStdoutSource`** lets the Rust side spawn that dump
   and stream its stdout straight into a snapshot — so you keep your credential-safe exec model and
   don't need Borgmatic's hooks at all.
5. **True WORM immutability** — restic writes immutable content-addressed objects, so **S3 Object
   Lock (compliance mode)** gives real ransomware-proof immutability that even root can't bypass.
   Borg-over-SSH structurally cannot (its compaction rewrites files). rustic's append-only-by-default
   + lock-free design is the cleanest fit for this path (cleaner than restic-go, which still writes
   lock files).
6. **Permissive license** — Apache-2.0/MIT is embed-friendly; Borgmatic is GPLv3 (fine to shell out
   to, a problem to link).

## Where Borgmatic/Borg wins (and the honest risks of rustic)

- **Maturity.** Borg is a decade of hardening; Borgmatic is production/stable. `rustic_core`
  **self-describes as "early development, API subject to change,"** ships **~30 breaking changes
  (one per minor release)**, has had (fixed) prune/index data-integrity bugs, **no `recover`
  command**, and lower test maturity than restic-go.
- **Bus factor is a wash, not a win.** rustic's engine is **effectively one author**; borgmatic is
  one maintainer. Don't count rustic's "org" as diversification — one human writes the backup logic.
- **Unproven embedding.** **Zero external projects depend on `rustic_core` as a library; no napi
  binding exists.** You would be the first to run this pattern in production — genuinely novel territory.
- **The escape hatch is what makes this tolerable:** restic-go can read/restore rustic's repos
  (confirmed by the project, both directions) — so your data is never locked to rustic. **Treat
  restic-go restore as standing insurance and test it on a schedule** (there's no formal conformance
  suite; don't assume it).

---

## Recommendation

**The restic format is the right foundation for otterdeploy — so not Borgmatic/Borg.** But
"`rustic_core` embedded via napi-rs" and "restic-go via subprocess" are the same *format* with
different risk/effort, and they're **mutually reversible** (shared repos). That gives a staged path
that captures the format benefits now and keeps the native option open:

1. **No-regret first (unchanged):** Storage Box as an `sftp` destination (works today); fix the
   in-memory buffering in `engine.ts`/`storage.ts`.
2. **Add a restic-format destination** to `storage.ts`'s dispatch. **Start by shelling out to
   `restic` (Go)** — mature, gets you S3-native + dedup + better concurrency + WORM *immediately* at
   low risk, and validates the whole product shape (repo model, retention delegation, restore flow,
   UI changes) against a battle-tested implementation.
3. **Evaluate `rustic_core` + napi-rs as the v2 upgrade** of that same destination — same repos, so
   it's a drop-in with restic-go as a permanent fallback. Take it only when native integration +
   lock-free concurrency are worth the greenfield binding and the pre-1.0 maintenance burden. If you
   do: pin exact versions, wrap the typestate `Repository` states in an enum, forward the
   `RusticProgress` trait to a napi `ThreadsafeFunction`, and **restore-test adversarially** (kill
   mid-backup, corrupt a pack, restore across a version bump, and cross-restore with restic-go).
4. **Keep `maxStorageGb` hand-rolled** — neither format has a size cap.
5. This remains an **added destination/strategy, not a rip-out.** Your engine + all the glue
   (contract, tenancy, tables, UI, CLI, scheduler, secrets, notifications) stays — same conclusion as
   the Borgmatic doc; only the *engine we'd add* changed from "borg" to "restic-format (restic-go now,
   rustic_core later)."

### One-line verdict
`rustic_core` **stacks up better than Borgmatic for otterdeploy** — S3-native, lock-free, embeddable,
permissively licensed, and it neutralizes Borgmatic's only real edge (DB hooks) because you keep your
own dumps. The catch is maturity: it's a pre-1.0, solo-authored, never-embedded library. So adopt the
**restic format**, get there via **restic-go first**, and treat **embedded `rustic_core` as the
native upgrade** with **restic-go interop as your insurance** — not as a leap of faith.

---

## Sources
rustic_core library: [docs.rs](https://docs.rs/rustic_core/latest/rustic_core/) ·
[Repository](https://docs.rs/rustic_core/latest/rustic_core/struct.Repository.html) ·
[ReadSource/ChildStdoutSource](https://docs.rs/rustic_core/latest/rustic_core/trait.ReadSource.html) ·
[rustic_backend/OpenDAL](https://docs.rs/rustic_backend) · [lib.rs 0.12.0](https://lib.rs/crates/rustic_core) ·
[GitHub](https://github.com/rustic-rs/rustic_core) · [changelog (breaking)](https://raw.githubusercontent.com/rustic-rs/rustic_core/main/crates/core/CHANGELOG.md)
restic format/ops: [design doc](https://github.com/restic/restic/blob/master/doc/design.rst) ·
[forget/prune](https://restic.readthedocs.io/en/stable/060_forget.html) ·
[locking](https://deepwiki.com/restic/restic/8.1-locking-system) ·
[Object Lock/WORM](https://til.chriswheeler.dev/object-lock-with-restic/)
rustic vs restic / interop / risk: [comparison](https://rustic.cli.rs/docs/comparison-restic.html) ·
[FAQ](https://rustic.cli.rs/docs/FAQ.html) · [cold storage](https://rustic.cli.rs/docs/commands/init/cold_storage.html) ·
[restic-forum sentiment](https://forum.restic.net/t/a-restic-client-written-in-rust/4867) ·
[crates.io reverse-deps](https://crates.io/api/v1/crates/rustic_core/reverse_dependencies)
Borgmatic side: see [`borgmatic-evaluation.md`](./borgmatic-evaluation.md).
