# How Neon's Copy-on-Write Branching Actually Works

*Research companion to [`db-branching.md`](./db-branching.md). We have chosen
ZFS-snapshot CoW + a `pg_dump`/restore logical fallback, and we are **not**
rebuilding Neon. This document exists so that decision is made with full
knowledge of what we are trading away. Every non-obvious claim was
adversarially verified against the `neondatabase/neon` source — see §7.*

---

## 1. The one-paragraph mental model

A Neon branch is not a copy of your database. **It is a pointer — a
UUID-identified `timeline` that records its parent's `timeline_id` and a single
LSN (the branch point).** That's the whole object at creation time: a metadata
record. It's instant because nothing is copied; branching a 50 GB database and a
1 GB database both take sub-second time, because the cost is independent of data
size. Copy-on-write *here* does not mean "duplicate disk blocks lazily." It
means something more specific: Neon's storage is a **log-structured,
append-only, never-overwritten** set of immutable layer files addressed by
`(key, LSN)`. The child branch starts with an *empty* layer directory and
**shares its parent's entire history by reference** up to the branch-point LSN.
A page the child never wrote is read by *falling through into the parent
timeline's layer files* at that LSN. A page the child *does* write becomes a new
layer file owned by the child — the parent's immutable layers are never touched.
"Copy-on-write" is therefore a **read-time fall-through to a shared, immutable,
LSN-addressed log**, not a block-clone. Everything else here is the machinery
that makes that one sentence true.

---

## 2. The architecture that makes it possible

### The core inversion: WAL *is* the database; pages are a materialized cache

A stock Postgres keeps its authoritative state as **heap/index pages in a local
`PGDATA` directory**, and treats WAL as a recovery side-channel you replay after
a crash. Neon inverts this completely. **The durable source of truth is the WAL
stream**, and an 8 KiB page is a *derived, reconstructable view* of that stream
"as of" a given LSN. Once the authoritative state is an append-only log of
changes addressed by LSN — rather than a mutable set of files on one machine's
disk — two things become structurally possible that a monolithic Postgres
simply cannot do:

1. The machine running SQL can hold **no durable state**.
2. A "branch" is **a new pointer into the existing log at a chosen LSN**, not a
   copy of files.

That second point is the entire reason branching is O(1). A monolithic Postgres
branch *must* copy `PGDATA` (or snapshot its filesystem/volume), and that cost
scales with dataset size, because the pages on disk *are* the database. There is
no shared, immutable, append-only substrate to point at. Neon had to build one.

### The four planes

**Compute — stateless Postgres.** A Neon compute is a real, lightly-modified
PostgreSQL process with **no authoritative `PGDATA`**. The modifications live in
an extension in `pgxn/neon` (plus an rmgr extension in `pgxn/neon_rmgr`), loaded
via `shared_preload_libraries`, which **hooks the `smgr` (storage manager)
interface**. In stock Postgres, `smgr` reads/writes relation blocks from local
files. Neon replaces it so that on a shared-buffer-cache miss, the compute issues
a **`GetPage@LSN(key, lsn)`** RPC over the network to a pageserver instead of
reading a local file. When a page is evicted from shared buffers, Neon records
the LSN at eviction so the same LSN can be supplied in the later `GetPage@LSN`.
Postgres still needs *non-relational* files to boot — `pg_control`, config,
SLRUs, the directory skeleton — so the pageserver hands it a **`basebackup`
tarball** (distinct from `pg_basebackup`) at startup. So a compute gets its pages
two ways: a small basebackup tarball to bootstrap, then lazy per-page
`GetPage@LSN` requests on demand.

**Pageserver — the materialization / cache tier.** Ingests the WAL stream,
buffers it in an in-memory reorder buffer that keeps records for the same
page/relation close together, and flushes it to **immutable layer files** (§3).
To answer `GetPage@LSN`, it finds the most recent image of that page at-or-below
the LSN and replays the delta WAL records on top to *materialize* the requested
version. **It treats local NVMe as a cache of object storage** — a cold layer is
pulled from S3 when needed and evicted when not. It is not the durable floor.

