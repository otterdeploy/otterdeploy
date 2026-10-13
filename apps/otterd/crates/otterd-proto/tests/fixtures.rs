//! Shared fixtures: the cross-language parity contract.
//!
//! Every case below is parsed into its Rust type (which validates it) and
//! re-serialized; the canonical JSON is what `fixtures/` holds. The TypeScript
//! mirror parses the same files with its zod schemas and must reproduce them
//! exactly. Run with `OTTERD_PROTO_BLESS=1` to rewrite the files after an
//! intentional contract change; without it, a stale file fails the test.

// Fixture data is JSON-shaped: literal millisecond values and long case lists
// read better as they appear on the wire.
#![allow(
    clippy::unreadable_literal,
    clippy::too_many_lines,
    clippy::unwrap_used,
    clippy::panic,
    clippy::needless_pass_by_value
)]

use ed25519_dalek::SigningKey;
use otterd_proto::bulk::{BulkFrame, DataHeader, Pipe};
use otterd_proto::capability::{Capability, Permission, Verb};
use otterd_proto::channel::{ControlFrame, SessionProof};
use otterd_proto::command::{Command, CommandResult, OpOutcome};
use otterd_proto::discovery::{
    ChallengeAnswer, DiscoveryMessage, Membership, OwnerSnapshot, PeerAnswer, ServingSet,
};
use otterd_proto::envelope::{PublicKey, SignContext, SignedEnvelope};
use otterd_proto::health::{
    AttemptResult, Cause, HealthCheck, Outcome, ProtocolPhase, round_outcome,
};
use otterd_proto::identity::{
    AuthorityRevocation, CpKeyTransition, CrossSigned, EnrollCertificate, EnrollRequest,
    KeyRotation, KeyRotationAck, NodeRole,
};
use otterd_proto::journal::Entry;
use otterd_proto::lifecycle::{LeaseRenewal, SlotGrant, SlotReport, StopCertificate};
use otterd_proto::metrics::{MetricName, SampleBatch, SignalKind};
use otterd_proto::platform::{PlatformBootManifest, PlatformRole};
use otterd_proto::release::{ReleaseKeySet, ReleaseManifest};
use otterd_proto::spec::{ServiceSpecInput, SpecIssueCode};
use otterd_proto::version::{Feature, VersionRange, negotiate};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::path::PathBuf;

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures")
}

fn bless() -> bool {
    std::env::var_os("OTTERD_PROTO_BLESS").is_some()
}

/// Write or compare one fixture file.
fn check_file(name: &str, value: &Value) {
    let path = fixtures_dir().join(name);
    let text = format!("{}\n", serde_json::to_string_pretty(value).unwrap());
    if bless() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, text).unwrap();
        return;
    }
    let on_disk = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{name}: {e}; run with OTTERD_PROTO_BLESS=1"));
    assert_eq!(
        on_disk, text,
        "{name} is stale; run with OTTERD_PROTO_BLESS=1"
    );
}

/// Parse into `T`, re-serialize, and require a lossless round trip.
fn canonical<T: Serialize + DeserializeOwned>(case: Value) -> Value {
    let typed: T = serde_json::from_value(case.clone())
        .unwrap_or_else(|e| panic!("{}: {e}\n{case:#}", std::any::type_name::<T>()));
    let back = serde_json::to_value(&typed).unwrap();
    let again: T = serde_json::from_value(back.clone()).unwrap();
    assert_eq!(serde_json::to_value(&again).unwrap(), back);
    back
}

fn schema_file<T: Serialize + DeserializeOwned>(schema: &str, cases: Vec<Value>) {
    let cases: Vec<Value> = cases.into_iter().map(canonical::<T>).collect();
    check_file(
        &format!("schemas/{schema}.json"),
        &json!({ "schema": schema, "cases": cases }),
    );
}

fn key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}

fn public(seed: u8) -> PublicKey {
    PublicKey::from_verifying_key(&key(seed).verifying_key())
}

fn sign(seed: u8, ctx: SignContext, value: &Value) -> Value {
    serde_json::to_value(SignedEnvelope::sign(&key(seed), ctx, value).unwrap()).unwrap()
}

const CP: u8 = 1;
const NODE: u8 = 2;
const RECOVERY: u8 = 3;
const NONCE_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const NONCE_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const DIGEST: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

fn stream(id: u32, direction: &str) -> Value {
    json!({"streamId": id, "direction": direction, "maxBytes": 1_048_576,
           "deadlineUnixMs": 1_791_000_060_000_u64})
}

fn spec_input_mounted() -> Value {
    json!({
        "resourceId": "res_pg",
        "task": {
            "container": {"image": {"reference": "postgres:17",
                "digest": "sha256:1111111111111111111111111111111111111111111111111111111111111111"},
                "env": [{"name": "POSTGRES_PASSWORD", "value": {"kind": "secret", "secretRef": "sec_pg"}}],
                "stopGraceMs": 30000},
            "mounts": [{"kind": "volume", "source": "pgdata", "target": "/var/lib/postgresql/data",
                        "dataIdentity": "vol:inst_1:6f1c"}],
            "resources": {"limits": {"memoryBytes": 1_073_741_824_u64}}
        }
    })
}

fn spec_input_web() -> Value {
    json!({
        "resourceId": "res_web",
        "mode": {"kind": "replicated", "replicas": 3},
        "task": {
            "container": {"image": {"reference": "ghcr.io/acme/web:1"},
                          "command": ["/app/web"], "args": ["--port", "8080"],
                          "labels": {"tier": "web"}, "checks": [{"id": "chk_web", "revision": 2}]},
            "placement": {"constraints": [{"key": "node.labels.zone", "op": "eq", "value": "a"}],
                          "architectures": ["amd64"], "preferences": [{"label": "zone"}],
                          "maxReplicasPerNode": 2}
        },
        "update": {"parallelism": 1, "delayMs": 10000, "failureAction": "rollback"},
        "endpoint": {"ports": [{"targetPort": 8080}], "aliases": ["web"], "scopes": ["scope_prod"]}
    })
}

fn slot_grant() -> Value {
    json!({
        "grantId": "grant_1", "slot": {"resourceId": "res_pg", "index": 0}, "generation": 4,
        "authorityTerm": 2, "nodeEpoch": 3, "incarnation": "inc_0123456789abcdef0123456789abcdef",
        "exclusive": true, "disconnectAction": "continue-existing",
        "restart": {"condition": "on-failure", "delayMs": 5000, "maxAttempts": 3, "windowMs": 60000},
        "dataClaims": [{"dataIdentity": "vol:inst_1:6f1c", "claimEpoch": 1, "access": "rw"}],
        "probeOnly": false
    })
}

fn slot_report() -> Value {
    json!({
        "slot": {"resourceId": "res_pg", "index": 0}, "grantId": "grant_1", "generation": 4,
        "state": "unknown", "quarantined": true, "revoked": true,
        "attempts": [{
            "attemptId": "att_0123456789abcdef0123456789abcdef", "ordinal": 1,
            "container": "otterd-res_pg-0-att_0123",
            "process": {"state": "unknown", "reason": "engine inspect timed out"},
            "mutations": [
                {"mutationId": "mut_00000000000000000000000000000001", "verb": "create", "state": "settled"},
                {"mutationId": "mut_00000000000000000000000000000002", "verb": "start", "state": "submitted"}
            ]
        }],
        "unknownHolds": ["hold_00000000000000000000000000000001"]
    })
}

fn stop_certificate() -> Value {
    json!({
        "installId": "inst_1", "nodeId": "node_1", "nodeEpoch": 3,
        "slot": {"resourceId": "res_pg", "index": 0}, "grantId": "grant_1", "opId": "op_stop_1",
        "attemptIds": ["att_0123456789abcdef0123456789abcdef"],
        "containers": [{"container": "otterd-res_pg-0-att_0123", "process": {"state": "exited", "exitCode": 0}}],
        "cgroupsEmpty": true, "mutationInventoryDigest": DIGEST, "mutationCount": 4,
        "bootId": "4c1d1b7e-1d8a-4f0b-9d3e-000000000001", "issuedAtUnixMs": 1_791_000_000_000_u64
    })
}

