//! The Hetzner adapter against a scripted provider API on localhost.
#![allow(
    clippy::unwrap_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::needless_pass_by_value
)]

use bytes::Bytes;
use http_body_util::Full;
use hyper::body::Incoming;
use hyper::{Request, Response};
use hyper_util::rt::TokioIo;
use otterd_fence::{FenceAdapter, FenceError, HetznerFence, MachineBinding, PowerOn};
use otterd_proto::lifecycle::BarrierMethod;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpListener;

/// Scripted provider: each server read pops the next status (the last repeats).
#[derive(Default)]
struct Script {
    statuses: VecDeque<&'static str>,
    created: &'static str,
    action_statuses: VecDeque<&'static str>,
    action_error: bool,
    posted: Vec<String>,
    unauthorized: bool,
}

fn json(status: u16, v: serde_json::Value) -> Response<Full<Bytes>> {
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(Full::new(Bytes::from(v.to_string())))
        .unwrap()
}

async fn provider(script: Script) -> (String, Arc<Mutex<Script>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let script = Arc::new(Mutex::new(script));
    let shared = Arc::clone(&script);
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let script = Arc::clone(&shared);
            tokio::spawn(async move {
                let svc = hyper::service::service_fn(move |req: Request<Incoming>| {
                    let script = Arc::clone(&script);
                    async move {
                        let mut s = script.lock().unwrap();
                        let path = req.uri().path().to_owned();
                        let auth = req
                            .headers()
                            .get("authorization")
                            .and_then(|v| v.to_str().ok())
                            .unwrap_or_default()
                            .to_owned();
                        if s.unauthorized || auth != "Bearer fence-token" {
                            return Ok::<_, std::convert::Infallible>(json(
                                401,
                                serde_json::json!({"error": {"code": "unauthorized"}}),
                            ));
                        }
                        if req.method() == hyper::Method::POST {
                            s.posted.push(path.clone());
                            return Ok(json(
                                201,
                                serde_json::json!({"action": {"id": 77, "command": path.rsplit('/').next(), "status": "running"}}),
                            ));
                        }
                        if path.contains("/actions/") {
                            let st = if s.action_statuses.len() > 1 {
                                s.action_statuses.pop_front().unwrap()
                            } else {
                                *s.action_statuses.front().unwrap_or(&"success")
                            };
                            let error = if s.action_error {
                                serde_json::json!({"code": "boom", "message": "provider failed"})
                            } else {
                                serde_json::Value::Null
                            };
                            return Ok(json(
                                200,
                                serde_json::json!({"action": {"id": 77, "command": "stop_server", "status": st, "error": error}}),
                            ));
                        }
                        let st = if s.statuses.len() > 1 {
                            s.statuses.pop_front().unwrap()
                        } else {
                            *s.statuses.front().unwrap_or(&"running")
                        };
                        Ok(json(
                            200,
                            serde_json::json!({"server": {"id": 42, "name": "w1", "status": st, "created": s.created, "labels": {"role": "worker"}}}),
                        ))
                    }
                });
                let _ = hyper::server::conn::http1::Builder::new()
                    .serve_connection(TokioIo::new(stream), svc)
                    .await;
            });
        }
    });
    (base, script)
}

fn binding() -> MachineBinding {
    MachineBinding {
        provider: "hetzner".into(),
        server_id: "42".into(),
        created_at: "2026-10-11T22:50:00+00:00".into(),
        require_labels: [("role".to_owned(), "worker".to_owned())].into(),
        machine_id: None,
    }
}

fn fence(base: String) -> HetznerFence {
    let mut f = HetznerFence::with_base(base, "fence-token".into()).unwrap();
    f.poll_interval = Duration::from_millis(20);
    f.off_timeout = Duration::from_secs(2);
    f.action_timeout = Duration::from_secs(2);
    f
}

fn script(statuses: &[&'static str], actions: &[&'static str]) -> Script {
    Script {
        statuses: statuses.iter().copied().collect(),
        created: "2026-10-11T22:50:00+00:00",
        action_statuses: actions.iter().copied().collect(),
        ..Script::default()
    }
}

#[tokio::test]
async fn evidence_needs_action_success_then_consecutive_off_reads() {
    // binding check, then: stopping, off, running (resets the count), off, off, off.
    let (base, s) = provider(script(
        &["running", "stopping", "off", "running", "off", "off", "off"],
        &["running", "success"],
    ))
    .await;
    let ev = fence(base).fence(&binding()).await.unwrap();
    assert_eq!(ev.method, BarrierMethod::ProviderPowerOff);
    assert_eq!(ev.reference, "77");
    let tail: Vec<&str> = ev.observations.iter().map(|o| o.status.as_str()).collect();
    assert_eq!(tail, ["stopping", "off", "running", "off", "off", "off"]);
    assert_eq!(
        s.lock().unwrap().posted,
        ["/servers/42/actions/poweroff"],
        "hard poweroff, never shutdown"
    );
    let barrier = ev.barrier(otterd_proto::U53::ONE, None);
    assert_eq!(barrier.provider_action_id.as_deref(), Some("77"));
}

#[tokio::test]
async fn refusals_produce_no_evidence() {
    // Wrong credential.
    let mut sc = script(&["running"], &["success"]);
    sc.unauthorized = true;
    let (base, s) = provider(sc).await;
    assert!(matches!(
        fence(base).fence(&binding()).await,
        Err(FenceError::Provider { status: 401, .. })
    ));
    assert!(s.lock().unwrap().posted.is_empty());

    // Recycled server id: creation time differs.
    let mut sc = script(&["running"], &["success"]);
    sc.created = "2026-10-12T00:00:00+00:00";
    let (base, s) = provider(sc).await;
    assert!(matches!(
        fence(base).fence(&binding()).await,
        Err(FenceError::Binding(_))
    ));
    assert!(
        s.lock().unwrap().posted.is_empty(),
        "nothing is powered off on a binding mismatch"
    );

    // Label guard.
    let mut b = binding();
    b.require_labels.insert("run".into(), "mine".into());
    let (base, _) = provider(script(&["running"], &["success"])).await;
    assert!(matches!(
        fence(base).fence(&b).await,
        Err(FenceError::Binding(_))
    ));

    // The action fails.
    let mut sc = script(&["running"], &["error"]);
    sc.action_error = true;
    let (base, _) = provider(sc).await;
    assert!(matches!(
        fence(base).fence(&binding()).await,
        Err(FenceError::ActionFailed { .. })
    ));

    // The action succeeds but the server never reports off.
    let (base, _) = provider(script(&["running", "running"], &["success"])).await;
    assert!(matches!(
        fence(base).fence(&binding()).await,
        Err(FenceError::Unconfirmed { .. })
    ));

    // The provider API is unreachable.
    assert!(matches!(
        fence("http://127.0.0.1:9".into()).fence(&binding()).await,
        Err(FenceError::Unavailable(_))
    ));
}

#[tokio::test]
async fn rescue_power_on_enables_rescue_first() {
    let (base, s) = provider(script(&["off", "off", "running"], &["success"])).await;
    let rec = fence(base)
        .power_on(
            &binding(),
            PowerOn::Rescue {
                ssh_key_id: "9".into(),
            },
        )
        .await
        .unwrap();
    assert_eq!(rec.actions.len(), 2);
    assert_eq!(
        s.lock().unwrap().posted,
        [
            "/servers/42/actions/enable_rescue",
            "/servers/42/actions/poweron"
        ]
    );
}
