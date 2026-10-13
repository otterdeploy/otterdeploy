//! The adapter against an in-process mock Engine on a unix socket. The mock
//! reads the journal from disk when each request arrives, proving the
//! `Submitted` record was durable before the request crossed the boundary.
#![allow(
    clippy::unwrap_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::too_many_lines,
    clippy::unused_async,
    clippy::needless_pass_by_value
)]

use bytes::Bytes;
use http::{Request, Response, StatusCode};
use http_body_util::{BodyExt as _, Full};
use hyper::body::Incoming;
use hyper_util::rt::TokioIo;
use otterd_engine::{
    DockerClient, EngineAdapter, EngineOp, JournalHandle, MutationSpec, SubmitResult, object_name,
};
use otterd_journal::{Blocker, Journal, Submission};
use otterd_proto::U53;
use otterd_proto::envelope::PublicKey;
use otterd_proto::identity::{HostBinding, TrustedKey};
use otterd_proto::ids::{AttemptId, GrantId, Sha256Hex, SlotRef};
use otterd_proto::journal::{AttemptReason, EngineOutcome, Record, WorkloadClass};
use otterd_proto::lifecycle::SlotGrant;
use otterd_proto::spec::{DisconnectAction, RestartPolicy};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::UnixListener;

#[derive(Clone, Copy)]
enum Behaviour {
    Reply(u16, &'static str),
    DelayThenReply(u64, u16, &'static str),
    Hang,
}

#[derive(Default)]
struct Seen {
    /// (path, body, journal state of the newest mutation when the request arrived)
    requests: Vec<(String, String, Option<&'static str>)>,
}

fn id<T: std::str::FromStr>(s: &str) -> T
where
    T::Err: std::fmt::Debug,
{
    s.parse().unwrap()
}

const INC: &str = "inc_00000000000000000000000000000001";

fn mock(socket: PathBuf, journal: PathBuf, behaviour: Behaviour, seen: Arc<Mutex<Seen>>) {
    let listener = UnixListener::bind(&socket).unwrap();
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let journal = journal.clone();
            let seen = Arc::clone(&seen);
            tokio::spawn(async move {
                let service = hyper::service::service_fn(move |req: Request<Incoming>| {
                    let journal = journal.clone();
                    let seen = Arc::clone(&seen);
                    async move {
                        let path = req.uri().to_string();
                        let body = req.into_body().collect().await.unwrap().to_bytes();
                        let state = Journal::read_snapshot(&journal).ok().and_then(|(s, _)| {
                            s.mutations
                                .values()
                                .max_by_key(|m| m.intent_seq)
                                .map(|m| m.submission.name())
                        });
                        seen.lock().unwrap().requests.push((
                            path,
                            String::from_utf8_lossy(&body).into_owned(),
                            state,
                        ));
                        let (status, body) = match behaviour {
                            Behaviour::Reply(s, b) => (s, b),
                            Behaviour::DelayThenReply(ms, s, b) => {
                                tokio::time::sleep(Duration::from_millis(ms)).await;
                                (s, b)
                            }
                            Behaviour::Hang => {
                                tokio::time::sleep(Duration::from_secs(3600)).await;
                                (500, "")
                            }
                        };
                        Ok::<_, std::convert::Infallible>(
                            Response::builder()
                                .status(StatusCode::from_u16(status).unwrap())
                                .body(Full::new(Bytes::from(body)))
                                .unwrap(),
                        )
                    }
                });
                let _ = hyper::server::conn::http1::Builder::new()
                    .serve_connection(TokioIo::new(stream), service)
                    .await;
            });
        }
    });
}