**Safekeepers — the durable WAL quorum.** The compute does **not** write WAL to
local disk and does **not** stream it to the pageserver directly. A
**walproposer** background worker inside the compute broadcasts WAL to a set of
**safekeepers** (usually 3) forming a Paxos-style consensus group. A commit is
acknowledged only once a **quorum of safekeepers** has `fsync`'d the record:
each safekeeper reports its `flush_lsn`; the proposer sorts those and picks the
one at index `(num_safekeepers − quorum)` as `commit_lsn`; a client `COMMIT` is
released only once the commit record's LSN is `≤ commit_lsn`. The safekeepers
are the **synchronous durability boundary**; they hold WAL until the pageserver
has ingested it and uploaded the derived layers to S3, after which it's trimmed.

**Object storage (S3) — the durable cold tier.** Long-term home of the immutable
layer files. **The compute never speaks S3 directly.** Its storage
interlocutors: safekeepers (write, via walproposer), pageservers (read, via
`GetPage@LSN` + the startup basebackup), and — the one exception people get wrong
— an **extension-storage gateway** (`pg-ext-s3-gateway`): for dynamic/BYO
extension loading, `compute_ctl` downloads extension control/library files over
**HTTP** from that gateway, which itself fronts S3. The compute uses no S3 client
and no S3 credentials; the path is **compute → HTTP gateway → S3**, never
compute → S3.

### How the pageserver gets the WAL

The pageserver pulls WAL **from a safekeeper** (not the compute/primary, except
in testing) over Postgres's physical streaming-replication *transport*:
`START_REPLICATION PHYSICAL <lsn>` on a `COPY BOTH` stream, like a standby's
handshake. But **it is not the identical protocol a standby uses** — it's Neon's
custom, shard-aware **"Interpreted" WAL protocol**: the safekeeper sends
*pre-decoded* `RawInterpretedWalRecords` rather than raw `XLogData` (the legacy
"Vanilla" raw-WAL ingest path is no longer supported), and the replication
command carries Neon-specific options — a consensus `term`, plus
`tenant_id`/`timeline_id`/shard. So: standby-shaped transport, Neon-shaped
payload and handshake.

---

## 3. How page versions are stored

The pageserver is a **multi-version, immutable, LSM-tree-like KV store over
`(key × LSN)`**. Its entire job: "give me page *key* exactly as it was at *lsn*."

### Key

A page is addressed by a `Key` — an **18-byte** struct of six fields
(`KEY_SIZE = 18` in `libs/pageserver_api/src/key.rs`). For a normal relation
block, `rel_block_to_key` packs `field1 = 0x00` (key-type discriminator),
`field2 = spcnode`, `field3 = dbnode`, `field4 = relnode`, `field5 = forknum`,
`field6 = blknum`. Non-relation Postgres state — SLRUs (clog/multixact),
relation sizes, the relmap, control/checkpoint data — lives under other `field1`
discriminators, so **all cluster state lives in one flat keyspace.**

### Value

`enum Value { Image(Bytes), WalRecord(NeonWalRecord) }`. `Image` is a full 8 KiB
page; `WalRecord` is a parsed WAL record that must be *replayed* on top of a
prior version. The crucial method is **`will_init()`**: `true` for any `Image`,
and for a `WalRecord` it returns the record's own `will_init` flag — `true`
meaning the record materializes the page **standalone** (a full-page image, or
e.g. an insert into a brand-new page). `will_init` is what terminates the
read-path walk.

### Two layer file types

Everything on disk is an **immutable layer file**. Two kinds:

- **Image layer** — a snapshot of *every* key in a key range at *one* LSN. Block
  0 is a page-aligned (`PAGE_SZ = 8192`) `Summary` header (`magic`,
  `format_version`, `tenant_id`, `timeline_id`, `key_range`, a single `lsn`,
  index pointers), then optionally-compressed 8 KiB page images, then a
  `DiskBtree` index mapping key → blob offset. **Because it's a snapshot, any key
  absent from the index is known not to exist at that LSN.** Filename encodes
  `[start_key]-[end_key]__[LSN]`.

