# otterd wire and data contract

Status: contract version 1, frozen for the otterd build. Source of truth:
`apps/otterd/crates/otterd-proto` (Rust). Mirror: `packages/otterd-proto`
(TypeScript, zod). Both are held to the shared fixtures in
`apps/otterd/crates/otterd-proto/fixtures/`. The daemon itself is described in
[`otterd.md`](otterd.md).

otterd is not wired into the installer or the control plane's runtime
selection yet. Nothing here changes behaviour for current installs.

## Rules that apply to every message

| Rule | Why |
|---|---|
| JSON, camelCase keys, kebab-case enum values, verbs as dotted names (`workload.apply`). | One spelling on both sides; a fixture test rejects any snake_case key. |
| Every integer is a `U53` (`0..=2^53−1`). Epochs, terms, generations, sequence numbers, byte counts, timestamps (`…UnixMs`) and durations (`…Ms`). | The control plane parses JSON as IEEE doubles. Larger values are refused on decode in both languages, never rounded. |
| Ids are opaque strings, `[A-Za-z0-9._:/@+-]{1,128}`. Node-minted ids carry a prefix (`att_`, `mut_`, `hold_`, `upd_`, `inc_`, `batch_`) and 128 random bits. | Attempts, mutations and holds cross the Engine boundary and are never reused, including on rollback. |
| Authority documents are **strict**: unknown fields are refused. Telemetry and reports are **lenient**: unknown fields are ignored. | A field that restricts authority (a new scope limit in a capability) must never be silently dropped by an older node; adding one needs a new protocol version. A new optional metric field must not break an older control plane. |
| Wall time is evidence and bounds validity windows. It never orders authority. | Ordering comes from epochs, terms and sequence numbers. |

Strict: `Capability`, `SlotGrant`, `LeaseRenewal`, `StopCertificate`,
`ServingSet`, `Membership`, `OwnerSnapshot`, `EnrollCertificate`,
`AuthorityRevocation`, every `Command`, every journal record, `SignedEnvelope`.
Lenient: control and bulk frames themselves, `SlotReport`, `LeaseRequest`,
`SampleBatch` and everything in it, `HostFacts`.

### Version negotiation (`version.rs`)

One integer names the protocol (`PROTOCOL_VERSION = 1`). The node sends the
range it speaks in `hello`; the control plane picks the highest version both
speak (`negotiate`) or answers `reject {code: unsupported-protocol, supported}`
so the operator sees which side must upgrade. That is the upgrade-order gate
of the release order. Separate counters version the journal format, the ServiceSpec
schema, the health evaluator IR and the metric schema. Optional behaviours are
`features` (`bulk`, `realtime-metrics`, `probe-executor`, `discovery-relay`,
`platform-bootstrap`, `key-rotation`), used only when both sides list them;
nothing that affects safety hides behind a feature.

### Signed envelopes (`envelope.rs`)

```json
{ "context": "otterd/capability/v1", "keyId": "<32 hex>", "payload": "<base64>", "signature": "<base64>" }
```

Ed25519 over `context || 0x00 || payload`, where `payload` is the exact bytes
the signer serialized. There is no canonical-JSON step: the verifier checks
the bytes and only then parses them. The context separates domains, so a
lease can never verify as a capability, and relabelling the context breaks
the signature. `keyId` is the first 16 bytes of SHA-256(public key), hex; a
verifier is given the set of keys it trusts for that context (two during a
rotation) and refuses any other. Ed25519 is deterministic: `vectors.json`
holds envelopes both languages reproduce byte for byte.