fn capability() -> Value {
    json!({
        "installId": "inst_1", "orgId": "org_1",
        "principal": {"kind": "system", "id": "scheduler"},
        "aud": "node_1", "nodeEpoch": 3, "authorityTerm": 2, "verb": "workload.apply",
        "resourceId": "res_pg",
        "binding": {"slot": {"resourceId": "res_pg", "index": 0}, "grantId": "grant_1", "generation": 4},
        "operationEpoch": 9, "opId": "op_apply_1", "payloadHash": DIGEST, "nonce": NONCE_A,
        "sessionId": "sess_1", "notBeforeUnixMs": 1_791_000_000_000_u64,
        "expiresAtUnixMs": 1_791_000_030_000_u64, "permissions": ["mutate"]
    })
}

fn health_check() -> Value {
    json!({
        "installId": "inst_1", "orgId": "org_1", "id": "chk_web", "revision": 2,
        "subjectId": "res_web", "resourceId": "res_web", "role": "readiness", "vantage": "serving-path",
        "probe": {"kind": "http", "url": "http://10.240.0.5:8080/healthz", "method": "GET",
                  "assertions": [{"kind": "status-range", "min": 200, "max": 299},
                                 {"kind": "header-contains", "name": "content-type", "value": "json"},
                                 {"kind": "body-contains", "value": "ok"},
                                 {"kind": "json-equals", "pointer": "/status", "value": "pass"}],
                  "followRedirects": false, "maxRedirects": 0, "tlsVerify": true},
        "intervalMs": 60000, "attemptTimeoutMs": 5000, "retries": 1, "retryBackoffMs": 1000,
        "roundBudgetMs": 15000, "startPeriodMs": 10000, "failureThreshold": 3, "successThreshold": 1,
        "readyHoldMs": 10000, "degradedAfterMs": 2000, "healthAction": "none",
        "outcomePolicyRevision": 1
    })
}

fn key_rotation() -> Value {
    json!({"installId": "inst_1", "nodeId": "node_1", "nodeEpoch": 3,
        "fromKeyEpoch": 1, "newKeys": {"keyEpoch": 2, "identity": public(6),
        "cacheEncryption": public(7), "wireguard": public(8)}, "reason": "scheduled"})
}

fn key_rotation_statement() -> Value {
    json!({
        "byOld": sign(NODE, SignContext::KeyRotation, &key_rotation()),
        "byNew": sign(6, SignContext::KeyRotation, &key_rotation())})
}

fn key_rotation_ack() -> Value {
    json!({"installId": "inst_1", "nodeId": "node_1", "nodeEpoch": 3, "keyEpoch": 2,
        "identityKeyId": public(6).key_id().to_string(), "acceptedAtUnixMs": 1_791_000_000_000_u64})
}

fn cp_key_transition() -> Value {
    json!({
        "installId": "inst_1", "fromKeyId": public(CP).key_id().to_string(),
        "to": {"key": public(9), "epoch": 2, "notAfterUnixMs": 1_822_536_000_000_u64},
        "oldValidUntilUnixMs": 1_791_604_800_000_u64})
}

fn sample_batch() -> Value {
    json!({
        "batchId": "batch_00000000000000000000000000000001", "nodeId": "node_1", "nodeEpoch": 3,
        "bootId": "4c1d1b7e-1d8a-4f0b-9d3e-000000000001", "live": true,
        "probes": [{
            "identity": {"installId": "inst_1", "orgId": "org_1", "checkId": "chk_web",
                "checkRevision": 2, "subjectId": "res_web", "generation": 7,
                "attemptId": "att_0123456789abcdef0123456789abcdef", "vantage": "serving-path",
                "observerNodeId": "node_1", "nodeEpoch": 3,
                "bootId": "4c1d1b7e-1d8a-4f0b-9d3e-000000000001", "sampleSeq": 41},
            "scheduledRound": 1200,
            "attempts": [
                {"outcome": "target-failure", "cause": "target_timeout", "phase": "connect", "elapsedMs": 5000},
                {"outcome": "success", "cause": "ok", "phase": "response", "elapsedMs": 12, "latencyUs": 11800}
            ],
            "finalOutcome": "success", "cause": "ok", "failureDomain": "target", "phase": "response",
            "outcomePolicyRevision": 1, "qualification": {"state": "qualified"},
            "observedAtUnixMs": 1_791_000_000_000_u64, "elapsedMonotonicMs": 6012,
            "clockUncertaintyMs": 20, "ttlMs": 135000,
            "latency": {"resolveUs": 200, "connectUs": 900, "firstByteUs": 10500, "totalUs": 11800}
        }, {
            "identity": {"installId": "inst_1", "orgId": "org_1", "checkId": "chk_tls",
                "checkRevision": 1, "subjectId": "res_web", "vantage": "outside",
                "observerNodeId": "node_mon", "nodeEpoch": 1,
                "bootId": "4c1d1b7e-1d8a-4f0b-9d3e-000000000009", "sampleSeq": 7},
            "scheduledRound": 3, "attempts": [],
            "finalOutcome": "unknown", "cause": "probe_capacity", "failureDomain": "executor",
            "phase": "schedule", "outcomePolicyRevision": 1,
            "qualification": {"state": "unqualified", "cause": "probe_capacity"},
            "observedAtUnixMs": 1_791_000_000_000_u64, "elapsedMonotonicMs": 0,
            "clockUncertaintyMs": 20, "ttlMs": 135000, "latency": {}
        }],
        "metrics": [{
            "identity": {"installId": "inst_1", "subjectId": "node_1", "nodeId": "node_1",
                "nodeEpoch": 3, "bootId": "4c1d1b7e-1d8a-4f0b-9d3e-000000000001", "sampleSeq": 42,
                "dimensionSet": "host", "schemaVersion": 1},
            "observedAtUnixMs": 1_791_000_000_000_u64, "clockUncertaintyMs": 20,
            "intervalMs": 60000, "ttlMs": 180000,
            "values": [{"name": "host.cpu.used_pct", "value": 12.5},
                       {"name": "host.load.1", "value": 0.42},
                       {"name": "host.mem.used_bytes", "value": 2_147_483_648_u64},
                       {"name": "host.swap.used_bytes", "value": null}]
        }],
        "markers": [{"kind": "boot", "atUnixMs": 1_790_999_000_000_u64, "seq": 1}],
        "signals": [{"kind": "firewall-drift", "active": true, "sinceUnixMs": 1_791_000_000_000_u64,
                     "detail": "table-deleted"}]
    })
}