- **Delta layer** — all changes (WAL records and/or page images) for a key range
  over an *LSN range*. Same three-part layout, but `Summary` carries
  `lsn_range: Range<Lsn>` (**start inclusive, end exclusive**). The B-tree index
  key is **`(Key ‖ LSN)` = 26 bytes** (`DELTA_KEY_SIZE = KEY_SIZE + 8 = 26`), the
  8 bytes being the big-endian LSN, so multiple versions of one key are adjacent
  index entries. Index values are `BlobRef(u64)`: **bits 1–63 are the blob
  offset, bit 0 is the `will_init` flag** — letting the read path know a record
  self-initializes *without reading the blob*. Unmodified keys leave no trace.
  Filename encodes `[start_key]-[end_key]__[start_LSN]-[end_LSN]`.

### The layer map (2-D key × LSN)

Per timeline, a `LayerMap` indexes which layers exist. Conceptually every layer
is a **rectangle**: horizontal = key range, vertical = LSN range (an image layer
is a zero-height line at one LSN). Reads search it by `(key, LSN)`; in-memory
layers first. **L0 vs L1 is inferred from key width, not stored**: a delta
covering the *whole* key range is L0; one covering only *part* is L1. Fresh WAL
always lands in L0; compaction produces L1.

### Ingest → in-memory → flush

New WAL is decoded into an **open in-memory layer** (an `EphemeralFile` buffer
that can spill to disk). At `checkpoint_distance` bytes (default **256 MiB**; an
old blog's "1 GB" figure is stale) a two-step flush runs: **freeze** (close the
open layer, start a fresh one) then **serialize** (write the frozen layer as a
new on-disk **L0 delta layer**), advancing `disk_consistent_lsn`. Once uploaded
to S3 it advances `remote_consistent_lsn` — the crash-survivable position.

### Serving `GetPage@LSN` — the walk down

To reconstruct `key` at `req_lsn`: start at `req_lsn` and walk **downward in
LSN** through the layer map (in-memory first, then descending), collecting every
`WalRecord` for the key. **The walk stops the moment it hits a value with
`will_init() == true`** — an `Image` (always) or a `WalRecord` flagged
`will_init`. Then **WAL redo** replays the base image + collected records
(oldest→newest) into the 8 KiB page. If a read crosses too many layers
(`LAYERS_VISITED_WARN_THRESHOLD = 100`) it warns — the signal that compaction or
image creation is behind.

**Where redo runs — precise.** Real Postgres heap/index WAL records
(`NeonWalRecord::Postgres`) are replayed by a **separate per-tenant
`postgres --wal-redo` process, sandboxed with `seccomp`**, over stdin/stdout —
spawned via **`posix_spawn()`, not `fork()`** (Neon moved off `fork()+exec()` in
Feb 2024). Crucially, **a large class of records never reaches that process**:
the in-Rust apply path (`can_apply_in_neon`) handles **everything except
`NeonWalRecord::Postgres`** — SLRU/CLOG, visibility-map
(`ClearVisibilityMapFlags`, `TruncateVisibilityMap`), and `AuxFile` records all
apply in Rust, in-process. And `XLOG_FPI` full-page-image records are converted
to page images **at ingest** and never go through redo at all.

### Compaction and GC

**Compaction** keeps reads shallow: enough L0 layers → merge and **slice per
keyspace** into L1 deltas. Separately, when too many deltas stack over a key
range (`image_creation_threshold`, default **3**), the pageserver materializes a
fresh **image layer** — which both shortens reads and *enables GC* (once an
image exists at LSN X, older deltas below X become droppable). GC mechanics: §4.

---

## 4. How a branch works, step by step ← the core section

### 4.0 The object: a timeline with an ancestor pointer