| Context | Signed by | Payload |
|---|---|---|
| `otterd/session/v1` | CP (hub) and node | `SessionProof` |
| `otterd/capability/v1` | CP | `Capability` |
| `otterd/lease/v1` | CP | `LeaseRenewal` |
| `otterd/enroll-request/v1` | node (new identity key) | `EnrollRequest` |
| `otterd/enroll/v1` | CP | `EnrollCertificate` |
| `otterd/key-rotation/v1` | node, old **and** new key | `KeyRotation` (as `CrossSigned`) |
| `otterd/cp-key-transition/v1` | CP, old and new key | `CpKeyTransition` |
| `otterd/stop-certificate/v1` | node | `StopCertificate` |
| `otterd/authority-revoke/v1` | offline recovery key | `AuthorityRevocation` |
| `otterd/platform-boot-manifest/v1` | install recovery key | `PlatformBootManifest` |
| `otterd/release-manifest/v1` | release key | `ReleaseManifest` |
| `otterd/owner-snapshot/v1` | owner node | `OwnerSnapshot` |
| `otterd/challenge-answer/v1` | owner node | `ChallengeAnswer` |
| `otterd/serving-set/v1` | CP | `ServingSet` |
| `otterd/membership/v1` | CP | `Membership` |
| `otterd/peer-answer/v1` | target node | `PeerAnswer` |
| `otterd/anchor/v1` | enrollment / recovery key | off-node anchor records (daemon core) |
| `otterd/key-rotation-ack/v1` | CP | `KeyRotationAck` |
| `otterd/release-keys/v1` | a current release key | `ReleaseKeySet` |

## Channels (`channel.rs`, `bulk.rs`)

otterd dials out; nothing listens on the node. Two WebSockets per node share
one session:

- **control**: `wss://<cp>/api/otterd/connect`, JSON text frames ≤ 64 KiB;
  commands, answers, reports, leases, telemetry, discovery relay.
- **bulk**: same URL, `hello.channel = "bulk"` plus `controlSessionId`;
  streams for logs, exec/PTY, archives, events.

Limits arrive in `welcome.limits`: 64 KiB frames, 16
active commands, 256 KiB control reserve, 2 MiB bulk queue, 256 KiB per-stream
window, 16 streams, 4,000 telemetry items of credit.

### Handshake

| # | Frame | Direction | Content and checks |
|---|---|---|---|
| 1 | `hello` | node → CP | version range, channel, install/node/epoch, key epoch and identity key id, boot id, process incarnation, otterd version, journal format, features, a fresh `nodeNonce`; host facts once per control connection. |
| 2 | `welcome` | CP → node | negotiated `protocol`, new `sessionId`, `cpNonce`, current `authorityTerm`, `cpUnixMs`, limits, common features, and `hubProof`: a CP-signed `SessionProof` covering both nonces. The node verifies it against the CP keys pinned at enrollment. |
| 2′ | `reject` | CP → node | `unsupported-protocol` (with `supported`), `unknown-node`, `revoked`, `stale-epoch`, `wrong-install`, `bad-proof`, `rate-limited`, `session-conflict`, `maintenance`. |
| 3 | `authenticate` | node → CP | `nodeProof`: the same `SessionProof` with `role: node`, signed by the identity key. |
| 4 | `ready` | CP → node | Session established. Nothing else is accepted before it. |

Because both proofs bind both nonces, the session id, boot id and incarnation,
neither can be replayed into another session. The node derives its clock
bound from the handshake and `ping`/`pong` round trips (`cpUnixMs ± rtt/2`);
without a bound it refuses new privileged work. `goAway` closes a
session from either side with a reason and an optional reconnect delay.

### Commands

| Frame | Direction | Meaning |
|---|---|---|
| `request {id, capability, payload}` | CP → node | `capability` is a signed `Capability`; `payload` is the exact JSON text of a `Command` whose SHA-256 the capability binds. `id` is unique among the session's active requests. |
| `requestRefused {id, error}` | node → CP | Refused before any claim: `busy`, `duplicate-id`, `malformed`, `capability` (with the `CapabilityError`), `verb-mismatch`, `op-mismatch`. No side effect, no journal record. |
| `progress {id, opId, seq, phase, message?}` | node → CP | Streaming progress (pull, gate, stop). |
| `response {id, opId, duplicate, outcome}` | node → CP | The `OpOutcome`. `duplicate: true` means the `opId` was already claimed with the same payload and the recorded outcome is returned instead of executing again. |
| `cancel {id, reason}` | CP → node | Cancels the generator or stream behind `id`. Committed work keeps going under its operation state. |

`encodeCommand` (TS) serializes a command once and returns the text and its
hash for the capability, which is the only correct way to build a request.

### Node state, leases and telemetry