#[test]
fn schemas() {
    let cap = capability();
    let cap_env = sign(CP, SignContext::Capability, &cap);
    let apply = json!({"verb": "workload.apply", "grant": slot_grant(),
        "spec": serde_json::to_value(serde_json::from_value::<ServiceSpecInput>(spec_input_mounted())
            .unwrap().normalize()).unwrap()});
    let stop_cert_env = sign(NODE, SignContext::StopCertificate, &stop_certificate());

    schema_file::<SignedEnvelope>("SignedEnvelope", vec![cap_env.clone()]);
    schema_file::<Capability>(
        "Capability",
        vec![
            cap.clone(),
            json!({
        "installId": "inst_1", "principal": {"kind": "install-admin", "id": "user_1"},
        "aud": "node_1", "nodeEpoch": 3, "authorityTerm": 2, "verb": "host.shell",
        "operationEpoch": 1, "opId": "op_shell_1", "payloadHash": DIGEST, "nonce": NONCE_B,
        "sessionId": "sess_1", "notBeforeUnixMs": 1_791_000_000_000_u64,
        "expiresAtUnixMs": 1_791_000_060_000_u64, "maxBytes": 67_108_864_u64,
        "permissions": ["interactive", "install-admin"]}),
        ],
    );

    let barrier = json!({"evidenceId": "ev_1", "method": "provider-power-off", "adapter": "hetzner",
        "providerActionId": "act_9", "nodeEpoch": 3, "bootId": "4c1d1b7e-1d8a-4f0b-9d3e-000000000001",
        "observedAtUnixMs": 1_791_000_000_000_u64});
    let commands = vec![
        apply.clone(),
        json!({"verb": "workload.restart", "grantId": "grant_1", "reason": "operator"}),
        json!({"verb": "workload.stop", "grantId": "grant_1", "reason": "rollout", "stopGraceMs": 10000}),
        json!({"verb": "workload.remove", "grantId": "grant_1"}),
        json!({"verb": "workload.release-adoption", "grantId": "grant_7",
               "restartPolicy": {"name": "unless-stopped"}}),
        json!({"verb": "workload.inspect", "resourceId": "res_pg"}),
        json!({"verb": "workload.logs", "resourceId": "res_web", "tail": 200, "follow": true,
               "stream": stream(1, "out")}),
        json!({"verb": "job.run", "grant": slot_grant(), "runId": "run_1",
               "spec": serde_json::to_value(serde_json::from_value::<ServiceSpecInput>(json!({
                   "resourceId": "res_job", "mode": {"kind": "job", "maxConcurrent": 1, "completions": 1},
                   "task": {"container": {"image": {"reference": "alpine:3"}, "args": ["true"]}}
               })).unwrap().normalize()).unwrap()}),
        json!({"verb": "op.status", "opId": "op_apply_1"}),
        json!({"verb": "node.details"}),
        json!({"verb": "node.health"}),
        json!({"verb": "node.units"}),
        json!({"verb": "node.reclaim", "targets": ["images", "build-cache"]}),
        json!({"verb": "node.upgrade", "release": sign(CP, SignContext::ReleaseManifest, &json!({"version": "0.2.0"}))}),
        json!({"verb": "node.decommission", "reason": "retired"}),
        json!({"verb": "node.reenroll", "certificate": sign(CP, SignContext::Enroll, &json!({"x": 1}))}),
        json!({"verb": "node.retireByBarrier", "evidence": barrier.clone()}),
        json!({"verb": "metrics.sample", "cacheMs": 60000, "includeDetails": false}),
        json!({"verb": "events.subscribe", "sinceCursor": "c-42", "stream": stream(2, "out")}),
        json!({"verb": "health.configure", "revision": 5, "checks": [health_check()]}),
        json!({"verb": "container.list", "all": true, "managedOnly": false}),
        json!({"verb": "container.inspect", "container": "abc123"}),
        json!({"verb": "container.logs", "container": "abc123", "follow": false, "stream": stream(3, "out")}),
        json!({"verb": "container.exec", "container": "abc123", "argv": ["sh"],
               "stream": {"streamId": 4, "direction": "duplex", "maxBytes": 1_048_576,
                          "tty": {"cols": 120, "rows": 40}}}),
        json!({"verb": "image.pull", "reference": "postgres:17", "registryAuthRef": "reg_1"}),
        json!({"verb": "image.push", "reference": "registry.local/acme/web:1"}),
        json!({"verb": "image.inspect", "reference": "postgres:17"}),
        json!({"verb": "image.list"}),
        json!({"verb": "image.remove", "reference": "postgres:16"}),
        json!({"verb": "image.prune"}),
        json!({"verb": "network.list"}),
        json!({"verb": "network.inspect", "name": "otterd-scope_prod"}),
        json!({"verb": "network.ensure", "name": "otterd-scope_prod", "scopeId": "scope_prod",
               "subnet": "10.240.1.0/27", "internal": false}),
        json!({"verb": "network.connect", "network": "otterd-scope_prod", "container": "abc123", "aliases": ["db"]}),
        json!({"verb": "network.disconnect", "network": "otterd-scope_prod", "container": "abc123"}),
        json!({"verb": "network.remove", "name": "old-net"}),
        json!({"verb": "volume.list"}),
        json!({"verb": "volume.inspect", "name": "pgdata"}),
        json!({"verb": "volume.create", "name": "pgdata", "dataIdentity": "vol:inst_1:6f1c"}),
        json!({"verb": "volume.remove", "name": "pgdata"}),
        json!({"verb": "volume.fs", "volume": "pgdata", "path": "/"}),
        json!({"verb": "volume.export", "volume": "pgdata", "path": "/", "stream": stream(5, "out")}),
        json!({"verb": "volume.import", "volume": "pgdata", "path": "/",
               "stream": {"streamId": 6, "direction": "in", "maxBytes": 1_048_576, "sha256": DIGEST}}),
        json!({"verb": "volume.snapshot", "volume": "pgdata", "snapshot": "pgdata@1"}),
        json!({"verb": "volume.clone", "source": "pgdata@1", "target": "pgdata-branch",
               "dataIdentity": "vol:inst_1:7a2d"}),
        json!({"verb": "pool.stats", "pool": "otterd"}),
        json!({"verb": "pool.trim", "pool": "otterd"}),
        json!({"verb": "pool.grow", "pool": "otterd", "addBytes": 10_737_418_240_u64}),
        json!({"verb": "backup.run", "backupId": "bk_1", "resourceId": "res_pg", "repositoryRef": "repo_1"}),
        json!({"verb": "backup.restore", "backupId": "bk_2", "resourceId": "res_pg",
               "repositoryRef": "repo_1", "snapshot": "snap_1"}),
        json!({"verb": "backup.status", "backupId": "bk_1"}),
        json!({"verb": "db.connect", "attemptId": "att_0123456789abcdef0123456789abcdef", "port": 5432,
               "stream": {"streamId": 7, "direction": "duplex", "maxBytes": 1_048_576}}),
        json!({"verb": "host.shell", "stream": {"streamId": 8, "direction": "duplex",
               "maxBytes": 67_108_864_u64, "tty": {"cols": 80, "rows": 24}}}),
        json!({"verb": "firewall.apply", "generation": 12,
               "policy": {"schema": "otterd.firewall-policy/1", "body": "{\"a\":1}",
                          "digest": "015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862"}}),
        json!({"verb": "firewall.cscli", "argv": ["decisions", "list", "-o", "json"]}),
        json!({"verb": "proxy.apply", "generation": 3,
               "routes": {"schema": "otterd.routes/1", "body": "{\"a\":1}",
                          "digest": "015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862"}}),
        json!({"verb": "proxy.status"}),
        json!({"verb": "platform.update", "manifest": sign(RECOVERY, SignContext::PlatformBootManifest, &json!({"x": 1}))}),
    ];
    // Every verb has exactly one case, in declaration order.
    let verbs: Vec<String> = commands
        .iter()
        .map(|c| c["verb"].as_str().unwrap().to_owned())
        .collect();
    let all: Vec<String> = Verb::ALL.iter().map(|v| v.as_str().to_owned()).collect();
    assert_eq!(verbs, all, "one command case per verb");
    schema_file::<Command>("Command", commands);

    let outcomes = vec![
        json!({"status": "accepted"}),
        json!({"status": "completed", "result": {"kind": "applied", "grantId": "grant_1",
               "attemptId": "att_0123456789abcdef0123456789abcdef"}}),
        json!({"status": "completed", "result": {"kind": "stopped", "certificate": stop_cert_env.clone()}}),
        json!({"status": "completed", "result": {"kind": "stop-unresolved", "grantId": "grant_1",
               "reasons": ["start mutation mut_00000000000000000000000000000002 is submitted"]}}),
        json!({"status": "completed", "result": {"kind": "slots", "slots": [slot_report()]}}),
        json!({"status": "completed", "result": {"kind": "operation", "record": {
               "opId": "op_apply_1", "verb": "workload.apply", "payloadHash": DIGEST,
               "claimedAtUnixMs": 1_791_000_000_000_u64, "outcome": {"status": "accepted"}}}}),
        json!({"status": "completed", "result": {"kind": "stream-opened", "streamId": 4}}),
        json!({"status": "completed", "result": {"kind": "adoption-released", "grantId": "grant_7",
               "container": "4f2a9c0d1e3b5a7c9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b3c5d"}}),
        json!({"status": "completed", "result": {"kind": "retired", "mutationCount": 3}}),
        json!({"status": "completed", "result": {"kind": "done"}}),
        json!({"status": "completed", "result": {"kind": "document", "schema": "otterd.node-details/1",
               "body": {"hostname": "w1"}}}),
        json!({"status": "failed", "code": "image-unavailable", "message": "digest not present",
               "sideEffects": "none"}),
        json!({"status": "unknown", "reason": "engine response lost"}),
        json!({"status": "conflict", "recordedPayloadHash": DIGEST}),
        json!({"status": "rejected", "error": {"code": "expired"}}),
        json!({"status": "rejected", "error": {"code": "stale-node-epoch", "got": 2, "current": 3}}),
        json!({"status": "rejected", "error": {"code": "stale-operation-epoch", "got": 8, "highWater": 9}}),
        json!({"status": "rejected", "error": {"code": "missing-permission", "verb": "host.shell",
               "missing": "install-admin"}}),
    ];
    schema_file::<OpOutcome>("OpOutcome", outcomes);
    schema_file::<CommandResult>("CommandResult", vec![json!({"kind": "done"})]);

    let session = |role: &str, channel: &str| {
        json!({
        "role": role, "channel": channel, "protocol": 1, "installId": "inst_1",
        "sessionId": "sess_1", "nodeId": "node_1", "nodeEpoch": 3,
        "bootId": "4c1d1b7e-1d8a-4f0b-9d3e-000000000001",
        "incarnation": "inc_0123456789abcdef0123456789abcdef", "nodeNonce": NONCE_A, "cpNonce": NONCE_B})
    };
    schema_file::<SessionProof>(
        "SessionProof",
        vec![session("hub", "control"), session("node", "bulk")],
    );

    let frames = vec![
        json!({"type": "hello", "protocol": {"min": 1, "max": 1}, "channel": "control",
               "installId": "inst_1", "nodeId": "node_1", "nodeEpoch": 3, "keyEpoch": 1,
               "identityKeyId": public(NODE).key_id().to_string(),
               "bootId": "4c1d1b7e-1d8a-4f0b-9d3e-000000000001",
               "incarnation": "inc_0123456789abcdef0123456789abcdef", "otterdVersion": "0.1.0",
               "journalFormat": 1, "features": ["bulk", "probe-executor"], "nodeNonce": NONCE_A,
               "facts": {"hostname": "w1", "arch": "amd64", "osId": "ubuntu", "osVersion": "24.04",
                         "kernel": "6.8.0-138-generic", "cpuCores": 4, "memoryBytes": 8_323_002_368_u64,
                         "dockerVersion": "29.9.0"}}),
        json!({"type": "hello", "protocol": {"min": 1, "max": 1}, "channel": "bulk",
               "installId": "inst_1", "nodeId": "node_1", "nodeEpoch": 3, "keyEpoch": 1,
               "identityKeyId": public(NODE).key_id().to_string(),
               "bootId": "4c1d1b7e-1d8a-4f0b-9d3e-000000000001",
               "incarnation": "inc_0123456789abcdef0123456789abcdef", "otterdVersion": "0.1.0",
               "journalFormat": 1, "features": [], "nodeNonce": NONCE_A, "controlSessionId": "sess_1"}),
        json!({"type": "welcome", "protocol": 1, "sessionId": "sess_1", "cpNonce": NONCE_B,
               "authorityTerm": 2, "cpUnixMs": 1_791_000_000_000_u64,
               "limits": serde_json::to_value(otterd_proto::channel::ChannelLimits::DEFAULT).unwrap(),
               "features": ["bulk"], "hubProof": sign(CP, SignContext::Session, &session("hub", "control"))}),
        json!({"type": "reject", "code": "unsupported-protocol", "message": "node must upgrade",
               "supported": {"min": 2, "max": 3}}),
        json!({"type": "authenticate", "sessionId": "sess_1",
               "nodeProof": sign(NODE, SignContext::Session, &session("node", "control"))}),
        json!({"type": "ready", "sessionId": "sess_1"}),
        json!({"type": "request", "id": 7, "capability": cap_env,
               "payload": serde_json::to_string(&apply).unwrap()}),
        json!({"type": "cancel", "id": 7, "reason": "client went away"}),
        json!({"type": "progress", "id": 7, "opId": "op_apply_1", "seq": 1, "phase": "pulling",
               "message": "3 of 7 layers"}),
        json!({"type": "response", "id": 7, "opId": "op_apply_1", "duplicate": false,
               "outcome": {"status": "completed", "result": {"kind": "applied", "grantId": "grant_1",
                           "attemptId": "att_0123456789abcdef0123456789abcdef"}}}),
        json!({"type": "requestRefused", "id": 8, "error": {"code": "busy"}}),
        json!({"type": "requestRefused", "id": 9, "error": {"code": "capability",
               "error": {"code": "payload-mismatch"}}}),
        json!({"type": "slotReports", "seq": 12, "quarantined": true, "engineReachable": false,
               "slots": [slot_report()]}),
        json!({"type": "slotReports", "seq": 13, "quarantined": false, "engineReachable": true,
               "slots": [], "platform": {"phase": "starting cp", "manifestDigest": "2".repeat(64),
               "members": {"pg": "ready (continued)", "redis": "ready"},
               "update": {"updateId": "upd_0123456789abcdef0123456789abcdef", "phase": "schema-boundary",
                          "irreversible": true, "fromManifestDigest": "1".repeat(64),
                          "toManifestDigest": "2".repeat(64)}}}),
        json!({"type": "leaseRequest", "nonce": NONCE_A, "nodeEpoch": 3,
               "bootId": "4c1d1b7e-1d8a-4f0b-9d3e-000000000001",
               "incarnation": "inc_0123456789abcdef0123456789abcdef", "grants": ["grant_1"]}),
        json!({"type": "lease", "renewal": sign(CP, SignContext::Lease, &json!({"x": 1}))}),
        {
            let mut t = sample_batch();
            t["type"] = json!("telemetry");
            t
        },
        json!({"type": "telemetryAck", "batchId": "batch_00000000000000000000000000000001",
               "disposition": "accepted", "credit": 4000}),
        json!({"type": "discovery", "from": "node_2", "to": "node_1", "message": {
               "kind": "challenge", "challenge": {"receiverId": "node_2",
               "receiverBoot": "4c1d1b7e-1d8a-4f0b-9d3e-000000000002", "ownerId": "node_1", "nonce": NONCE_B}}}),
        json!({"type": "authority", "document": sign(CP, SignContext::ServingSet, &json!({"x": 1}))}),
        json!({"type": "keyRotation", "statement": key_rotation_statement()}),
        json!({"type": "keyRotationAck", "ack": sign(CP, SignContext::KeyRotationAck, &key_rotation_ack())}),
        json!({"type": "cpKeyTransition", "transition": {
               "byOld": sign(CP, SignContext::CpKeyTransition, &cp_key_transition()),
               "byNew": sign(9, SignContext::CpKeyTransition, &cp_key_transition())}}),
        json!({"type": "cpKeyTransitionAck", "keyId": public(9).key_id().to_string(), "epoch": 2}),
        json!({"type": "ping", "seq": 3, "nodeMonoMs": 123_456}),
        json!({"type": "pong", "seq": 3, "nodeMonoMs": 123_456, "cpUnixMs": 1_791_000_000_000_u64}),
        json!({"type": "goAway", "code": "maintenance", "message": "control plane restarting",
               "reconnectAfterMs": 5000}),
    ];
    schema_file::<ControlFrame>("ControlFrame", frames);

    schema_file::<BulkFrame>(
        "BulkFrame",
        vec![
            json!({"type": "credit", "streamId": 4, "pipe": "stdin", "bytes": 262_144}),
            json!({"type": "end", "streamId": 6, "pipe": "stdin", "totalBytes": 1024, "sha256": DIGEST}),
            json!({"type": "exit", "streamId": 4, "status": {"kind": "code", "code": 0}}),
            json!({"type": "exit", "streamId": 8, "status": {"kind": "signal", "signal": "SIGHUP"}}),
            json!({"type": "resize", "streamId": 4, "cols": 200, "rows": 50}),
            json!({"type": "reset", "streamId": 5, "code": "credit-violation", "message": "overran window"}),
        ],
    );

    let mut adopting = slot_grant();
    adopting["grantId"] = json!("grant_2");
    adopting["generation"] = json!(5);
    adopting["adoptsAttempt"] = json!("att_0123456789abcdef0123456789abcdef");
    let mut legacy = slot_grant();
    legacy["grantId"] = json!("grant_7");
    legacy["generation"] = json!(1);
    legacy["adoptsContainer"] =
        json!("4f2a9c0d1e3b5a7c9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b3c5d");
    let mut networked = slot_grant();
    networked["network"] = json!({"scopeId": "scope_prod", "subnet": "172.24.0.32/27",
        "address": "172.24.0.37", "resolver": "172.30.228.1", "zone": "prod.otd.internal",
        "vip": {"vipId": "vip_web", "address": "172.31.0.7"}});
    schema_file::<SlotGrant>("SlotGrant", vec![slot_grant(), adopting, legacy, networked]);
    let mut held = slot_report();
    held["held"] = json!({"attemptId": "att_0123456789abcdef0123456789abcdef", "paused": true});
    let mut observed = slot_report();
    observed["state"] = json!("running");
    observed["quarantined"] = json!(false);
    observed["revoked"] = json!(false);
    observed["unknownHolds"] = json!([]);
    observed["attempts"][0]["process"] = json!({"state": "running", "pid": 4242});
    observed["attempts"][0]["observedSinceUnixMs"] = json!(1_791_000_000_000_u64);
    observed["attempts"][0]["mutations"][1]["state"] = json!("settled");
    schema_file::<SlotReport>("SlotReport", vec![slot_report(), held, observed]);
    let mut retained = stop_certificate();
    retained["containers"][0]["retained"] = json!(true);
    schema_file::<StopCertificate>("StopCertificate", vec![stop_certificate(), retained]);
    schema_file::<LeaseRenewal>(
        "LeaseRenewal",
        vec![json!({
        "installId": "inst_1", "nodeId": "node_1", "nodeEpoch": 3, "authorityTerm": 2,
        "bootId": "4c1d1b7e-1d8a-4f0b-9d3e-000000000001",
        "incarnation": "inc_0123456789abcdef0123456789abcdef", "nonce": NONCE_A,
        "grants": ["grant_1"], "durationMs": 20000})],
    );
    let with_probe = |probe: Value| {
        let mut c = health_check();
        c["probe"] = probe;
        c["role"] = json!("uptime");
        c["vantage"] = json!("outside");
        c
    };
    schema_file::<HealthCheck>(
        "HealthCheck",
        vec![
            health_check(),
            with_probe(
                json!({"kind": "exec", "command": {"kind": "argv", "argv": ["pg_isready"]},
                              "user": "postgres"}),
            ),
            with_probe(
                json!({"kind": "exec", "command": {"kind": "shell", "script": "test -f /ready"}}),
            ),
            with_probe(json!({"kind": "tcp", "host": "10.240.0.5", "port": 5432})),
            with_probe(json!({"kind": "grpc", "host": "10.240.0.6", "port": 9090,
                              "service": "app.Health", "tls": false})),
            with_probe(
                json!({"kind": "dns", "name": "example.com", "recordType": "A",
                              "server": "1.1.1.1", "expect": {"kind": "answer", "contains": "93.184.215.14"}}),
            ),
            with_probe(
                json!({"kind": "dns", "name": "gone.example.com", "recordType": "A",
                              "expect": {"kind": "nxdomain"}}),
            ),
            with_probe(
                json!({"kind": "dns", "name": "broken.example.com", "recordType": "AAAA",
                              "expect": {"kind": "servfail"}}),
            ),
            with_probe(json!({"kind": "tls", "host": "10.240.0.7", "port": 443,
                              "serverName": "app.example.com", "tlsVerify": true,
                              "caBundleRef": "sec_ca", "minDaysValid": 14})),
            with_probe(json!({"kind": "icmp", "host": "example.com"})),
        ],
    );
    schema_file::<SampleBatch>("SampleBatch", vec![sample_batch()]);

    let keys = json!({"keyEpoch": 1, "identity": public(NODE), "cacheEncryption": public(4),
                      "wireguard": public(5)});
    let host = json!({"machineId": "4f0c3c8e1b2a4d5e8f9a0b1c2d3e4f50",
                      "productUuid": "e3b0c442-98fc-1c14-9afb-f4c8996fb924",
                      "provider": {"provider": "hetzner", "serverId": "51234567",
                                   "createdAt": "2026-10-11T22:50:00Z"}});
    schema_file::<EnrollRequest>(
        "EnrollRequest",
        vec![json!({
        "token": "enr_abc", "nonce": NONCE_A, "keys": keys, "host": host,
        "facts": {"hostname": "w1", "arch": "arm64", "osId": "debian", "osVersion": "12",
                  "kernel": "6.1.0-25-arm64", "cpuCores": 2, "memoryBytes": 4_096_000_000_u64},
        "requestedRoles": ["worker"], "otterdVersion": "0.1.0"})],
    );
    schema_file::<EnrollCertificate>(
        "EnrollCertificate",
        vec![json!({
        "installId": "inst_1", "nodeId": "node_1", "nodeEpoch": 3, "authorityTerm": 2,
        "roles": ["worker", "edge"], "identityKeyId": public(NODE).key_id().to_string(),
        "keyEpoch": 1, "host": host,
        "cpKeys": [{"key": public(CP), "epoch": 1}], "recoveryKey": public(RECOVERY),
        "controlUrl": "wss://cp.example.com/api/otterd/connect",
        "anchor": {"endpoint": "https://nbg1.your-objectstorage.com", "bucket": "otter-anchor",
                   "prefix": "inst_1/", "region": "nbg1"},
        "issuedAtUnixMs": 1_791_000_000_000_u64, "reason": "fenced"})],
    );
    schema_file::<KeyRotation>("KeyRotation", vec![key_rotation()]);
    schema_file::<CrossSigned>("CrossSigned", vec![key_rotation_statement()]);
    schema_file::<KeyRotationAck>("KeyRotationAck", vec![key_rotation_ack()]);
    schema_file::<CpKeyTransition>("CpKeyTransition", vec![cp_key_transition()]);
    schema_file::<PlatformBootManifest>(
        "PlatformBootManifest",
        vec![json!({
            "schema": 1, "installId": "inst_1",
            "host": {"machineId": "0f5e3c2a9b8d4e1f8a7b6c5d4e3f2a1b",
                     "provider": {"provider": "hetzner", "serverId": "4711"}},
            "bootstrapEpoch": 1, "manifestRevision": 3, "authorityTerm": 2,
            "previousManifestDigest": "1".repeat(64), "compatibleRollback": ["1".repeat(64)],
            "network": {"name": "otterd-platform", "subnet": "10.250.0.0/24", "gateway": "10.250.0.1"},
            "members": [
                {"name": "pg", "role": "postgres", "ip": "10.250.0.2",
                 "image": {"reference": "postgres:17", "id": format!("sha256:{}", "a".repeat(64)),
                    "archive": "/var/lib/otterd/platform-images/pg.tar", "archiveSha256": "e".repeat(64)},
                 "data": [{"root": "/var/lib/otterd/platform/pg", "target": "/var/lib/postgresql/data"}],
                 "readiness": {"kind": "exec", "argv": ["pg_isready", "-U", "postgres"]}},
                {"name": "redis", "role": "redis", "ip": "10.250.0.3",
                 "image": {"reference": "redis:7", "id": format!("sha256:{}", "b".repeat(64)),
                    "archive": "/var/lib/otterd/platform-images/redis.tar", "archiveSha256": "f".repeat(64)},
                 "readiness": {"kind": "tcp", "port": 6379}},
                {"name": "cp", "role": "control-plane", "ip": "10.250.0.4",
                 "image": {"reference": "otterdeploy/server:1.4.0", "id": format!("sha256:{}", "c".repeat(64)),
                    "archive": "/var/lib/otterd/platform-images/server.tar", "archiveSha256": "d".repeat(64)},
                 "env": {"DATABASE_URL": "postgres://pg:5432/otterdeploy"},
                 "recoveryEnv": {"OTTERDEPLOY_RECOVERY": "1"},
                 "publish": [{"hostIp": "127.0.0.1", "hostPort": 3000, "containerPort": 3000}],
                 "dependsOn": ["pg", "redis"], "readiness": {"kind": "http", "port": 3000, "path": "/health"}},
                {"name": "tunnel", "role": "connector", "ip": "10.250.0.5", "essentialConnector": true,
                 "image": {"reference": "cloudflare/cloudflared:2026.1", "id": format!("sha256:{}", "9".repeat(64)),
                    "archive": "/var/lib/otterd/platform-images/tunnel.tar", "archiveSha256": "8".repeat(64)},
                 "cmd": ["tunnel", "run"], "dependsOn": ["cp"], "readiness": {"kind": "tcp", "port": 20241}}
            ],
            "recoveryListener": "127.0.0.1:3900",
            "preflight": {"requireNftTable": "inet otterd_base", "forbidUnits": ["otterdeploy-compose.service"]}
        })],
    );
    schema_file::<ReleaseManifest>(
        "ReleaseManifest",
        vec![json!({
            "version": "1.4.0",
            "artifacts": [
                {"arch": "x86_64", "sha256": "a".repeat(64), "size": 18_234_112},
                {"arch": "aarch64", "sha256": "b".repeat(64), "size": 17_100_800}
            ],
            "protocol": {"min": 1, "max": 1}, "journalFormat": 1,
            "minRollbackVersion": "1.3.0", "issuedAtUnixMs": 1_791_000_000_000_u64})],
    );
    schema_file::<ReleaseKeySet>(
        "ReleaseKeySet",
        vec![json!({"serial": 2, "keys": [
            {"key": public(10), "notAfterUnixMs": 1_822_536_000_000_u64},
            {"key": public(11), "notBeforeUnixMs": 1_791_000_000_000_u64}]})],
    );
    schema_file::<AuthorityRevocation>(
        "AuthorityRevocation",
        vec![json!({
        "installId": "inst_1", "belowTerm": 2, "issuedAtUnixMs": 1_791_000_000_000_u64,
        "reason": "restore from backup"})],
    );

    let endpoint = json!({"grantId": "grant_7", "slot": {"resourceId": "res_web", "index": 1},
        "generation": 7, "attemptId": "att_0123456789abcdef0123456789abcdef",
        "address": "10.240.1.5", "ports": [{"protocol": "tcp", "port": 8080}],
        "readinessRevision": 3, "scopeId": "scope_prod"});
    schema_file::<OwnerSnapshot>(
        "OwnerSnapshot",
        vec![
            json!({
        "nodeId": "node_1", "nodeEpoch": 3, "publisherIncarnation": 5, "seq": 1201,
        "membershipEpoch": 9, "placementRevision": 44, "fullSetDigest": DIGEST,
        "endpoints": [endpoint]}),
            json!({
        "nodeId": "node_1", "nodeEpoch": 3, "publisherIncarnation": 5, "seq": 1202,
        "membershipEpoch": 9, "placementRevision": 45, "fullSetDigest": DIGEST, "endpoints": []}),
        ],
    );
    schema_file::<ChallengeAnswer>(
        "ChallengeAnswer",
        vec![json!({
        "receiverId": "node_2", "receiverBoot": "4c1d1b7e-1d8a-4f0b-9d3e-000000000002",
        "nonce": NONCE_B, "snapshotDigest": DIGEST, "seq": 1201, "ownerEpoch": 3})],
    );
    schema_file::<ServingSet>(
        "ServingSet",
        vec![json!({
        "installId": "inst_1", "authorityTerm": 2, "scopeId": "scope_prod", "vipId": "vip_web",
        "vipAddress": "172.31.0.7", "names": ["web.prod.otd.internal", "www.prod.otd.internal"],
        "ports": [{"protocol": "tcp", "port": 8080}],
        "servingRevision": 18, "operationEpoch": 9,
        "newFlowAttempts": [{"grantId": "grant_7", "attemptId": "att_0123456789abcdef0123456789abcdef",
            "nodeEpoch": 3, "address": "10.240.1.5", "ports": [{"protocol": "tcp", "port": 8080}]}],
        "withdrawals": [{"attemptId": "att_fedcba9876543210fedcba9876543210",
            "withdrawalRevision": 18, "drainBudgetMs": 30000}]})],
    );
    schema_file::<Membership>(
        "Membership",
        vec![json!({
        "installId": "inst_1", "authorityTerm": 2, "membershipEpoch": 9,
        "members": [{"nodeId": "node_1", "nodeEpoch": 3,
            "identityKeyId": public(NODE).key_id().to_string(), "meshAddress": "10.250.0.1",
            "status": "active"}],
        "tombstones": [{"nodeId": "node_old", "throughEpoch": 4}]})],
    );
    schema_file::<PeerAnswer>(
        "PeerAnswer",
        vec![json!({
        "nodeId": "node_1", "bootId": "4c1d1b7e-1d8a-4f0b-9d3e-000000000001",
        "nonce": NONCE_A, "lastObservedCpTerm": 2})],
    );
    schema_file::<DiscoveryMessage>(
        "DiscoveryMessage",
        vec![
            json!({"kind": "answer", "answer": sign(NODE, SignContext::ChallengeAnswer, &json!({"x": 1}))}),
            json!({"kind": "chunk", "chunk": {"ownerId": "node_1", "seq": 1201, "snapshotDigest": DIGEST,
               "index": 0, "count": 1, "totalBytes": 3, "data": "YWJj"}}),
            json!({"kind": "digests", "entries": [{"ownerId": "node_1", "ownerEpoch": 3, "seq": 1201,
               "fullSetDigest": DIGEST}]}),
            json!({"kind": "pull-full-set", "ownerId": "node_1"}),
            json!({"kind": "peer-challenge", "challenge": {"challengerId": "node_2", "targetId": "node_1",
               "nonce": NONCE_B}}),
            json!({"kind": "peer-answer", "answer": sign(NODE, SignContext::PeerAnswer, &json!({"x": 1}))}),
        ],
    );

    let entry = |seq: u64, record: Value| json!({"seq": seq, "atUnixMs": 1_791_000_000_000_u64 + seq, "record": record});
    let mutation = json!({"mutationId": "mut_00000000000000000000000000000002", "class": "tenant",
        "slot": {"resourceId": "res_pg", "index": 0}, "grantId": "grant_1",
        "attemptId": "att_0123456789abcdef0123456789abcdef", "verb": "start",
        "objectName": "otterd-res_pg-0-att_0123", "container": "abc123", "payloadHash": DIGEST});
    schema_file::<Entry>(
        "JournalEntry",
        vec![
            entry(
                1,
                json!({"type": "format", "journalFormat": 1, "otterdVersion": "0.1.0"}),
            ),
            entry(
                2,
                json!({"type": "identity", "installId": "inst_1", "nodeId": "node_1", "nodeEpoch": 3,
            "keyEpoch": 1, "identityKeyId": public(NODE).key_id().to_string(),
            "cpKeys": [{"key": public(CP), "epoch": 1}], "recoveryKey": public(RECOVERY),
            "host": {"machineId": "4f0c3c8e1b2a4d5e8f9a0b1c2d3e4f50"}}),
            ),
            entry(
                3,
                json!({"type": "keysRotated", "keyEpoch": 2,
            "identityKeyId": public(6).key_id().to_string()}),
            ),
            entry(
                4,
                json!({"type": "cpKeysChanged", "cpKeys": [{"key": public(CP), "epoch": 1},
            {"key": public(9), "epoch": 2}]}),
            ),
            entry(
                5,
                json!({"type": "processStarted", "incarnation": "inc_0123456789abcdef0123456789abcdef",
            "bootId": "4c1d1b7e-1d8a-4f0b-9d3e-000000000001"}),
            ),
            entry(
                6,
                json!({"type": "authorityRevoked", "belowTerm": 2, "revocationDigest": DIGEST,
            "reason": "restore"}),
            ),
            entry(
                7,
                json!({"type": "opClaimed", "opId": "op_apply_1", "verb": "workload.apply",
            "payloadHash": DIGEST, "capabilityDigest": DIGEST, "sessionId": "sess_1",
            "operationEpoch": 9, "resourceId": "res_pg"}),
            ),
            entry(
                8,
                json!({"type": "grantAccepted", "grant": slot_grant(), "specDigest": DIGEST,
            "opId": "op_apply_1"}),
            ),
            entry(
                9,
                json!({"type": "attemptBegun", "grantId": "grant_1",
            "attemptId": "att_0123456789abcdef0123456789abcdef", "ordinal": 1, "reason": "initial"}),
            ),
            entry(
                10,
                json!({"type": "holdIntent", "hold": {"holdId": "hold_00000000000000000000000000000001",
            "dataIdentity": "vol:inst_1:6f1c", "claimEpoch": 1,
            "sourcePath": "/var/lib/docker/volumes/pgdata/_data",
            "stagingPath": "/run/otterd/stage/hold_00000000000000000000000000000001",
            "slot": {"resourceId": "res_pg", "index": 0},
            "attemptId": "att_0123456789abcdef0123456789abcdef"}}),
            ),
            entry(
                11,
                json!({"type": "holdStaged", "holdId": "hold_00000000000000000000000000000001",
            "backing": {"dev": 2049, "ino": 131_073, "mntId": 29}, "stagingMntId": 412}),
            ),
            entry(12, json!({"type": "mutationIntent", "mutation": mutation})),
            entry(
                13,
                json!({"type": "mutationSubmitted", "mutationId": "mut_00000000000000000000000000000002",
            "bootId": "4c1d1b7e-1d8a-4f0b-9d3e-000000000001",
            "incarnation": "inc_0123456789abcdef0123456789abcdef", "engineIncarnation": "29.9.0/pid:812"}),
            ),
            entry(
                14,
                json!({"type": "mutationSettled", "mutationId": "mut_00000000000000000000000000000002",
            "outcome": {"kind": "started"}}),
            ),
            entry(
                15,
                json!({"type": "mutationSettled", "mutationId": "mut_00000000000000000000000000000001",
            "outcome": {"kind": "refused", "status": 409, "message": "name in use"}}),
            ),
            entry(
                16,
                json!({"type": "mutationRetired", "mutationId": "mut_00000000000000000000000000000003",
            "retirement": {"kind": "external-barrier", "evidence": barrier}}),
            ),
            entry(
                17,
                json!({"type": "mutationRetired", "mutationId": "mut_00000000000000000000000000000004",
            "retirement": {"kind": "host-reboot",
                "submittedBootId": "4c1d1b7e-1d8a-4f0b-9d3e-000000000001",
                "observedBootId": "4c1d1b7e-1d8a-4f0b-9d3e-000000000002", "profile": "docker-28-restart-no"}}),
            ),
            entry(
                18,
                json!({"type": "mutationRetired", "mutationId": "mut_00000000000000000000000000000005",
            "retirement": {"kind": "not-submitted"}}),
            ),
            entry(
                19,
                json!({"type": "grantRevoked", "grantId": "grant_1", "reason": "rollout"}),
            ),
            entry(
                20,
                json!({"type": "stopCertified", "grantId": "grant_1", "certificate": stop_cert_env}),
            ),
            entry(
                21,
                json!({"type": "opCompleted", "opId": "op_apply_1", "outcome": {"status": "unknown",
            "reason": "start submitted without a response"}}),
            ),
            entry(
                22,
                json!({"type": "quarantineCleared", "slot": {"resourceId": "res_pg", "index": 0},
            "grantId": "grant_2", "incarnation": "inc_0123456789abcdef0123456789abcdef"}),
            ),
            entry(
                23,
                json!({"type": "holdUnknown", "holdId": "hold_00000000000000000000000000000001",
            "reason": "staging mount missing after reboot"}),
            ),
            entry(
                24,
                json!({"type": "holdReleased", "holdId": "hold_00000000000000000000000000000001",
            "reason": "attempt retired and mounts gone"}),
            ),
            entry(
                25,
                json!({"type": "manifestActivated", "manifestDigest": DIGEST, "manifestRevision": 2,
            "bootstrapEpoch": 1, "authorityTerm": 2}),
            ),
            entry(
                26,
                json!({"type": "updatePhaseEntered", "updateId": "upd_00000000000000000000000000000001",
            "phase": "schema-boundary", "fromManifestDigest": DIGEST, "toManifestDigest": DIGEST}),
            ),
            entry(
                27,
                json!({"type": "highWater", "kind": "operation-epoch", "scope": "res_pg", "value": 9}),
            ),
            entry(
                28,
                json!({"type": "highWater", "kind": "slot-generation", "scope": "res_pg#0", "value": 4}),
            ),
            entry(
                29,
                json!({"type": "compacted", "throughSeq": 28, "droppedRecords": 1200,
            "priorDigest": DIGEST}),
            ),
            entry(
                30,
                json!({"type": "containerAdopted", "grantId": "grant_7",
            "attemptId": "att_00000000000000000000000000000007",
            "container": "4f2a9c0d1e3b5a7c9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b3c5d"}),
            ),
            entry(
                31,
                json!({"type": "adoptionReleased", "grantId": "grant_7",
            "restartPolicy": {"name": "on-failure", "maximumRetryCount": 5}}),
            ),
        ],
    );
}