Every branch is a **timeline** identified by a `TimelineId` UUID. A non-root
timeline records exactly two extra fields in
`pageserver/src/tenant/timeline.rs`:

```rust
// Parent timeline that this timeline was branched from,
// and the LSN of the branch point.
ancestor_timeline: Option<Arc<Timeline>>,
ancestor_lsn: Lsn,
```

The root branch (`main`) has `ancestor_timeline = None`. Branch from the live tip
→ child takes the parent's current `last_record_lsn`; branch from the past → you
pass `ancestor_start_lsn`.

### 4.1 Creation is metadata-only → instant, O(1), zero bytes copied

Creating a branch writes a new timeline directory + a `metadata` file recording
`ancestor_timeline_id` and `ancestor_lsn`, and calls `insert_child()` to register
the branch point in the parent's `GcInfo`. **No page data is copied.** The
child's layer directory starts *empty*. Neon's docs: *"When a new branch is
created, the branch is empty at first, but the incoming WAL on the branch is
stored separately from the parent branch."* Branching a 50 GB DB and a 1 GB DB
cost the same sub-second time.

### 4.2 The exact moment a read falls through to the parent

This is the heart of the mechanic. `get_vectored_reconstruct_data` runs an
**iterative `loop {}`** over the ancestor chain — *not* function recursion. It
searches the **current** timeline's layers; for whatever keys are still
unresolved it descends into the ancestor. The crossover:

```rust
let Some(ancestor_timeline) = timeline.ancestor_timeline.as_ref() else {
    break Some(query.total_keyspace());     // no ancestor → key truly missing
};
// Lower all ranges in LSN space so new changes on the parent aren't visible.
query.lower(timeline.ancestor_lsn);          // clamp to branch point
// ... get_ready_ancestor_timeline(...) ...
timeline = &*timeline_owned;                  // continue on the parent
```

Three things to be exact about:

1. **The descent is per-unresolved-key, not a whole-page redirect.** The query is
   a *vectored keyspace*; keys already `COMPLETED` on the child are stripped
   before descent. Only un-completed keys fall through.
2. **"Un-completed" is broader than "the child has no layer for it."** A key
   falls through when its WAL chain wasn't terminated on the child (no
   `will_init` value found yet). A key can have *visited child delta layers* (the
   child wrote some WAL) and **still descend** to the parent to find the
   initializing base image. Fall-through condition = "not yet reconstructed," not
   merely "absent from the child."
3. **`query.lower(timeline.ancestor_lsn)` clamps the search LSN to the branch
   point**, so the child sees the parent *exactly as it was at `ancestor_lsn`* and
   is blind to any parent writes after the branch. The parent's tip may have
   moved far past the branch LSN; the child still reads it at the branch LSN.

### 4.3 The exact moment a write on the child allocates only new layers

Writes on the child are new WAL the child ingests independently. They accumulate
in the child's in-memory layer, then freeze/flush into **new delta and image
layers owned by the child timeline**, in the child's own directory. **The
parent's immutable layers are never opened for write.**

Worked example: branch at LSN 250. Modifying `orders` on the child produces
child-owned layers (`child/orders_250_300`, `child/orders_300`, …) while
`main/orders_*` is untouched. A read on the child at LSN 275 reads
`child/orders_250_300`, but to materialize the *base* page at 250 it still
replays `main/orders_200_300` + `main/orders_200` from the parent. Meanwhile the
`customers` table, never written on the child, has **no child layer at all** —
every read falls straight through to `main`. **Divergence allocates only the
child's own new layers; shared history stays a single physical copy.**

### 4.4 Branch-from-past-LSN and PITR

Because layers are append-only and never overwritten, **you can branch from any
LSN still on disk**. A *timestamp* branch first resolves the timestamp to an LSN
(`get_lsn_by_timestamp`), then branches at that LSN exactly like an LSN branch.
PITR restore *is* this: *"When you trigger PITR, Neon creates a new branch of the
database at a specific LSN."* No replay-from-basebackup; the retained layers
already materialize that LSN. **Branch-from-arbitrary-WAL-point is the same
primitive as branch-from-tip, just with a smaller `ancestor_lsn`.**