| Frame | Direction | Meaning |
|---|---|---|
| `slotReports {seq, quarantined, engineReachable, slots}` | node → CP | Journalled slot state after `ready` and on every change. `engineReachable` is a reconcile result, never a startup gate: dockerd's inspect can hang while containerd is blocked. |
| `leaseRequest` / `lease {renewal}` | node → CP / CP → node | The node records its nonce and `CLOCK_BOOTTIME` send instant before sending; the signed `LeaseRenewal` consumes that nonce once and its duration counts from the send instant. One outstanding request per scope. |
| `telemetry` / `telemetryAck {batchId, disposition, credit}` | node → CP / CP → node | `SampleBatch`, credit-limited: a batch consumes one item per probe result, metric sample, marker and signal; `welcome` grants `telemetryCredit` items and each ack returns `credit` more, never beyond that window. The node never sends beyond credit, and control frames always go first. `deferred` = keep buffering and retry; `refused` = drop and count. |
| `discovery {from, to, message}` | relayed by the CP | A `DiscoveryMessage` when the peer path is down. The CP can carry but never answer a challenge. |
| `authority {document}` | CP → node | A signed serving set, membership revision or authority revocation. |

### Keys (feature `key-rotation`)

Without the feature, keys change only by re-enrollment. The verb set is
unchanged: rotation is a channel exchange, not a command.

| Frame | Direction | Meaning |
|---|---|---|
| `keyRotation {statement}` | node → CP | `CrossSigned` `KeyRotation`: the outgoing key signs, the incoming key signs the same bytes. The node has written the new epoch's keys before sending, and re-sends the same statement until it is acknowledged. |
| `keyRotationAck {ack}` | CP → node | CP-signed `KeyRotationAck {installId, nodeId, nodeEpoch, keyEpoch, identityKeyId, acceptedAtUnixMs}` naming exactly the new key. The node journals `keysRotated`, switches to the new epoch and reconnects with it. |
| `cpKeyTransition {transition}` | CP → node | `CpKeyTransition` as `CrossSigned` by the outgoing and the incoming CP key. The outgoing key must be valid when it arrives; the incoming key's epoch must exceed every trusted epoch. |
| `cpKeyTransitionAck {keyId, epoch}` | node → CP | The node journalled `cpKeysChanged`: it trusts the incoming key, and the outgoing key only until `oldValidUntilUnixMs`. |

### Bulk channel

Binary frames are data: `[version u8 = 1][pipe u8: 0 stdin, 1 stdout, 2 stderr][reserved u16 = 0][stream id u32 BE]` then the bytes.
Text frames:

| Frame | Meaning |
|---|---|
| `credit {streamId, pipe, bytes}` | Receiver grants more window. A sender never sends beyond credit (`SendWindow`); a receiver resets an overrun (`ReceiveWindow`), it never buffers without bound. Credit is batched until half the window is free. |
| `end {streamId, pipe, totalBytes, sha256?}` | Half-close one pipe; an import is committed only after the digest matches. |
| `exit {streamId, status}` | Process exit code or signal; the stream closes after it. |
| `resize {streamId, cols, rows}` | PTY resize. |
| `reset {streamId, code, message?}` | Abort: `credit-violation`, `max-bytes-exceeded`, `digest-mismatch`, `deadline-exceeded`, `cancelled`, `unknown-stream`, `internal`. Cancellation closes remote followers and sessions. |

The command that opens a stream carries its `StreamBinding {streamId,
direction, maxBytes, sha256?, deadlineUnixMs?, tty?}`; `maxBytes` must not
exceed the capability's `maxBytes`.

## Capabilities and replay protection (`capability.rs`)

```text
Capability { installId, orgId?, principal{kind,id}, aud, nodeEpoch, authorityTerm, verb,
             resourceId?, binding{slot, grantId, generation, attemptId?}?, pathRoot?, volume?,
             operationEpoch, opId, payloadHash, nonce, sessionId,
             notBeforeUnixMs, expiresAtUnixMs, maxBytes?, permissions[] }
```

`Capability::check` runs in a fixed order and refuses with a typed
`CapabilityError`:

1. install, audience node, node epoch and session id match;
2. term not revoked by the recovery root, and equal to the session's term;
3. time: a clock bound exists, its uncertainty ≤ 5 s, the window is non-empty
   and ≤ 60 s, `now + u < expiresAt` (the whole uncertainty interval is before
   expiry) and `now + u ≥ notBefore`;
4. `payloadHash = SHA-256(payload bytes)`;
5. the verb's required permissions are all present; a monitor-only node
   refuses every verb outside its allowlist;