#[test]
fn service_spec_normalization() {
    let mut ro = spec_input_web();
    ro["task"]["mounts"] = json!([{"kind": "bind", "source": "/srv/static", "target": "/static",
                                   "readOnly": true}]);
    let mut start_first_db = spec_input_mounted();
    start_first_db["update"] = json!({"order": "start-first"});
    let mut shared_rw = spec_input_mounted();
    shared_rw["mode"] = json!({"kind": "replicated", "replicas": 2});
    let mut short = spec_input_web();
    short["lifecycle"] = json!({"failoverDelayMs": 10000});
    let mut host_port = spec_input_web();
    host_port["endpoint"] = json!({"mode": "dnsrr",
        "ports": [{"targetPort": 53, "protocol": "udp", "publishedPort": 53, "publish": "host"}]});
    let job = json!({"resourceId": "res_job", "mode": {"kind": "job", "maxConcurrent": 1, "completions": 1},
        "task": {"container": {"image": {"reference": "alpine:3"}},
                 "mounts": [{"kind": "tmpfs", "target": "/tmp", "tmpfsSizeBytes": 67_108_864}]},
        "lifecycle": {"concurrencyGroup": "cron:nightly"}});
    let mut bad_mounts = spec_input_web();
    bad_mounts["task"]["mounts"] = json!([{"kind": "volume", "target": "/a"},
        {"kind": "tmpfs", "source": "x", "target": "/a"}]);
    bad_mounts["task"]["container"]["image"]["digest"] = json!("sha256:XYZ");
    let mut overridden = spec_input_mounted();
    overridden["lifecycle"] = json!({"failoverPolicy": "reschedule", "exclusive": false,
                                     "disconnectAction": "stop", "failoverDelayMs": 120000});
    overridden["update"] = json!({"order": "start-first", "maxFailureRatioPermille": 1500});

    let inputs = vec![
        ("mounted database", spec_input_mounted()),
        ("mount-free web", spec_input_web()),
        ("read-only bind still counts as mounted", ro),
        ("explicit start-first on exclusive", start_first_db),
        ("replicas sharing a writable volume", shared_rw),
        ("failover delay below minimum", short),
        (
            "host port forces stop-first, dnsrr warns",
            host_port.clone(),
        ),
        ("job with tmpfs", job.clone()),
        ("job made overlap-tolerant", {
            let mut j = job;
            j["lifecycle"]["exclusive"] = json!(false);
            j
        }),
        ("explicit start-first with a host port", {
            let mut h = host_port.clone();
            h["update"] = json!({"order": "start-first"});
            h
        }),
        ("mount and digest errors", bad_mounts),
        ("explicit overrides", overridden),
    ];
    let cases: Vec<Value> = inputs
        .into_iter()
        .map(|(name, input)| {
            let parsed: ServiceSpecInput =
                serde_json::from_value(input.clone()).unwrap_or_else(|e| panic!("{name}: {e}"));
            let normalized = parsed.normalize();
            let issues = normalized.validate();
            json!({
                "name": name,
                "input": canonical::<ServiceSpecInput>(input),
                "normalized": normalized,
                "issues": issues,
            })
        })
        .collect();
    // Every issue code is exercised at least once.
    let mut seen: Vec<String> = cases
        .iter()
        .flat_map(|c| c["issues"].as_array().unwrap().clone())
        .map(|i| i["code"].as_str().unwrap().to_owned())
        .collect();
    seen.sort();
    seen.dedup();
    let mut want: Vec<String> = SpecIssueCode::ALL
        .iter()
        .filter(|c| **c != SpecIssueCode::SchemaUnsupported)
        .map(|c| {
            serde_json::to_value(c)
                .unwrap()
                .as_str()
                .unwrap()
                .to_owned()
        })
        .collect();
    want.sort();
    assert_eq!(seen, want);
    check_file("spec-normalize.json", &json!({"cases": cases}));
}

