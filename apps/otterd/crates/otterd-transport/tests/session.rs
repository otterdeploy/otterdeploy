//! The control session against an in-process control plane over real TLS.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::too_many_lines
)]

use ed25519_dalek::SigningKey;
use otterd_proto::U53;
use otterd_proto::channel::{ControlFrame, Reject, RejectCode, RequestRefusal};
use otterd_proto::command::OpOutcome;
use otterd_proto::envelope::{PublicKey, SignContext, SignedEnvelope};
use otterd_proto::identity::TrustedKey;
use otterd_proto::ids::Incarnation;
use otterd_proto::metrics::{BatchDisposition, SampleBatch};
use otterd_proto::version::Feature;
use otterd_transport::testing::{CpSession, FakeCp};
use otterd_transport::tls::client_config;
use otterd_transport::{
    ConnectionManager, Handler, IdentitySource, NodeIdentity, RequestAnswer, SendError,
    SessionInfo, TransportConfig,
};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{Notify, watch};

const CP: [u8; 32] = [1; 32];
const NODE: [u8; 32] = [2; 32];
const SEC: Duration = Duration::from_secs(1);

struct Id(NodeIdentity);

impl IdentitySource for Id {
    fn identity(&self) -> Result<NodeIdentity, String> {
        Ok(self.0.clone())
    }
}

#[derive(Default)]
struct TestHandler {
    release: Notify,
    frames: Mutex<Vec<String>>,
}

impl Handler for TestHandler {
    async fn on_ready(&self, _: SessionInfo) -> Vec<ControlFrame> {
        vec![ControlFrame::SlotReports {
            seq: U53::ONE,
            quarantined: true,
            engine_reachable: true,
            slots: vec![],
        }]
    }

    async fn request(&self, _: SessionInfo, _: SignedEnvelope, payload: String) -> RequestAnswer {
        if payload == "block" {
            self.release.notified().await;
        }
        if payload == "refuse" {
            return RequestAnswer::Refused(RequestRefusal::VerbMismatch);
        }
        RequestAnswer::Outcome {
            op_id: "op-1".parse().unwrap(),
            duplicate: false,
            outcome: OpOutcome::Accepted,
        }
    }

    async fn frame(&self, _: SessionInfo, frame: ControlFrame) -> Vec<ControlFrame> {
        self.frames.lock().unwrap().push(frame.kind().to_owned());
        vec![]
    }
}

fn identity() -> NodeIdentity {
    NodeIdentity {
        install_id: "inst".parse().unwrap(),
        node_id: "node-1".parse().unwrap(),
        node_epoch: U53::ONE,
        key_epoch: U53::ONE,
        signing: SigningKey::from_bytes(&NODE),
        boot_id: "4c1d1b7e-1d8a-4f0b-9d3e-000000000001".parse().unwrap(),
        incarnation: Incarnation::mint().unwrap(),
        cp_keys: vec![TrustedKey {
            key: PublicKey::from_verifying_key(&SigningKey::from_bytes(&CP).verifying_key()),
            epoch: U53::ONE,
            not_after_unix_ms: None,
        }],
        otterd_version: "0.1.0".into(),
        features: vec![Feature::KeyRotation],
        facts: None,
    }
}

struct Rig {
    cp: FakeCp,
    manager: Arc<ConnectionManager<TestHandler, Id>>,
    handler: Arc<TestHandler>,
    shutdown: watch::Sender<bool>,
    task: tokio::task::JoinHandle<()>,
}

async fn rig(
    map_url: fn(&str) -> String,
    tweak: impl FnOnce(&mut otterd_transport::testing::Behavior),
) -> Rig {
    let cp = FakeCp::start(
        SigningKey::from_bytes(&CP),
        PublicKey::from_verifying_key(&SigningKey::from_bytes(&NODE).verifying_key()),
    )
    .await
    .unwrap();
    cp.set(tweak);
    let mut cfg = TransportConfig::new(map_url(&cp.url), client_config(&cp.trust).unwrap());
    cfg.ping_interval = Duration::from_millis(100);
    cfg.pong_timeout = Duration::from_millis(400);
    cfg.backoff_min = Duration::from_millis(50);
    cfg.backoff_max = Duration::from_millis(300);
    cfg.handshake_timeout = Duration::from_secs(2);
    let handler = Arc::new(TestHandler::default());
    let manager = Arc::new(ConnectionManager::new(
        cfg,
        Arc::clone(&handler),
        Arc::new(Id(identity())),
    ));
    let (shutdown, rx) = watch::channel(false);
    let m = Arc::clone(&manager);
    let task = tokio::spawn(async move { m.run(rx).await });
    Rig {
        cp,
        manager,
        handler,
        shutdown,
        task,
    }
}

async fn connected(rig: &Rig) -> SessionInfo {
    let mut w = rig.manager.sessions();
    tokio::time::timeout(5 * SEC, w.wait_for(Option::is_some))
        .await
        .unwrap()
        .unwrap()
        .clone()
        .unwrap()
}