6. `operationEpoch` is not older than the resource's journalled high-water.

Then `ReplayGuard::admit` accepts the nonce once and remembers it until
`expiresAt + u` has certainly passed; a full cache refuses rather than
forgetting an unexpired nonce. Only after both does the node durably claim
`opId + payloadHash` (journal `opClaimed`). Duplicate claim with the same hash
returns the recorded outcome; a different hash is `conflict`. An expired retry
uses `op.status` with a fresh capability instead of executing again.

A new session starts with an empty nonce cache, which is safe because a
capability is bound to its session id. A new node epoch or term invalidates
every capability for the old one.

Permissions: `read`, `mutate`, `stream-out`, `stream-in`, `interactive`,
`install-admin`, `platform`. The verb table (names, required permissions,
monitor allowlist) is exported to `fixtures/enums.json` and mirrored as
`VERB_TABLE` in TypeScript; principals are `user`, `service`, `system`,
`install-admin`, `platform`.

## Commands and outcomes (`command.rs`)

A `Command` is tagged by `verb`, which must equal the capability's verb. The
fixtures hold exactly one case per verb.

| Group | Verbs | Status |
|---|---|---|
| Lifecycle | `workload.apply {grant, spec}`, `workload.restart`, `workload.stop {grantId, reason, stopGraceMs?}`, `workload.remove`, `workload.inspect`, `workload.logs`, `job.run {grant, spec, runId}`, `op.status` | frozen |
| Node | `node.details`, `node.health`, `node.units`, `node.reclaim`, `node.upgrade {release}`, `node.decommission`, `node.reenroll {certificate}`, `node.retireByBarrier {evidence}`, `metrics.sample {cacheMs, includeDetails}`, `events.subscribe`, `health.configure {revision, checks}` | frozen |
| Containers, images, networks, volumes, pools, backups | `container.*`, `image.*`, `network.*`, `volume.*`, `pool.*`, `backup.*` | provisional, owned by the storage, image and network work |
| Interactive | `container.exec`, `db.connect`, `host.shell` | provisional |
| Platform reconcilers | `firewall.apply {generation, policy}`, `firewall.cscli`, `proxy.apply {generation, routes}`, `proxy.status`, `platform.update {manifest}` | provisional; `policy`/`routes` are `OpaqueDocument {schema, body, digest}` until those components publish schemas |

"Provisional" means the verb name and permissions are frozen and the
arguments may still change before release through a contract PR that updates
both mirrors and the fixtures.

`OpOutcome` (tagged by `status`): `accepted` (claimed; progress follows),
`completed {result}`, `failed {code, message, sideEffects: none | possible}`,
`unknown {reason}` (no terminal evidence; reconcile, never retry blindly),
`conflict {recordedPayloadHash}`, `rejected {error}`. `CommandResult` (tagged
by `kind`): `done`, `applied {grantId, attemptId}`, `stopped {certificate}`,
`stop-unresolved {grantId, reasons}` (start authority revoked but no positive
stop: the CP keeps the barrier and the grant stays Unknown), `slots`,
`operation {record}`, `stream-opened`, `retired {mutationCount}`, and
`document {schema, body}` for read results whose schema another component owns.

## Lifecycle documents (`lifecycle.rs`)

- **`SlotGrant`**: start authority for one slot generation, bound to node
  epoch, authority term and the node's process **incarnation**, so a grant
  never survives a daemon restart. Carries `exclusive`,
  `disconnectAction`, the delegated `restart` budget, `dataClaims` and
  `probeOnly` (a new attempt stays out of traffic until a serving set admits it).
- **`SlotReport`**: per slot, grant state (`prepared … released`, `unknown`),
  quarantine and revocation flags, and every attempt with its process
  observation (`absent | created | running | exited | unknown`) and every
  Engine mutation with its submission state (`not-submitted | submitted |
  settled | retired`). Process state and submission state are independent.
- **`StopCertificate`** (node-signed): the positive stop of a responsive node,
  binding node epoch, slot, grant, `opId`, every attempt, every container's
  final observation, empty cgroups, the mutation-inventory digest and count,
  and the boot id. The CP checks it in the same transaction that releases the
  grant.