### 4.5 The limit: the GC horizon — and how it interacts with children

You can only branch back as far as history is *retained*, and retention is where
people get the model wrong. There are **two distinct mechanisms, not one
combined minimum.**

```rust
struct GcInfo {
    retain_lsns: Vec<(Lsn, TimelineId, MaybeOffloaded)>, // every child branch point
    cutoffs: GcCutoffs,
}
struct GcCutoffs {
    space: Lsn,         // from gc_horizon  (WAL bytes behind the tip)
    time:  Option<Lsn>, // from pitr_interval (a Duration → LSN via timestamp lookup)
}
fn select_min(&self) -> Lsn { self.space.min(self.time.unwrap_or_default()) }
```

**(a) The GC cutoff LSN is `min(space, time)` — and *only* those two.**
`retain_lsns` is **not** folded into this minimum.

**(b) Separately, the per-layer removal loop keeps any layer whose
`start_lsn ≤ max(retain_lsns)`** — so **a parent never GCs a layer below a live
child's branch/`ancestor_lsn`, even when that LSN is older than the space/time
cutoff** — but this is an *independent per-layer guard*, not a lowering of the
cutoff.

Practical limits:
- You cannot branch from an LSN below the applied GC cutoff — the layers are
  gone. (User-facing history window: Free ~6 h, up to 7 d / 30 d on paid tiers.)
- A forgotten long-lived child branch **pins parent history past the horizon**,
  inflating storage. Fix: delete unused branches.
- A long-lived, heavily-written branch accumulates so much private divergence
  that its cost approaches a real copy of the diverged portion.

---

## 5. What "copy-on-write" means at three levels

The phrase is overloaded across exactly the three systems in this comparison.

| Dimension | **Neon** (page/log-structured CoW) | **ZFS / Btrfs / LVM** (filesystem-block CoW) | **Aurora** (storage-layer CoW) |
|---|---|---|---|
| **Sharing granularity** | Key-ranges within immutable layer files, versioned by **LSN** | Fixed-size **filesystem blocks / extents** | **Storage pages** in a distributed volume |
| **Addressing unit** | Logical `(key, LSN)` — a page version in WAL history | Opaque disk block; no LSN or logical page | Log-structured volume page (10 GB segments under the hood) |
| **What a "branch/clone" is** | New `timeline` = ancestor pointer + branch-point LSN | `zfs clone` of a `zfs snapshot` of PGDATA | New cluster pointing at the same volume pages |
| **CoW trigger** | Write → new delta/image **layer file** owned by child; parent untouched | Write → new block allocated; snapshot keeps old block | Write to *either* side → new copy of that page + pointer update |
| **Topology** | **Distributed by construction** (compute / pageserver / safekeeper / S3) | **Single node** — clone bound to one pool, can't migrate | Distributed, but only inside Aurora's storage fleet |
| **Branch from arbitrary past point** | **Yes** — any LSN in the history window | Only from an existing **snapshot** (cadence = granularity) | Latest restorable time / PITR within window |
| **Scale-to-zero** | **Yes** (stateless compute) | No | Partial |
| **Self-hostable on a box** | Technically, but it's a DB company's worth of ops | Trivially | No (proprietary) |
| **Hard limits** | History-window retention; children pin parent layers | Node-local; snapshot granularity | **≤15 CoW clones per source cluster/volume** (16th = full copy); **no cross-region clones** (verbatim AWS) |

The one-line distinction: **Neon CoWs *logical page versions in a shared WAL
history*; ZFS CoWs *opaque disk blocks on one host*; Aurora CoWs *volume pages in
a proprietary distributed store*.** Only Neon's unit carries LSN semantics —
which is the *only* reason branch-from-arbitrary-WAL-point exists.

---

## 6. Neon vs. the ZFS-snapshot approach we're building

### What Neon's design buys you