fn journal_with_grant(path: &Path) -> Journal {
    let mut j = Journal::create(path, "test").unwrap();
    let key = PublicKey::from_bytes([7; 32]);
    j.append(Record::Identity {
        install_id: id("inst"),
        node_id: id("node-a"),
        node_epoch: U53::ONE,
        key_epoch: U53::ONE,
        identity_key_id: key.key_id(),
        cp_keys: vec![TrustedKey {
            key: key.clone(),
            epoch: U53::ONE,
            not_after_unix_ms: None,
        }],
        recovery_key: key,
        host: HostBinding {
            machine_id: "m".into(),
            product_uuid: None,
            provider: None,
        },
    })
    .unwrap();
    j.append(Record::ProcessStarted {
        incarnation: id(INC),
        boot_id: id("boot-1"),
    })
    .unwrap();
    j.append(Record::GrantAccepted {
        grant: SlotGrant {
            grant_id: id("g1"),
            slot: SlotRef::new(id("db"), 0),
            generation: U53::ONE,
            authority_term: U53::ONE,
            node_epoch: U53::ONE,
            incarnation: id(INC),
            exclusive: true,
            disconnect_action: DisconnectAction::Stop,
            restart: RestartPolicy::default(),
            data_claims: vec![],
            probe_only: false,
            adopts_attempt: None,
            adopts_container: None,
            network: None,
        },
        spec_digest: Sha256Hex::digest(b"spec"),
        op_id: id("op-1"),
    })
    .unwrap();
    j.append(Record::AttemptBegun {
        grant_id: id("g1"),
        attempt_id: id("att_1"),
        ordinal: 1,
        reason: AttemptReason::Initial,
    })
    .unwrap();
    j
}

struct TestEngine {
    _dir: tempfile::TempDir,
    adapter: EngineAdapter,
    seen: Arc<Mutex<Seen>>,
}

async fn test_engine(behaviour: Behaviour, timeout: Duration) -> TestEngine {
    let dir = tempfile::tempdir().unwrap();
    let journal_path = dir.path().join("node.journal");
    let socket = dir.path().join("docker.sock");
    let journal = JournalHandle::new(journal_with_grant(&journal_path));
    let seen = Arc::new(Mutex::new(Seen::default()));
    mock(socket.clone(), journal_path, behaviour, Arc::clone(&seen));
    let adapter = EngineAdapter::new(
        DockerClient::new(socket, timeout),
        journal,
        id("boot-1"),
        id(INC),
        "29.9.0/pid:1".into(),
    );
    TestEngine {
        _dir: dir,
        adapter,
        seen,
    }
}

fn spec(op: EngineOp) -> MutationSpec {
    MutationSpec {
        class: WorkloadClass::Tenant,
        slot: SlotRef::new(id("db"), 0),
        grant_id: Some(id("g1")),
        attempt_id: id("att_1"),
        op,
    }
}

fn create() -> EngineOp {
    let slot = SlotRef::new(id("db"), 0);
    let attempt: AttemptId = id("att_1");
    EngineOp::Create {
        name: object_name(&slot, &attempt),
        config: serde_json::json!({"Image": "postgres:17", "HostConfig": {"RestartPolicy": {"Name": "always"}}}),
    }
}

fn grant_open(s: &otterd_journal::NodeState) -> Result<(), String> {
    let g = &s.grants[&id::<GrantId>("g1")];
    if g.start_revoked() {
        Err("grant revoked".into())
    } else {
        Ok(())
    }
}