- **`BarrierEvidence`**: `provider-power-off` (adapter, provider action id) or
  `manual-fence` (who asserted it), node epoch, boot id, observation time.
  Used by `node.retireByBarrier` and recorded on each retired mutation.
- **`LeaseRequest` / `LeaseRenewal`**: see the leases row above; renewal every
  5 s, duration 20 s by default.

## ServiceSpec (`spec.rs`, `spec-rules.ts`)

`ServiceSpecInput` is what the API, manifest and Compose normalization
produce; `normalize` fills the defaults and yields the fully explicit
`ServiceSpec` the CP stores and sends. Swarm ServiceSpec semantics:

- `mode`: `replicated {replicas}`, `global`, `job {maxConcurrent, completions}`;
- `task`: container (image reference and digest, command/args, env with
  literal or secret values, user, workdir, labels, init, tty, read-only root,
  stop signal and grace, capabilities, sysctls, image healthcheck
  `inherit | disable`, check refs), mounts (`volume | bind | tmpfs`, with the
  normalized `dataIdentity`), resources (limits and reservations), restart
  policy (`any | on-failure | none`, delay, max attempts, window), placement
  (constraints, architectures, roles, node allowlist, spread preferences,
  per-node cap);
- `update` / `rollback`: parallelism, delay, monitor, failure ratio (permille),
  failure action, order;
- `endpoint`: `vip` (default) or `dnsrr`, ports (internal or host-published),
  aliases, scopes;
- `lifecycle`: **per-service failover** `{policy: stay | reschedule, delayMs}`,
  `exclusive`, `disconnectAction`, `concurrencyGroup`, `concurrentSafe`.

Defaults:

| Basis | When | Failover | Exclusive | Disconnect | Update order |
|---|---|---|---|---|---|
| `mounted` | any volume or bind mount, including read-only | stay | yes | continue-existing | stop-first |
| `mount-free` | no data mounts (tmpfs is not data) | reschedule | no | stop | start-first, or stop-first with a host-published port |
| `job` | `mode.kind = job` | stay | yes | stop | stop-first |

Failover delay defaults to 60 s; missing reservations get 64 MiB and 0.05 CPU
and are listed in `resources.defaulted` so the UI can say they are defaults.
`lifecycle.overrides` lists fields set explicitly against the basis default,
so the consequences can be shown next to them.

`validate` never rewrites a choice; it returns stable issue codes:

| Code | Severity |
|---|---|
| `EXCLUSIVE_REQUIRES_STOP_FIRST`, `HOST_PORT_REQUIRES_STOP_FIRST` | error |
| `FAILOVER_DELAY_BELOW_MINIMUM` (< 30 s) | error |
| `SHARED_WRITABLE_MOUNT` (several tasks, writable data, no `concurrentSafe`) | error |
| `JOB_REQUIRES_EXCLUSIVE` | error |
| `MOUNT_SOURCE_REQUIRED`, `TMPFS_HAS_SOURCE`, `DUPLICATE_MOUNT_TARGET` | error |
| `FAILURE_RATIO_OUT_OF_RANGE`, `IMAGE_DIGEST_INVALID`, `SCHEMA_UNSUPPORTED` | error |
| `RESCHEDULE_LEAVES_DATA_BEHIND` | warning |
| `DNSRR_CLIENT_LIMITATIONS` | warning |

## Identity (`identity.rs`)

Three keys, generated on the node: Ed25519 identity, X25519 cache encryption,
WireGuard. Public halves travel as `NodeKeys {keyEpoch, identity,
cacheEncryption, wireguard}`.

- **Enrollment**: `EnrollRequest {token, nonce, keys, host, facts,
  requestedRoles, otterdVersion}` signed by the new identity key (proof of
  possession; the single-use token is inside the signature). The CP answers
  with an `EnrollCertificate {installId, nodeId, nodeEpoch, authorityTerm,
  roles, identityKeyId, keyEpoch, host, cpKeys, recoveryKey, controlUrl,
  anchor?, issuedAt, reason}`. A re-enrollment after a fence or journal loss is
  the same document with a higher epoch (`node.reenroll`).
- **Host binding**: machine id, DMI product UUID, provider binding
  `{provider, serverId, createdAt}`. Fencing addresses the provider id, never
  a name or IP; a cloned disk elsewhere does not match.
