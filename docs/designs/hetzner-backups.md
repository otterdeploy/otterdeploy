# Hetzner Backups — Storage Boxes, DB/Volume Backups & VM Snapshots

**Status:** Research / design input (extends [`backups.md`](./backups.md))
**Last verified:** 2026-07-14 (facts current to the 2025 Storage Box relaunch + April 2026 price changes)

**TL;DR:** There are **three independent backup layers**, and they are not substitutes for
each other:

1. **DB-level** — logical dumps (`pg_dump`/`mysqldump`/`mongodump`/`redis` save) shipped to a
   destination. *App-consistent, portable, granular.* **← otterdeploy already does this.**
2. **Volume/file-level** — `tar`/`restic`/`borg` archives of Docker volumes shipped to a
   destination. *Filesystem-consistent, portable.* **← otterdeploy already does this (tar).**
3. **VM snapshot** — a whole-disk image of the underlying **Hetzner Cloud** server via the
   hcloud API. *Crash-consistent, whole-machine, fast rebuild, provider-locked, Cloud-VMs-only.*
   **← new capability, orthogonal to the Docker-level engine.**

A **Hetzner Storage Box** is a *destination* for layers 1 & 2 (it speaks SFTP/Borg/restic/rclone).
A **Hetzner Cloud snapshot** is layer 3 itself. A **Storage Box snapshot** ("server-side
snapshot") is a cheap ZFS undo-layer *on top of* the backups you push — not a backup itself.

The single most useful fact for us: **our existing `sftp` destination already works against a
Storage Box today** (port 22, SFTP) — no new code required to start using one. Everything past
that (Borg/restic dedup, sub-account isolation, server-side snapshots, VM snapshots) is upside.

---

## Layer 1 & 2 destination: the Hetzner Storage Box

### The 2025 "next-generation" relaunch (important context)

Hetzner moved Storage Boxes off the old **Robot** panel onto the new **Hetzner Console** in 2025:

- Automatic migration of existing boxes into a "Storage Box Migrated" project began **25 Jun 2025**.
- **Robot Web Service support for Storage Boxes ended 29 Jul 2025** — management is now the new
  **Hetzner API** (Bearer token), not the old Robot Basic-auth webservice.
- Server-bound Storage Boxes are no longer sold; the current standalone line is **BX11/21/31/41**.
- Confusing naming caveat: the **new** SKUs reuse the **same BX11–BX41 names** the old standalone
  line used, with different capacities/prices/features. The one clearly "legacy" survivor is
  **BX10** (the free box bundled with dedicated servers, stays in Robot; migrate to BX11 manually).

### Tiers & pricing (next-gen, net €/month, excl. VAT)

| SKU  | Capacity | €/mo (net) | Snapshots (manual/auto) | Sub-accounts | Concurrent conns | Setup |
|------|----------|-----------|-------------------------|--------------|------------------|-------|
| BX11 | 1 TB     | €3.20     | 10 / 10                 | 100          | 10               | €0    |
| BX21 | 5 TB     | €10.90    | 20 / 20                 | 100          | 10               | €0    |
| BX31 | 10 TB    | €20.80    | 30 / 30                 | 100          | 10               | €0    |
| BX41 | 20 TB    | €40.60    | 40 / 40                 | 100          | 10               | €0    |

- **Traffic is unlimited and free** on every tier; no bandwidth caps. Internal Hetzner traffic free.
- **10 concurrent connections per box** (documented per-box, not per-protocol).
- Hourly billing capped at the monthly max; locations Germany (FSN/NBG) or Finland (HEL).
- ⚠️ BX21/BX41 prices are corroborated via Hetzner's order-system mirror rather than quoted from the
  JS-rendered hetzner.com page; BX11/BX31 confirmed "plus VAT" from hetzner.com snippets. Verify
  live before hardcoding. There is also a general storage **price increase effective 1 Apr 2026**.

### Protocols & ports (answers the "port 22 or 23?" question)

| Protocol(s)                              | Port | Notes                                                        |
|------------------------------------------|------|--------------------------------------------------------------|
| FTP / FTPS                               | 21   | optional, enable in Console                                  |
| **SFTP / SCP**                           | **22** | SFTP/SCP only — **no interactive shell**                   |
| **rsync / BorgBackup / restic / rclone / SFTP / SCP** | **23** | "extended SSH": file tools + a limited whitelisted shell |
| SMB / CIFS                               | 445  | network-drive mount                                          |
| HTTPS / WebDAV                           | 443  | enable in Console                                            |

**The port answer: unchanged from legacy.** Port **22 = SFTP/SCP only** (no shell). Port **23 =
the extended SSH service** required for rsync/Borg/restic/rclone and a whitelisted mini-shell
(`ls, cp, mv, rm, cat, md5sum…` — **no pipes, no redirects, no running uploaded scripts**). Port 23
is enabled via the **"SSH support"** toggle in Console. So:

- Pure **SFTP put/get** (what our `ssh2-sftp-client` destination does) → **port 22**, works today.
- **Borg/restic/rsync/rclone** → **port 23** (must enable SSH support + External Reachability).
- **restic** is "natively supported with the SFTP backend"; **rclone** via its SFTP backend.
- **SSHFS** works (it's an SFTP client) but is not officially listed.

### Sub-accounts (multi-tenant isolation)

- **Up to 100 sub-accounts per box** (all tiers) — a big jump over the legacy line.
- Each sub-account: **own username/password + own hostname** (`uXXXXX-subN.your-storagebox.de`),
  **confined to its assigned sub-directory**, optional **read-only** mode, per-protocol availability.
- **External Reachability** must be enabled to reach the box/sub-account from outside Hetzner's net.
- ⚠️ **Storage is pooled** — no per-sub-account capacity quota. Isolation is credential + directory +
  read-only, *not* a hard byte quota. A noisy tenant can fill the shared box.
- Fit for us: per-org (or per-resource) sub-account = own creds + directory jail + optional
  restore-only read-only account. Provision via the Hetzner API (below).

### Authentication

- **Password** on all protocols; **SSH public-key** fully supported (can add keys *at box creation*).
- **Key-format quirk (both generations):**
  - **Port 22** wants **RFC4716/SSH2** format (`ssh-keygen -e -f id.pub`, `---- BEGIN SSH2… ----`).
  - **Port 23** wants **normal one-line OpenSSH** format; supports `ed25519-sk`/`ecdsa-sk`;
    upload via `ssh-copy-id -p23 -s …`.
  - Want key auth on **both** ports → put **both formats** in `authorized_keys`.
- No general login shell anywhere; the SSH service is a restricted file-transfer/backup subsystem.

### Storage Box **snapshots** — the "server-side snapshots" you asked about

These are Hetzner-side **ZFS copy-on-write** snapshots of the files *on the box*. **Not a backup.**

- **Copy-on-write / deltas only.** Taking one costs ~0 bytes; space grows only as post-snapshot
  files change. Adding *new* files after a snapshot costs the snapshot nothing.
- **Slot limits scale with plan** (manual & automatic are **separate** pools): BX11 10/10,
  BX21 20/20, BX31 30/30, BX41 40/40.
- **Free of extra charge, but consume the box's own quota** (not separate storage).
- **Automatic snapshots** are schedulable (pick day/time + max slots). Retention = **ring buffer**:
  when the automatic slot limit is hit, the **oldest automatic** snapshot is deleted on the next
  run. **Manual snapshots are never auto-deleted.**
- **Restore two ways:** (a) browse/pull individual files read-only from the hidden
  **`/.zfs/snapshot/`** dir over SFTP; (b) full **rollback** of the whole box via Console or the
  API's "Rollback Snapshot" action (reverts everything after the snapshot — including newer
  snapshots).
- **NOT DR:** they live on the *same* box; you **cannot create a new box from a snapshot**. If the
  box is lost, the snapshots go with it. Their value is **undo / anti-ransomware**: a leaked SFTP
  credential that wipes your pushed archives can't touch a read-only snapshot. Off-box copies are
  still required for real disaster recovery.

### Storage Box **management API** (automation)

Two APIs; the next-gen line uses the **new one**, the legacy Robot API is being retired.

**New Hetzner (Cloud) API** — base `https://api.hetzner.com/v1` (Cloud tooling also references
`api.hetzner.cloud/v1`), **Bearer project token**, **3600 req/hr/project**, `429` on overflow with
`RateLimit-*` headers. Storage Boxes are a first-class resource (launched 25 Jun 2025). Confirmed
capabilities (via changelog + Terraform + Ansible + hcloud-python; exact REST path strings are in a
JS-rendered SPA and not quoted verbatim — verify before hardcoding routes):

- **Box lifecycle:** create / update / delete (+ delete-protection), labels, **change type** (resize).
- **`reset_password`** action.
- **`update_access_settings`:** toggle Samba, WebDAV, SSH, `reachable_externally`, ZFS
  snapshot-folder visibility.
- **Snapshot plan (automatic):** enable/disable with `max_snapshots`, `minute`, `hour`,
  `day_of_week`, `day_of_month`.
- **Snapshots:** create / list / **rollback** (takes `snapshot` name-or-ID since 21 Oct 2025).
- **Sub-accounts:** create / update / delete / reset password / **change home directory**.
- **Tooling:** `hcloud storage-box` CLI group; Terraform `hcloud_storage_box` (+ separate subaccount
  & snapshot resources); Ansible `hetzner.hcloud.storage_box`; `hcloud-python`.

**Legacy Robot API** — `https://robot-ws.your-server.de`, **Basic auth** (Robot user/pass). Same
conceptual ops under `/storagebox/{id}/…` (`snapshot`, `snapshotplan`, `subaccount`, `password`).
Being retired for Storage Boxes (support ended 29 Jul 2025) — don't build new work on it.

---

## Layer 1 & 2: DB + volume backup tooling to a Storage Box

### Tool comparison

| Dimension            | **BorgBackup**                         | **restic**                          | **rclone (ship archives)**    | **Plain dump → SFTP**        |
|----------------------|----------------------------------------|-------------------------------------|-------------------------------|------------------------------|
| Hetzner support      | **Yes** — server-side `borg serve`, docs | **Yes** — official tutorial, SFTP backend | **Yes** — named SFTP target | Yes (any SFTP on port 22)   |
| Dedup                | **Yes** (content-defined chunking)     | **Yes** (CDC ~1 MiB blobs)          | No (file-level)               | No                           |
| Encryption           | client-side (repokey/keyfile)          | **always** AES-256 + Poly1305       | optional (crypt remote)       | none unless you add gpg/age  |
| Append-only / anti-ransomware | **Yes**, Hetzner-documented (mark-deleted caveat) | via `rclone serve restic --append-only` (forum) | one-way key perms | none |
| Incremental          | Yes                                    | Yes                                 | mirrors current state         | **No — full dump every run** |
| Locking gotcha       | repo lock, single-writer               | **prune locks repo → blocks backups**; SFTP idle disconnects | `--sftp-connections` can deadlock | none (independent files) |
| Restore granularity  | per-file from any archive              | per-file from any snapshot          | whole-file                    | whole DB only                |
| Complexity           | medium                                 | medium                              | low                           | **lowest**                   |

- **Borg server-side versions:** `borg-1.1`, **`borg-1.2` (default)**, `borg-1.4`, selected via
  `--remote-path`. **Borg 2.0 is NOT offered** — don't pin a 2.x client.
- **Recommendation:** **Borg** for volume *directories* (best server-aware dedup + first-class
  append-only). **restic** if you want one tool across S3 *and* SFTP (always-encrypted, snapshot
  model). **rclone** to just ship + rotate already-compressed dump files. **Plain dump→SFTP** for
  small DBs where restore simplicity (`gunzip | psql`) beats storage efficiency.

### Streaming dumps (no local buffering)

```bash
# Plain: stream compressed dump straight to the box, no local temp file
pg_dump -Fc mydb | ssh -p23 uXXX@uXXX.your-storagebox.de 'cat > db/mydb-$(date +%F).dump'
mysqldump --single-transaction --routines mydb | gzip | ssh -p23 uXXX@uXXX.your-storagebox.de 'cat > db/mydb.sql.gz'

# restic via stdin — PREFER --stdin-from-command (watches exit code; --stdin can't detect truncation)
restic -r sftp:restic:./backup backup --stdin-from-command --stdin-filename mydb.sql -- pg_dump mydb

# borg via stdin — PREFER --content-from-command (fails the archive if pg_dump fails)
borg create --content-from-command --stdin-name mydb.sql --files-cache disabled \
  --remote-path=borg-1.4 ssh://uXXX@uXXX.your-storagebox.de:23/./repo::mydb-{now} -- pg_dump mydb
```

⚠️ **Streaming a *compressed* dump into restic/borg kills dedup** (compression destroys byte
alignment before the CDC layer, and you get one opaque object per run). If you want stdin dedup to
work, dump **uncompressed** and let borg/restic compress. For strong dedup, back up the DB **data
directory** (or an uncompressed dump), not a compressed stream.

### Retention / prune

- **`borg prune`** (`--keep-daily/weekly/monthly/yearly`, `--keep-within`) — but **prune does NOT
  free space; you must run `borg compact` after** (and under append-only it only *marks* deleted).
- **`restic forget --prune`** (same keep-\* vocabulary) — **prune locks the repo, blocking backups;
  schedule off-peak**. Refuses an empty policy.
- **Hand-rolled "keep-N + max-age + max-storage"** — the only model that can cap **absolute
  storage** (borg/restic can't express that directly), works on plain independent files, trivial
  restore. Downside: no dedup, and max-storage eviction can silently drop your oldest recovery point.
  **This is exactly what our `retention.ts` does today, and what Coolify does.**

### How competitors do it (differentiation opportunity)

- **Coolify:** local disk by default, optional **S3-compatible only** (uploads with MinIO `mc`).
  Dumps via `docker exec` native tools. Retention = 3-axis (count/days/max-storage), tracked
  separately for local vs S3. **No native SFTP / Storage Box / Borg.**
- **Dokploy:** **S3-only in the UI**, but the transport is **`rclone copyto`** — so a Storage Box is
  reachable via a custom rclone remote, just not first-class. Retention = keep-last-N only.
- **Takeaway:** neither natively targets **Borg** or a **Hetzner Storage Box**. First-class
  **SFTP/Storage Box + Borg append-only + sub-account isolation** is a genuine gap we could own.

---

## Layer 3: Hetzner Cloud VM snapshots & automatic backups

**Scope:** Hetzner **Cloud** servers only (`api.hetzner.cloud/v1`, Bearer token). **Not** dedicated/
Robot bare-metal, **not** other providers.

### Snapshots (manual, on-demand disk image)

- Captures a **full image of the server's root disk** — **excludes attached Volumes.** Persists
  until you delete it.
- **Cost ≈ €0.0143/GB/mo** (post-1-Apr-2026; was €0.011), billed on **compressed, used** size (not
  provisioned disk). ⚠️ verify against the live pricing widget.
- **Create:** `POST /servers/{id}/actions/create_image` `{ "type": "snapshot", "description", "labels" }`
  → returns an **action** to poll. CLI: `hcloud server create-image --type snapshot <server>`.
- **Restore:** (a) **rebuild same server** `POST /servers/{id}/actions/rebuild { image }` —
  **destroys the target disk**; or (b) **create a new server from the image**. Architecture must
  match (x86↔x86, Arm↔Arm); target disk must be ≥ source (standard, not quoted verbatim in docs).
- **List/delete:** `GET /images?type=snapshot`, `DELETE /images/{id}`.
- **Limit:** ~30 snapshots/account by default (raise via support).

### Automatic backups

- **+20% of the server's monthly price** (flat, disk-usage-independent). **7 daily slots**, rolling —
  oldest deleted when full (~last 7 days). **Deleted with the server.**
- **Convert a backup → snapshot** to keep one permanently (then billed at the snapshot GB rate).
- **Enable/disable:** `POST /servers/{id}/actions/enable_backup` / `disable_backup` — ⚠️ **disable
  deletes all existing backups.**

|                         | Snapshot                        | Automatic Backup            |
|-------------------------|---------------------------------|-----------------------------|
| Trigger                 | manual / your own cron          | automatic, daily            |
| Retention               | until you delete                | rolling last 7              |
| Pricing                 | ~€0.0143/GB/mo (compressed used)| +20% of server price (flat) |
| Survives server delete  | **yes**                         | no                          |
| Choose exact time       | yes                             | no                          |
| Includes attached Volumes | **no**                        | **no**                      |

### Automation & consistency

- **No native snapshot scheduler** — you cron the `create_image` call yourself and manage retention
  + the 30-snapshot cap. (Automatic *backups* are the only Hetzner-scheduled option.)
- ⚠️ **A running-server snapshot is only crash-consistent.** Hetzner recommends **powering off**
  first; **no guest quiescing / fsfreeze** is performed. For app-consistency without downtime:
  `fsfreeze -f` (snapshot) `fsfreeze -u`, or stop/quiesce the DB (Postgres `CHECKPOINT` /
  `pg_backup_start`, MySQL `FLUSH TABLES WITH READ LOCK`) around the call.
- **For databases, prefer the DB-native dump (layer 1) for app-consistency**; use the VM snapshot
  for whole-machine/OS recovery, not as the primary DB backup.

### Non-Cloud servers

- Cloud snapshots/backups **do not exist** for Hetzner **dedicated/Robot** bare-metal or other
  providers. Options there: **file-level / DB-native backups to a Storage Box** (or object storage),
  or hypervisor-level (Proxmox/ZFS/LVM) if you run one. Also note Cloud snapshots **can't be
  downloaded off-platform** (lock-in) — another reason portable file backups matter.

---

## How this maps to otterdeploy

Current state (`packages/api/src/backups/`): `local` / `s3` / **`sftp`** destinations;
`pg_dump`/`mysqldump` DB dumps; `tar` volume archives; AES-256-GCM at rest; hand-rolled retention
(`retention.ts`). Concrete recommendations:

1. **Storage Box works *today* as an `sftp` destination — ship that first.** `storage.ts`'s SFTP
   backend connects on **port 22** (its default) and does SFTP put/get — exactly what a Storage Box
   serves on 22. Point `host` at `uXXXXX.your-storagebox.de`, set `basePath`, use password or a
   **RFC4716-format** SSH key, and enable **External Reachability** on the box. Zero new engine code.
   Consider a thin "Hetzner Storage Box" preset over the `sftp` type (known host format, key-format
   hint) purely for UX.

2. **Fix the whole-archive memory buffering before pushing large data to a remote box.** Both
   `routers/system/backup.ts` and `storage.ts`'s `putArchive(…: Buffer)` buffer the entire archive
   in memory (the design doc already flags "a streaming path is the next step"). Fine for the
   control-plane metadata DB; **risky for large user DBs/volumes over a remote Storage Box.** Move to
   a streamed `pg_dump → SFTP` (or `--stdin-from-command`/`--content-from-command`) path.

3. **Sub-accounts = our multi-tenant isolation primitive.** 100 per box: provision one per org (or
   per destination) via the Hetzner API — own creds + directory jail + optional **read-only**
   restore account. Remember storage is **pooled** (no per-sub quota), so pair with our
   `maxStorageGb` retention axis to stop one tenant filling the box.

4. **Adopt Borg/restic only where dedup pays for itself.** Our current model = plain dump + tar +
   hand-rolled retention = fine for small resources and matches Coolify. For large/frequent volume
   backups, a **Borg (append-only) destination on port 23** would be a real differentiator vs
   Coolify/Dokploy — but it means **shelling out from a helper container** (the pure-JS
   `ssh2-sftp-client` path can't run borg). If we adopt borg/restic, **let the tool own encryption
   and retention** (don't double-encrypt with our AES-GCM; delegate to `borg prune`+`compact` /
   `restic forget --prune`).

5. **Storage Box snapshots (or borg append-only) = a cheap immutability layer.** Enable **automatic
   Storage Box snapshots** via the snapshot-plan API so a compromised server's leaked SFTP creds
   can't destroy our pushed archives. This is undo/anti-ransomware, *not* DR — keep it in addition
   to, not instead of, the pushed backups.

6. **VM snapshots are a new, separate backup `kind`, gated on Hetzner Cloud.** Add a `vm-snapshot`
   path that calls the hcloud `create_image` API — but **only expose it when the resource's server
   is a Hetzner Cloud VM** (we have a `server` table; gate on provider metadata + a stored hcloud
   token). Surface the **crash-consistency caveat** in the UI and, for DB-heavy servers, steer users
   to the DB-dump layer for app-consistency. This layer is orthogonal to the Docker-level engine and
   should not reuse the `backup_destination`/dump pipeline.

### Three-layer decision guide

| Need                                        | Use                                              |
|---------------------------------------------|--------------------------------------------------|
| Restore a single DB / table, portable       | **Layer 1** DB dump → Storage Box                |
| Restore app data/config files, portable     | **Layer 2** volume tar/borg/restic → Storage Box |
| Rebuild the whole machine fast (Hetzner Cloud) | **Layer 3** VM snapshot (hcloud API)          |
| Protect the *backups themselves* from tampering | Storage Box snapshots **or** borg append-only |
| Non-Hetzner-Cloud / bare-metal host         | Layers 1 & 2 only (no VM snapshot available)     |

---

## Open items to verify before coding

1. Exact live snapshot €/GB/mo and BX21/BX41 monthly prices (both were JS-rendered / mirror-sourced).
2. The precise new-API REST path strings for Storage Box actions (SPA docs; names confirmed, paths not).
3. `hcloud storage-box` subcommands for `subaccount`/`snapshot` (`hcloud storage-box --help`).
4. VM-snapshot restore disk-size constraint (architecture-match is documented; ≥-disk-size is standard but not quoted).
5. hcloud `backup_window` current behavior and the exact backup→snapshot conversion API call.
6. restic `rclone serve restic --stdio --append-only` on the box (forum-sourced, not official docs).

---

## Sources

**Storage Box product / protocols / auth / sub-accounts**
- Product page: https://www.hetzner.com/storage/storage-box/ · tiers /bx11/ /bx21/ /bx31/ /bx41/
- Docs general/overview: https://docs.hetzner.com/storage/storage-box/general/
- Access overview (port table): https://docs.hetzner.com/storage/storage-box/access/access-overview/
- SFTP/SCP (port 22): https://docs.hetzner.com/storage/storage-box/access/access-sftp-scp/
- SSH/rsync/Borg (port 23, whitelisted shell, restic/rclone): https://docs.hetzner.com/storage/storage-box/access/access-ssh-rsync-borg/
- SSH keys (RFC4716 vs OpenSSH): https://docs.hetzner.com/storage/storage-box/backup-space-ssh-keys/
- Creating a box (port 22 always on / SSH enables 23): https://docs.hetzner.com/storage/storage-box/getting-started/creating-a-storage-box/
- FAQ (BX10 legacy, migrate to BX11): https://docs.hetzner.com/storage/storage-box/faq/faq/
- Net-price mirror: https://www.whtop.com/plans/hetzner.com/128269 (…/128270, /128271, /128272)

**Storage Box snapshots & management API**
- Snapshots: https://docs.hetzner.com/storage/storage-box/snapshots/ · creating: https://docs.hetzner.com/storage/storage-box/getting-started/creating-snapshots/
- Hetzner API reference (Storage Boxes): https://docs.hetzner.cloud/reference/hetzner · changelog: https://docs.hetzner.cloud/changelog
- Terraform: https://registry.terraform.io/providers/hetznercloud/hcloud/latest/docs/resources/storage_box
- Ansible: https://docs.ansible.com/projects/ansible/latest/collections/hetzner/hcloud/storage_box_module.html
- hcloud-python: https://hcloud-python.readthedocs.io/en/stable/api.html · CLI: https://github.com/hetznercloud/cli
- Legacy Robot webservice: https://robot.hetzner.com/doc/webservice/en.html
- Migration/relaunch: https://status.hetzner.com/incident/f06ffe20-557f-4c7b-ac43-25ce40d96e5c · price adjustment: https://www.hetzner.com/pressroom/statement-price-adjustment/

**Backup tooling (Borg / restic / rclone) & competitors**
- Hetzner Borg tutorial: https://community.hetzner.com/tutorials/install-and-configure-borgbackup/
- Hetzner restic tutorial: https://community.hetzner.com/tutorials/storagebox-restic-docker-backup/
- Borg prune/create: https://borgbackup.readthedocs.io/en/stable/usage/prune.html · /create.html
- restic backup/forget/refs: https://restic.readthedocs.io/en/stable/040_backup.html · /060_forget.html · /100_references.html
- rclone SFTP: https://rclone.org/sftp/
- Coolify backups/API: https://coolify.io/docs/databases/backups · https://coolify.io/docs/api-reference/api/operations/create-database-backup
- Dokploy backups: https://docs.dokploy.com/docs/core/databases/backups · https://deepwiki.com/Dokploy/dokploy/12.2-database-backups

**Hetzner Cloud VM snapshots & backups**
- Overview/FAQ: https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/ · /faq/
- Taking snapshots / enabling backups: https://docs.hetzner.com/cloud/servers/getting-started/taking-snapshots/ · /enabling-backups/
- Cloud API: https://docs.hetzner.cloud/reference/cloud · hcloud-python servers: https://hcloud-python.readthedocs.io/en/latest/api.clients.servers.html
- Pricing analysis (Apr 2026 +30% EUR, compressed billing, 20% surcharge): https://cloudtally.eu/blog/hetzner-april-2026-price-increase · https://hetsnap.com/blog/hetzner-cloud-backup-vs-snapshot-pricing-comparison
- Snapshot-as-backup automation: https://github.com/fbrettnich/hcloud-snapshot-as-backup