1. **Branch from any WAL point, not just a snapshot.** "Branch as of 14:03:22
   yesterday" is a first-class op, identical in mechanism to branching from the
   tip. The single capability nothing else here has.
2. **Scale-to-zero.** Stateless compute owns no durable state; an idle endpoint
   suspends with zero data movement. Branches inherit it for free.
3. **Cross-node branches.** A branch is a metadata pointer into object storage;
   any compute on any node can serve it. Not pinned to the host that holds data.
4. **Shared base in object storage + true per-branch-ish billing.** N branches of
   a 1 TB DB cost ≈ 1 TB + Σ(divergence), not N × 1 TB. Neon is explicit that
   "there is no such thing as the size of a branch."

### What that costs

A **whole custom storage engine**, and the ops to run it: a patched Postgres with
an `smgr`-hijacking extension; a **pageserver** (layer files, compaction, GC,
sandboxed walredo, S3 offload); a **safekeeper** quorum (≥3) running Paxos-style
WAL consensus; a **storage_broker** + control plane; an **object store**; and the
extension-storage gateway for BYO extensions. A database company's worth of
operational surface — and the production control plane is not fully open.

### What ZFS-snapshot CoW gets us for ~1% of the effort

`zfs snapshot` + `zfs clone` of a single PGDATA dataset, with **unmodified stock
Postgres** bind-mounted onto the clone. This is the Database Lab Engine (DLE)
model, production-proven: **~10 s to clone 1 TiB, dozens of clones per host
sharing unchanged blocks.** No storage-engine rewrite, no safekeepers, no
pageserver, no object store, no control plane. Our `pg_dump`/restore logical path
is the universal floor where ZFS doesn't apply (cross-node, no ZFS pool) —
`executeBackup()` in `packages/api/src/backups/engine.ts` already does the dump;
only restore is missing, and we need that anyway.

### Where ZFS genuinely falls short of Neon (don't hand-wave these)

1. **Single-node pinning.** A `zfs clone` lives in the same pool as its snapshot
   and cannot migrate to another host. Neon's branches are cross-node by
   construction; ours are not.
2. **Branch-from-snapshot, not branch-from-arbitrary-WAL-point.** ZFS has no
   LSN-addressed history. **Snapshot cadence *is* your time-travel granularity.**
   Arbitrary point-in-time branching is Neon-only — a deliberate non-goal for us.
3. **Snapshot consistency of a live PGDATA.** A ZFS snapshot of a *running*
   Postgres is only crash-consistent. Want a clean branch → `CHECKPOINT` (or
   `pg_backup_start`/`_stop`) before snapshotting; and if PGDATA spans multiple
   datasets/tablespaces a single `zfs snapshot` is no longer atomic across them.

### Frank verdict

**For the stated scope — preview/staging/branch databases with no production
traffic — the ZFS-snapshot choice is sound, and rebuilding Neon would be a
serious mistake.** The three things Neon's architecture uniquely buys
(branch-from-arbitrary-WAL, scale-to-zero, cross-node) are precisely the three
things a preview/staging DB does not need: node-pinning is fine,
branch-from-recent-snapshot is good enough, and there's no idle-compute fleet to
scale to zero. We'd be operating a pageserver + safekeeper quorum + broker +
object store + control plane to buy capabilities our users won't exercise.
ZFS-snapshot CoW + `pg_dump` fallback gets the instant, space-shared,
divergence-only branching that *is* the headline feature, on stock Postgres, for
roughly 1% of the engineering and ops cost.

**The 2–3 things to watch:**

1. **Snapshot consistency discipline.** Bake `CHECKPOINT` (or
   `pg_backup_start`/`_stop`) into the snapshot primitive, and decide explicitly
   how you handle multi-dataset/tablespace PGDATA (simplest safe answer: keep
   PGDATA on a single dataset, or refuse/serialize the multi-dataset case).