async fn disconnected(rig: &Rig) {
    let mut w = rig.manager.sessions();
    tokio::time::timeout(5 * SEC, w.wait_for(Option::is_none))
        .await
        .unwrap()
        .unwrap();
}

fn same(url: &str) -> String {
    url.to_owned()
}

fn request(id: u32, payload: &str) -> ControlFrame {
    ControlFrame::Request {
        id,
        capability: SignedEnvelope::sign_bytes(
            &SigningKey::from_bytes(&CP),
            SignContext::Capability,
            b"{}",
        ),
        payload: payload.to_owned(),
    }
}

async fn first_session(rig: &mut Rig) -> CpSession {
    let mut s = rig.cp.session(5 * SEC).await.expect("a session");
    assert!(
        matches!(
            s.recv_within(SEC).await,
            Some(ControlFrame::SlotReports { .. })
        ),
        "slot reports right after ready"
    );
    s
}

#[tokio::test]
async fn handshake_requests_limits_and_clock() {
    let mut rig = rig(same, |b| {
        b.limits.max_active_commands = 2;
        b.features = vec![Feature::KeyRotation, Feature::Bulk];
    })
    .await;
    let mut s = first_session(&mut rig).await;
    assert_eq!(s.hello.node_id.as_str(), "node-1");
    let info = connected(&rig).await;
    assert_eq!(info.session_id, s.session_id);
    assert_eq!(
        info.features,
        vec![Feature::KeyRotation],
        "only features both offered"
    );
    let clock = info.clock_now().unwrap();
    assert!(clock.uncertainty_ms.get() < 1_000, "{clock:?}");

    // A command and its answer.
    s.send(&request(1, "x")).await;
    assert!(matches!(
        s.recv_within(SEC).await,
        Some(ControlFrame::Response { id: 1, .. })
    ));
    s.send(&request(2, "refuse")).await;
    assert!(matches!(
        s.recv_within(SEC).await,
        Some(ControlFrame::RequestRefused {
            id: 2,
            error: RequestRefusal::VerbMismatch
        })
    ));

    // At most maxActiveCommands at once; an id in flight is not reused.
    s.send(&request(3, "block")).await;
    s.send(&request(4, "block")).await;
    s.send(&request(5, "x")).await;
    assert!(matches!(
        s.recv_within(SEC).await,
        Some(ControlFrame::RequestRefused {
            id: 5,
            error: RequestRefusal::Busy
        })
    ));
    s.send(&request(3, "x")).await;
    assert!(matches!(
        s.recv_within(SEC).await,
        Some(ControlFrame::RequestRefused {
            id: 3,
            error: RequestRefusal::DuplicateId
        })
    ));
    rig.handler.release.notify_waiters();
    let mut done = vec![];
    for _ in 0..2 {
        if let Some(ControlFrame::Response { id, .. }) = s.recv_within(SEC).await {
            done.push(id);
        }
    }
    done.sort_unstable();
    assert_eq!(done, vec![3, 4]);

    // Other frames reach the handler.
    s.send(&ControlFrame::Lease {
        renewal: SignedEnvelope::sign_bytes(
            &SigningKey::from_bytes(&CP),
            SignContext::Lease,
            b"{}",
        ),
    })
    .await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(
        rig.handler
            .frames
            .lock()
            .unwrap()
            .contains(&"lease".to_owned())
    );

    // Pings keep refining the published clock.
    let mut w = rig.manager.sessions();
    w.borrow_and_update();
    tokio::time::timeout(SEC, w.changed())
        .await
        .unwrap()
        .unwrap();

    rig.shutdown.send(true).unwrap();
    tokio::time::timeout(SEC, rig.task).await.unwrap().unwrap();
    assert!(
        s.recv_within(SEC).await.is_none(),
        "the node closed the session"
    );
}

fn batch(items: usize) -> SampleBatch {
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../otterd-proto/fixtures/schemas/SampleBatch.json"
    ))
    .unwrap();
    let v: serde_json::Value = serde_json::from_str(&text).unwrap();
    let mut b: SampleBatch = serde_json::from_value(v["cases"][0].clone()).unwrap();
    b.probes.clear();
    b.markers.clear();
    b.signals.clear();
    let one = b.metrics[0].clone();
    b.metrics = vec![one; items];
    b
}