- **Key rotation**: `KeyRotation` cross-signed by the old and new identity keys
  (`CrossSigned {byOld, byNew}`). CP signing-key rotation: `CpKeyTransition`,
  both keys valid until `oldValidUntilUnixMs`.
- **Authority revocation**: `AuthorityRevocation {belowTerm, nodes?}` signed by
  the offline recovery key; delivered by the recovery tool over the control
  channel or written to disk from a rescue system.

## Platform boot manifest (`platform.rs`)

On a host that runs the control plane itself, otterd starts the platform from
a `PlatformBootManifest` signed by the install's recovery key: no control
plane, no registry. Platform membership comes only from this document.

- `installId`, `host` (the one machine it boots; a cloned disk elsewhere
  refuses), `bootstrapEpoch`, `manifestRevision`, `authorityTerm`,
  `previousManifestDigest?`, `compatibleRollback` (digests it may roll back to).
- `network {name, subnet, gateway}`, `recoveryListener?`,
  `preflight {requireNftTable?, forbidUnits}`.
- `members[]`: `name`, `role` (`postgres`, `redis`, `control-plane`, `edge`,
  `connector`), `image {reference, id: sha256:…, archive, archiveSha256}` (a
  local archive, loaded when the id is missing), `cmd`, `env`, `recoveryEnv`
  (only while the control plane runs in recovery mode), `data [{root, target,
  readOnly}]`, fixed `ip`, `publish`, `dependsOn`, `readiness` (`tcp`, `exec`,
  `http`), and `essentialConnector` (required for a connector).

`preflight()` (Rust) refuses before anything starts: an unknown schema,
duplicate members, unknown dependencies, cycles, anything but exactly one
control plane whose dependency closure holds Postgres and Redis, a non-digest
image id, an unsigned connector, and data roots outside
`/var/lib/otterd/platform` or overlapping another. It returns the start order.
The TypeScript mirror covers the document's shape.

## Releases (`release.rs`)

The installer pins the release keys on the node in root-only
`/etc/otterd/release-keys.json` (a `ReleaseKeySet {serial, keys: [{key,
notBeforeUnixMs?, notAfterUnixMs?}]}`). A replacement set must be signed by a
key of the current one under `otterd/release-keys/v1` and carry a higher
`serial`, so release keys rotate without reinstalling. They are not part of
enrollment.

A `ReleaseManifest {version, artifacts: [{arch, sha256, size}], protocol,
journalFormat, minRollbackVersion, issuedAtUnixMs}` is signed by a release key
valid at the time it is checked. The node installs a binary only when its
architecture's artifact matches it by size and SHA-256, and rolls back only to
a release at or above `minRollbackVersion` with a compatible journal format.
`node.upgrade` carries a signed manifest. The node downloads the binary for
its architecture from `<release URL>/v<version>/otterd-linux-<arch>` (default
release URL `https://get.otterdeploy.com/otterd`; `arch` is `x86_64` or
`aarch64`), so a release must be published at that path. It checks the signed
size and SHA-256, stages it in the inactive A/B slot, answers with the staged
version, and restarts into it behind the boot guard.

## Discovery (`discovery.rs`)

`OwnerSnapshot` (owner-signed full endpoint set; replaces the previous set
atomically, omission deletes, empty is meaningful), `FreshnessChallenge` →
`ChallengeAnswer` (single-use nonce; eligibility expires at the challenge's
send instant plus 30 s, never at receipt), `ServingSet` (CP-signed exact
new-flow attempts and withdrawals for one VIP), `Membership` (CP-signed, with
retained tombstones), `SnapshotChunk` (≤ 64 KiB, ≤ 4 MiB assembled), digest
exchange, and `PeerChallenge` → `PeerAnswer` for peer reachability, which
never extends a lease or proves a stop.

## Health and metric frames (`health.rs`, `metrics.rs`)

- **`HealthCheck`**: role (`readiness | liveness | uptime`),
  vantage, probe (`exec | tcp | http | grpc | dns | tls | icmp`; HTTP carries
  structured assertions `status-range | header-contains | body-contains |
  json-equals`, DNS a closed `expect` of `answer {contains?} | nxdomain |
  servfail`, TLS an SNI `serverName`, `tlsVerify` and an optional CA bundle
  reference), interval,
  attempt timeout, retries, backoff, round budget, thresholds, holds, and
  `healthAction`. `validate` refuses `restart` on anything but liveness and a
  round budget below `attempts·timeout + (attempts−1)·backoff + 4 s` or not
  below the interval.