2. **Forgotten branches consume real disk.** Neon's GC-pins-parent-for-children
   problem has a direct ZFS analog: a `zfs clone` holds its origin snapshot alive,
   so shared blocks can't be freed until the clone is destroyed. You need branch
   TTLs / GC (already in the design's Lifecycle section) — and you need to surface
   pool capacity, because divergence is opaque blocks.
3. **Set the expectation in the product, not just the design doc.** ZFS gives
   **branch-from-snapshot**; snapshot cadence is the time granularity. If users
   ask for "branch as of an arbitrary moment," say up front that's a Neon-only
   capability and a deliberate non-goal, so it doesn't read as a bug. The fallback
   for "copy prod exactly as of now" is `pg_dump`/restore — honest and universal
   but `∝` data size.

---

## 7. Sources

**Neon source & design docs (`github.com/neondatabase/neon`)**
- `docs/glossary.md` — timeline/branch, `ancestor_lsn`, image/delta layer, basebackup, `commit_lsn`/`flush_lsn`/`disk_consistent_lsn`/`remote_consistent_lsn`
- `docs/core_changes.md` — `smgr` hook, eviction-LSN, basebackup, walproposer
- `docs/pageserver-storage.md` — layer files, L0/L1, LayerMap, branch read-recursion, GC retention, worked branch example
- `docs/pageserver-walredo.md` — sandboxed walredo process, in-Rust apply path
- `docs/safekeeper-protocol.md` — proposer/acceptor, `commit_lsn` formula
- `docs/walservice.md` — push-to-safekeepers, pageserver pull, WAL trim
- `docs/settings.md` — `checkpoint_distance` (256 MiB), `pitr_interval` (7 d), `image_creation_threshold` (3)
- `docs/synthetic-size.md` — per-project synthetic size; "no such thing as the size of a branch"
- `pageserver/src/tenant/timeline.rs` — `ancestor_timeline`/`ancestor_lsn`, `get_vectored_reconstruct_data` ancestor loop, `GcInfo`/`GcCutoffs`/`select_min`
- `pageserver/src/tenant/storage_layer/{image_layer,delta_layer}.rs` — Summary headers, `DELTA_KEY_SIZE = 26`, `BlobRef` will_init bit
- `libs/pageserver_api/src/key.rs` — `Key` struct, `KEY_SIZE = 18`, `rel_block_to_key`
- `libs/wal_decoder/src/models/value.rs` — `Value` enum, `will_init()`
- Self-hosting discussion #1828 — components required to self-host

**Neon blog & product docs (`neon.com`)**
- Deep dive into the Neon storage engine (GetPage@LSN) — https://neon.com/blog/get-page-at-lsn
- A Deep Dive Into Neon's Instant PITR — https://neon.com/blog/pitr-deep-dive
- Instantly Copy TB-Size Datasets: The Magic of Copy-on-Write — https://neon.com/blog/instantly-copy-tb-size-datasets-the-magic-of-copy-on-write
- Architecture overview — https://neon.com/docs/introduction/architecture-overview
- Branching — https://neon.com/docs/introduction/branching
- History window — https://neon.com/docs/introduction/history-window

**Aurora (AWS)**
- Amazon Aurora Fast Database Cloning — https://aws.amazon.com/blogs/aws/amazon-aurora-fast-database-cloning/
- Cloning a volume for an Aurora DB cluster (15-clone / no-cross-region limits) — https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Managing.Clone.html

**ZFS-snapshot / landscape**
- Database Lab Engine (DLE) — ZFS/LVM snapshot+clone of PGDATA, ~10 s/TiB — https://github.com/postgres-ai/database-lab-engine
- Supabase Branching — https://supabase.com/docs/guides/deployment/branching
- PlanetScale Branching (schema branching + deploy requests) — https://planetscale.com/docs/vitess/schema-changes/branching
- Jack Vanlightly, Neon ASDS Ch.3 (Paxos roles) — https://jack-vanlightly.com/analyses/2023/11/15/neon-serverless-postgresql-asds-chapter-3
- Our own design: `docs/designs/db-branching.md`; existing dump path `packages/api/src/backups/engine.ts`