#[tokio::test]
async fn create_settles_after_a_durable_submitted_record() {
    let h = test_engine(
        Behaviour::Reply(201, r#"{"Id":"c0ffee","Warnings":[]}"#),
        Duration::from_secs(5),
    )
    .await;
    let r = h.adapter.submit(spec(create()), grant_open).await.unwrap();
    let SubmitResult::Settled {
        outcome,
        mutation_id,
    } = r
    else {
        panic!("{r:?}")
    };
    assert_eq!(
        outcome,
        EngineOutcome::Created {
            container: id("c0ffee")
        }
    );
    let seen = h.seen.lock().unwrap();
    let (path, body, state_on_arrival) = &seen.requests[0];
    assert!(
        path.contains("/containers/create?name=od-db-0-att_1"),
        "{path}"
    );
    assert_eq!(
        *state_on_arrival,
        Some("submitted"),
        "Submitted must be durable before send"
    );
    // otterd is the only supervisor: Docker's own restart policy is forced to `no`.
    let sent: serde_json::Value = serde_json::from_str(body).unwrap();
    assert_eq!(sent["HostConfig"]["RestartPolicy"]["Name"], "no");
    assert_eq!(sent["Labels"]["dev.otterdeploy.managed"], "1");
    assert_eq!(sent["Labels"]["dev.otterdeploy.grant"], "g1");
    let state = h.adapter.journal().snapshot().unwrap();
    let m = &state.mutations[&mutation_id];
    assert!(matches!(m.submission, Submission::Settled { .. }));
    // The journalled hash is over exactly the bytes sent.
    assert_eq!(
        m.record.payload_hash,
        otterd_engine::payload_hash(&http::Method::POST, path, Some(body.as_bytes()))
    );
}

#[tokio::test]
async fn an_engine_error_leaves_the_start_submitted_and_the_slot_blocked() {
    let h = test_engine(
        Behaviour::Reply(500, r#"{"message":"context deadline exceeded"}"#),
        Duration::from_secs(5),
    )
    .await;
    let op = EngineOp::Start {
        container: id("c0ffee"),
        name: "od-db-0-att_1".into(),
    };
    let r = h.adapter.submit(spec(op), grant_open).await.unwrap();
    assert!(matches!(r, SubmitResult::Unresolved { .. }), "{r:?}");
    let state = h.adapter.journal().snapshot().unwrap();
    assert!(matches!(
        state.mutations[r.mutation_id()].submission,
        Submission::Submitted { .. }
    ));
    assert!(
        state
            .slot_blockers(&SlotRef::new(id("db"), 0))
            .iter()
            .any(|b| matches!(b, Blocker::UnresolvedSubmission { .. }))
    );
}

#[tokio::test]
async fn a_hung_engine_times_out_unresolved() {
    let h = test_engine(Behaviour::Hang, Duration::from_millis(300)).await;
    let op = EngineOp::Start {
        container: id("c0ffee"),
        name: "od-db-0-att_1".into(),
    };
    let r = h.adapter.submit(spec(op), grant_open).await.unwrap();
    let SubmitResult::Unresolved { reason, .. } = &r else {
        panic!("{r:?}")
    };
    assert!(reason.contains("no response"), "{reason}");
    assert_eq!(h.seen.lock().unwrap().requests[0].2, Some("submitted"));
}

#[tokio::test]
async fn a_refused_guard_sends_nothing_and_records_nothing() {
    let h = test_engine(Behaviour::Reply(204, ""), Duration::from_secs(5)).await;
    h.adapter
        .journal()
        .append(Record::GrantRevoked {
            grant_id: id("g1"),
            reason: "stop".into(),
        })
        .await
        .unwrap();
    let before = h.adapter.journal().snapshot().unwrap().mutations.len();
    let op = EngineOp::Start {
        container: id("c0ffee"),
        name: "od-db-0-att_1".into(),
    };
    let err = h.adapter.submit(spec(op), grant_open).await.unwrap_err();
    assert!(err.to_string().contains("revoked"), "{err}");
    assert_eq!(
        h.adapter.journal().snapshot().unwrap().mutations.len(),
        before
    );
    assert!(h.seen.lock().unwrap().requests.is_empty());
}

#[tokio::test]
async fn a_stop_gets_its_grace_on_top_of_the_engine_timeout() {
    // Base timeout 500 ms; the Engine answers after 1.2 s; stop grace 2 s.
    let h = test_engine(
        Behaviour::DelayThenReply(1_200, 204, ""),
        Duration::from_millis(500),
    )
    .await;
    let op = EngineOp::Stop {
        container: id("c0ffee"),
        name: "od-db-0-att_1".into(),
        timeout_s: 2,
    };
    let r = h.adapter.submit(spec(op), |_| Ok(())).await.unwrap();
    assert!(
        matches!(
            r,
            SubmitResult::Settled {
                outcome: EngineOutcome::Stopped,
                ..
            }
        ),
        "{r:?}"
    );
}