fn names<T: Serialize>(values: &[T]) -> Vec<Value> {
    values
        .iter()
        .map(|v| serde_json::to_value(v).unwrap())
        .collect()
}

#[test]
fn enums() {
    let mut out = BTreeMap::new();
    out.insert("Verb", names(Verb::ALL));
    out.insert("Permission", names(&Permission::ALL));
    out.insert("SignContext", names(&SignContext::ALL));
    out.insert("Feature", names(&Feature::ALL));
    out.insert("NodeRole", names(&NodeRole::ALL));
    out.insert("PlatformRole", names(&PlatformRole::ALL));
    out.insert(
        "VerbRequired",
        Verb::ALL
            .iter()
            .map(
                |v| json!({"verb": v, "required": v.required(), "monitor": v.allowed_on_monitor()}),
            )
            .collect(),
    );
    out.insert("MetricName", names(&MetricName::ALL));
    out.insert("Cause", names(&Cause::ALL));
    out.insert("Outcome", names(&Outcome::ALL));
    out.insert("SignalKind", names(&SignalKind::ALL));
    out.insert("SpecIssueCode", names(&SpecIssueCode::ALL));
    check_file("enums.json", &serde_json::to_value(out).unwrap());
}

#[test]
fn vectors() {
    // Deterministic signatures: TypeScript must verify these and reproduce them.
    let payload = br#"{"hello":"otterd"}"#;
    let signatures: Vec<Value> = [CP, NODE, RECOVERY]
        .iter()
        .zip([
            SignContext::Capability,
            SignContext::Session,
            SignContext::AuthorityRevoke,
        ])
        .map(|(seed, ctx)| {
            let env = SignedEnvelope::sign_bytes(&key(*seed), ctx, payload);
            assert!(env.verify_bytes(&[public(*seed)], ctx).is_ok());
            json!({"seedHex": hex::encode([*seed; 32]), "publicKey": public(*seed),
                   "keyId": public(*seed).key_id(), "context": ctx,
                   "payloadUtf8": String::from_utf8(payload.to_vec()).unwrap(),
                   "envelope": env, "payloadDigest": env.payload_digest().unwrap()})
        })
        .collect();

    let headers: Vec<Value> = [
        (Pipe::Stdin, 1u32),
        (Pipe::Stdout, 0x0102_0304),
        (Pipe::Stderr, u32::MAX),
    ]
    .iter()
    .map(|(pipe, id)| {
        let h = DataHeader {
            pipe: *pipe,
            stream_id: *id,
        };
        json!({"pipe": pipe, "streamId": id, "hex": hex::encode(h.encode())})
    })
    .collect();

    let r = |min, max| VersionRange { min, max };
    let negotiation: Vec<Value> = [
        (r(1, 3), r(2, 5)),
        (r(1, 1), r(1, 1)),
        (r(1, 1), r(2, 3)),
        (r(4, 5), r(2, 3)),
        (r(3, 2), r(1, 1)),
    ]
    .iter()
    .map(|(node, cp)| {
        let result = match negotiate(*node, *cp) {
            Ok(v) => json!({"ok": v}),
            Err(otterd_proto::version::NegotiationError::NodeTooOld { .. }) => {
                json!({"error": "node-too-old"})
            }
            Err(otterd_proto::version::NegotiationError::ControlPlaneTooOld { .. }) => {
                json!({"error": "control-plane-too-old"})
            }
            Err(otterd_proto::version::NegotiationError::Malformed(_)) => {
                json!({"error": "malformed"})
            }
        };
        json!({"node": node, "cp": cp, "result": result})
    })
    .collect();

    let att = |o: &str| AttemptResult {
        outcome: serde_json::from_value(json!(o)).unwrap(),
        cause: Cause::Ok,
        phase: ProtocolPhase::Connect,
        elapsed_ms: otterd_proto::U53::ONE,
        latency_us: None,
    };
    let rounds: Vec<Value> = [
        (vec!["target-failure", "success"], 2),
        (vec!["target-failure", "target-failure"], 2),
        (vec!["target-failure"], 2),
        (vec!["target-failure"], 1),
        (vec!["target-failure", "unknown"], 2),
        (vec!["unknown", "configuration-error"], 2),
        (vec![], 1),
    ]
    .into_iter()
    .map(|(outcomes, configured)| {
        let attempts: Vec<AttemptResult> = outcomes.iter().map(|o| att(o)).collect();
        json!({"attempts": outcomes, "configured": configured,
               "result": round_outcome(&attempts, configured)})
    })
    .collect();

    check_file(
        "vectors.json",
        &json!({"signatures": signatures, "dataHeaders": headers, "negotiation": negotiation,
                "roundOutcome": rounds}),
    );
}

/// Wire keys are camelCase everywhere; a snake_case key means a missing
/// `rename_all` on some variant.
#[test]
fn fixture_keys_are_camel_case() {
    fn walk(v: &Value, path: &str, bad: &mut Vec<String>) {
        match v {
            Value::Object(map) => {
                for (k, child) in map {
                    if k.contains('_') {
                        bad.push(format!("{path}/{k}"));
                    }
                    // Labels and environment maps are data: their keys are names.
                    if !matches!(k.as_str(), "env" | "recoveryEnv" | "labels" | "sysctls") {
                        walk(child, &format!("{path}/{k}"), bad);
                    }
                }
            }
            Value::Array(items) => {
                for (i, child) in items.iter().enumerate() {
                    walk(child, &format!("{path}/{i}"), bad);
                }
            }
            _ => {}
        }
    }
    let mut bad = Vec::new();
    let mut dirs = vec![fixtures_dir()];
    while let Some(dir) = dirs.pop() {
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                dirs.push(path);
            } else {
                let v: Value =
                    serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
                walk(&v, &path.display().to_string(), &mut bad);
            }
        }
    }
    assert!(bad.is_empty(), "snake_case keys: {bad:#?}");
}