#[tokio::test]
async fn telemetry_never_exceeds_credit_and_yields_to_control() {
    let mut rig = rig(same, |b| b.limits.telemetry_credit = 10).await;
    let mut s = first_session(&mut rig).await;
    connected(&rig).await;
    let outbox = rig.manager.outbox();
    outbox.send_telemetry(batch(6)).unwrap();
    outbox.send_telemetry(batch(6)).unwrap();
    assert!(matches!(
        s.recv_within(SEC).await,
        Some(ControlFrame::Telemetry(_))
    ));
    // The second batch does not fit the remaining 4 items of credit, but
    // control frames still flow.
    outbox
        .send(ControlFrame::SlotReports {
            seq: U53::from_const(2),
            quarantined: false,
            engine_reachable: true,
            slots: vec![],
        })
        .unwrap();
    assert!(matches!(
        s.recv_within(SEC).await,
        Some(ControlFrame::SlotReports { .. })
    ));
    assert!(
        s.recv_within(Duration::from_millis(400)).await.is_none(),
        "no telemetry without credit"
    );
    s.send(&ControlFrame::TelemetryAck {
        batch_id: "batch_1".parse().unwrap(),
        disposition: BatchDisposition::Accepted,
        credit: 6,
    })
    .await;
    assert!(matches!(
        s.recv_within(SEC).await,
        Some(ControlFrame::Telemetry(_))
    ));
    // A batch bigger than the whole window can never be sent; it is dropped,
    // not wedged in front of later batches.
    s.send(&ControlFrame::TelemetryAck {
        batch_id: "batch_2".parse().unwrap(),
        disposition: BatchDisposition::Accepted,
        credit: 100,
    })
    .await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    outbox.send_telemetry(batch(11)).unwrap();
    outbox.send_telemetry(batch(1)).unwrap();
    match s.recv_within(SEC).await {
        Some(ControlFrame::Telemetry(b)) => assert_eq!(b.metrics.len(), 1),
        other => panic!("{other:?}"),
    }
    // Disconnected: the outbox says so instead of queueing forever.
    rig.shutdown.send(true).unwrap();
    disconnected(&rig).await;
    assert_eq!(
        outbox.send_telemetry(batch(1)),
        Err(SendError::NotConnected)
    );
}

#[tokio::test]
async fn reconnects_after_reject_goaway_close_and_silence() {
    let mut rig = rig(same, |b| {
        b.reject = Some(Reject {
            code: RejectCode::Maintenance,
            message: "upgrading".into(),
            supported: None,
            retry_after_ms: Some(U53::from_const(300)),
        });
    })
    .await;
    assert!(rig.cp.session(Duration::from_millis(250)).await.is_none());
    rig.cp.set(|b| b.reject = None);
    let s = first_session(&mut rig).await;
    connected(&rig).await;

    // goAway: the node leaves and comes back.
    let mut s = s;
    s.send(&ControlFrame::GoAway {
        code: RejectCode::Maintenance,
        message: "bye".into(),
        reconnect_after_ms: Some(U53::from_const(100)),
    })
    .await;
    disconnected(&rig).await;
    let s = first_session(&mut rig).await;

    // The control plane drops the connection.
    s.close().await;
    disconnected(&rig).await;
    let s = first_session(&mut rig).await;

    // The control plane goes silent (nobody reads this session, so no pong
    // comes back): the node gives up on it after the pong timeout.
    let started = std::time::Instant::now();
    disconnected(&rig).await;
    assert!(
        started.elapsed() >= Duration::from_millis(300),
        "waited for the pong timeout"
    );
    drop(s);
    let mut s2 = first_session(&mut rig).await;
    s2.send(&request(9, "x")).await;
    assert!(matches!(
        s2.recv_within(SEC).await,
        Some(ControlFrame::Response { id: 9, .. })
    ));
}

#[tokio::test]
async fn refuses_a_forged_control_plane_and_plain_websocket() {
    let mut rig = rig(same, |b| {
        b.proof_key = Some(SigningKey::from_bytes(&[9; 32]));
    })
    .await;
    assert!(rig.cp.session(Duration::from_secs(1)).await.is_none());
    assert!(rig.manager.sessions().borrow().is_none());
    assert!(
        rig.cp.attempts.load(std::sync::atomic::Ordering::SeqCst) >= 2,
        "keeps retrying"
    );

    rig.shutdown.send(true).unwrap();

    let plain = rig_plain().await;
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(
        plain.cp.attempts.load(std::sync::atomic::Ordering::SeqCst),
        0,
        "ws:// is never dialled"
    );
}

async fn rig_plain() -> Rig {
    rig(|u| u.replacen("wss://", "ws://", 1), |_| {}).await
}

#[tokio::test]
async fn an_oversized_frame_ends_the_session_and_the_clock_follows_the_control_plane() {
    let ahead = 10 * 60 * 1000;
    let mut rig = rig(same, |b| {
        b.limits.max_frame_bytes = 1024;
        b.clock_offset_ms = ahead;
    })
    .await;
    let mut s = first_session(&mut rig).await;
    let info = connected(&rig).await;
    let local = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let cp_now = u128::from(info.clock_now().unwrap().now_unix_ms.get());
    assert!(
        cp_now > local + 9 * 60 * 1000,
        "the session clock is the control plane's"
    );
    s.send_raw(format!(
        r#"{{"type":"cancel","id":1,"reason":"{}"}}"#,
        "x".repeat(2_000)
    ))
    .await;
    assert!(s.recv_within(SEC).await.is_none(), "closed by the node");
    first_session(&mut rig).await;
}