- **`ProbeResult`**: the full `ObservationIdentity` (check and revision,
  subject, generation, attempt, vantage, observer node, epoch, boot, sample
  sequence), attempts with outcome/cause/phase, one final outcome
  (`success | target-failure | unknown | configuration-error`; only the first
  two are votes; `round_outcome(attempts, configured)` folds attempts into one
  vote, and a round that ran fewer than the configured attempts without a
  success is Unknown), bounded cause codes (including `connection_reset`,
  `protocol_error`, `dns_servfail`, `dns_nxdomain`, `round_budget_exceeded`,
  `executor_overloaded`, `ca_material_missing`, `invalid_target`), failure
  domain, qualification, times with clock uncertainty, TTL, latency phases.
- **`MetricSample`**: `MetricIdentity` (with `dimensionSet` and schema
  version), observation time, uncertainty, the requesting interval, TTL, and
  named values from a fixed vocabulary. `null` means not measured; a counter
  rollback or ceiling breach is sent as `null`, never as a wrong number. At
  most 16 non-container dimensions per node, enforced at the source.
- **`SeriesMarker`**: `boot | gap-start | gap-end | tombstone |
  maintenance-start | maintenance-end`.
- **`NodeSignal`**: the built-in node alerts (`firewall-drift`,
  `docker-rules-missing`, `mesh-peer-blocked`, `vip-receiver-stalled`,
  `dns-responder-down`) plus `engine-unreachable`, `watchdog-restart`,
  `boot-quarantine`, `probe-capacity`. None is a fencing or failover input.
- **`SampleBatch`**: `{batchId, nodeId, nodeEpoch, bootId, live, probes,
  metrics, markers, signals}`. `live: false` is replay from the local buffer:
  it can correct history but never raise a current alert.

## Journal records (`journal.rs`)

One durable fact per record, appended and fsynced before the side effect it
authorizes. On disk: an 8-byte header (`ODJ1`, journal format `u32 LE`), then
frames of `len u32 LE`, `crc32c u32 LE` and the JSON `Entry {seq, atUnixMs,
record}`. A torn tail is truncated; a bad frame
elsewhere refuses to open (corruption is recovery, not repair).

| Record | Written when |
|---|---|
| `format` | first record of every file |
| `identity`, `keysRotated`, `cpKeysChanged` | enrollment / re-enrollment, key rotations |
| `processStarted` | every process start: leases invalid, quarantine on |
| `authorityRevoked` | a verified recovery-root revocation |
| `opClaimed`, `opCompleted` | before any side effect / when the outcome is terminal |
| `grantAccepted`, `grantRevoked` | grant installed / start authority revoked before any stop is sent |
| `attemptBegun` | each attempt, initial, supervisor restart or manual |
| `mutationIntent`, `mutationSubmitted`, `mutationSettled`, `mutationRetired` | the Engine submission states; `submitted` is fsynced before the request is sent |
| `stopCertified` | the signed certificate, kept so a duplicate stop returns it |
| `quarantineCleared` | a fresh grant for this incarnation lifts boot quarantine for a slot |
| `holdIntent`, `holdStaged`, `holdUnknown`, `holdReleased` | retained-mount staging |
| `manifestActivated`, `updatePhaseEntered` | platform boot manifest and update phases; `schema-boundary` is the first irreversible phase |
| `highWater` | durable monotonic counters (operation epoch, serving revision, membership epoch, publisher sequence, sample sequence, slot report sequence) |
| `compacted` | heads a compacted file that keeps every record an open obligation still references |

## Parity

`cargo test -p otterd-proto` parses every fixture case into its Rust type,
re-serializes it and requires the file to be unchanged; `OTTERD_PROTO_BLESS=1`
rewrites the files after an intentional change. `bun test` in
`packages/otterd-proto` parses the same files with the zod schemas and
requires identical output, checks that every Rust schema has a mirror,
compares enum lists and the verb table, reproduces the signature vectors byte
for byte, and runs ServiceSpec normalization and validation on every case of
`spec-normalize.json`. A contract change therefore touches the Rust type, the
fixtures and the zod schema in one commit, or one of the two suites fails.
