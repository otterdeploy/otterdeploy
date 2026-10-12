//! The anchor protocol against an in-process S3 with real conditional-write
//! semantics (create-only, compare-and-swap, listing), including the strict
//! ETag quoting some Ceph RGW deployments apply.
#![allow(
    clippy::unwrap_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::too_many_lines,
    clippy::format_collect,
    clippy::match_same_arms
)]

use bytes::Bytes;
use ed25519_dalek::SigningKey;
use http_body_util::{BodyExt as _, Full};
use hyper::body::Incoming;
use hyper::{Request, Response};
use hyper_util::rt::TokioIo;
use otterd_anchor::s3::{S3, S3Config};
use otterd_anchor::{
    Anchor, AnchorDocument, AnchorError, EnrollOutcome, EnrollmentRecord, Head, Phase,
    RetirementMethod, TermCertificate, probe,
};
use otterd_proto::U53;
use otterd_proto::envelope::{PublicKey, SignContext, SignedEnvelope};
use otterd_proto::identity::HostBinding;
use otterd_proto::ids::NodeId;
use sha2::{Digest as _, Sha256};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use tokio::net::TcpListener;

#[derive(Default)]
struct Store {
    objects: BTreeMap<String, (Vec<u8>, String)>,
    /// Reject the quoted `If-Match` form, as some RGW deployments do.
    strict_unquoted: bool,
    /// Answer some conditional PUTs with 500, sometimes after applying them.
    ambiguous_500: bool,
    puts: u64,
}

fn decode(s: &str) -> String {
    let mut out = Vec::new();
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            out.push(u8::from_str_radix(&s[i + 1..i + 3], 16).unwrap());
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).unwrap()
}

fn resp(status: u16, etag: Option<&str>, body: Vec<u8>) -> Response<Full<Bytes>> {
    let mut r = Response::builder().status(status);
    if let Some(e) = etag {
        r = r.header("etag", e);
    }
    r.body(Full::new(Bytes::from(body))).unwrap()
}

async fn serve(strict_unquoted: bool) -> String {
    serve_with(strict_unquoted, false).await
}

async fn serve_with(strict_unquoted: bool, ambiguous_500: bool) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let store = Arc::new(Mutex::new(Store {
        strict_unquoted,
        ambiguous_500,
        ..Store::default()
    }));
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let store = Arc::clone(&store);
            tokio::spawn(async move {
                let svc = hyper::service::service_fn(move |req: Request<Incoming>| {
                    let store = Arc::clone(&store);
                    async move {
                        assert!(
                            req.headers()["authorization"]
                                .to_str()
                                .unwrap()
                                .starts_with("AWS4-HMAC-SHA256 Credential=ak/")
                        );
                        let method = req.method().clone();
                        let path = decode(req.uri().path());
                        let query = req.uri().query().unwrap_or_default().to_owned();
                        let if_none = req
                            .headers()
                            .get("if-none-match")
                            .map(|v| v.to_str().unwrap().to_owned());
                        let if_match = req
                            .headers()
                            .get("if-match")
                            .map(|v| v.to_str().unwrap().to_owned());
                        let body = req.into_body().collect().await.unwrap().to_bytes().to_vec();
                        let key = path
                            .trim_start_matches("/anchor-bucket")
                            .trim_start_matches('/')
                            .to_owned();
                        let mut s = store.lock().unwrap();
                        let r = match (method.as_str(), key.is_empty()) {
                            ("GET", true) if query.contains("versioning") => resp(200, None, b"<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>".to_vec()),
                            ("GET", true) => {
                                let prefix = query.split('&').find_map(|kv| kv.strip_prefix("prefix=")).map(decode).unwrap_or_default();
                                let keys: String = s.objects.keys().filter(|k| k.starts_with(&prefix)).map(|k| format!("<Contents><Key>{k}</Key></Contents>")).collect();
                                resp(200, None, format!("<ListBucketResult><IsTruncated>false</IsTruncated>{keys}</ListBucketResult>").into_bytes())
                            }
                            ("GET", false) => match s.objects.get(&key) {
                                Some((b, e)) => resp(200, Some(e), b.clone()),
                                None => resp(404, None, Vec::new()),
                            },
                            ("DELETE", false) => {
                                s.objects.remove(&key);
                                resp(204, None, Vec::new())
                            }
                            ("PUT", false) => {
                                let current = s.objects.get(&key).map(|(_, e)| e.clone());
                                let allowed = match (&if_none, &if_match, &current) {
                                    (Some(_), _, Some(_)) => false,
                                    (_, Some(m), Some(e)) => {
                                        if s.strict_unquoted && m.starts_with('"') { false } else { m.trim_matches('"') == e.trim_matches('"') }
                                    }
                                    (_, Some(_), None) => false,
                                    _ => true,
                                };
                                let conditional = if_none.is_some() || if_match.is_some();
                                s.puts += 1;
                                let chaos = s.ambiguous_500 && conditional && !s.puts.is_multiple_of(3);
                                if chaos && s.puts % 3 == 1 {
                                    // Lost: not applied, answered 500.
                                    resp(500, None, b"<Error><Code>UnknownError</Code></Error>".to_vec())
                                } else if allowed {
                                    let etag = format!("\"{}\"", &hex::encode(Sha256::digest(&body))[..32]);
                                    s.objects.insert(key, (body, etag.clone()));
                                    if chaos {
                                        // Applied, but the answer says 500.
                                        resp(500, None, b"<Error><Code>UnknownError</Code></Error>".to_vec())
                                    } else {
                                        resp(200, Some(&etag), Vec::new())
                                    }
                                } else {
                                    resp(412, None, b"<Error><Code>PreconditionFailed</Code></Error>".to_vec())
                                }
                            }
                            _ => resp(400, None, Vec::new()),
                        };
                        Ok::<_, std::convert::Infallible>(r)
                    }
                });
                let _ = hyper::server::conn::http1::Builder::new()
                    .serve_connection(TokioIo::new(stream), svc)
                    .await;
            });
        }
    });
    base
}

fn s3(base: &str, unquoted: bool) -> S3 {
    S3::new(S3Config {
        endpoint: base.to_owned(),
        region: "test".into(),
        bucket: "anchor-bucket".into(),
        access_key: "ak".into(),
        secret_key: "sk".into(),
        path_style: true,
        unquoted_if_match: unquoted,
    })
    .unwrap()
}

fn key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}

fn public(k: &SigningKey) -> PublicKey {
    PublicKey::from_verifying_key(&k.verifying_key())
}

fn host(m: &str) -> HostBinding {
    HostBinding {
        machine_id: m.into(),
        product_uuid: None,
        provider: None,
    }
}

fn record(node: &str) -> EnrollmentRecord {
    EnrollmentRecord {
        install_id: "inst".parse().unwrap(),
        seq: U53::ZERO,
        node_id: node.parse().unwrap(),
        node_epoch: U53::ONE,
        identity_key_id: public(&key(9)).key_id(),
        host: host(node),
        recovery_term: U53::ZERO,
        at_unix_ms: U53::ZERO,
        prev_record: None,
    }
}

fn anchor(base: &str) -> Anchor {
    Anchor::new(
        s3(base, true),
        "inst".parse().unwrap(),
        "anchors/inst",
        public(&key(1)),
        public(&key(2)),
    )
}

#[tokio::test]
async fn probe_finds_sound_semantics_and_the_quoting_quirk() {
    let base = serve(true).await;
    let report = probe(&s3(&base, true), "anchors/inst").await.unwrap();
    assert!(report.semantics_ok, "{report:#?}");
    assert!(
        report.needs_unquoted_if_match,
        "strict backend rejects the quoted form"
    );
    assert_eq!(report.concurrent_if_match.wins, 1);
    assert_eq!(report.concurrent_if_none_match.wins, 1);
    assert!(report.read_after_create_consistent && report.read_after_cas_returns_new);
    // Sending quoted ETags to that backend breaks compare-and-swap entirely.
    let quoted = probe(&s3(&base, false), "anchors/inst").await.unwrap();
    assert!(!quoted.semantics_ok);
}

#[tokio::test]
async fn enrollment_recovery_and_issuance() {
    let base = serve(true).await;
    let a = anchor(&base);
    let (recovery, enrollment) = (key(1), key(2));
    a.init(&recovery, host("cp-1"), U53::ONE).await.unwrap();
    assert!(
        a.init(&recovery, host("cp-1"), U53::ONE).await.is_err(),
        "init refuses an existing head"
    );
    for (i, n) in ["n1", "n2", "n3"].iter().enumerate() {
        let out = a.enroll(&enrollment, record(n)).await.unwrap();
        assert_eq!(
            out,
            EnrollOutcome::Committed {
                seq: U53::new(i as u64 + 1).unwrap()
            }
        );
    }
    // Concurrent enrollments: every one commits at a distinct sequence.
    let mut tasks = Vec::new();
    for i in 0..8 {
        let a = a.clone();
        let k = enrollment.clone();
        tasks.push(tokio::spawn(async move {
            a.enroll(&k, record(&format!("c{i}"))).await
        }));
    }
    let mut seqs = Vec::new();
    for t in tasks {
        match t.await.unwrap().unwrap() {
            EnrollOutcome::Committed { seq } => seqs.push(seq.get()),
            other @ EnrollOutcome::PendingFrozen { .. } => panic!("{other:?}"),
        }
    }
    seqs.sort_unstable();
    assert_eq!(seqs, (4..=11).collect::<Vec<_>>());
    assert_eq!(a.head().await.unwrap().head.inventory_seq.get(), 11);
    a.may_issue(U53::ONE).await.unwrap();

    // Restore: term 2, enrollment frozen, issuance suspended.
    let term = a.begin_recovery(&recovery, host("cp-2")).await.unwrap();
    assert_eq!(
        (term.recovery_term.get(), term.phase),
        (2, Phase::RecoveryPending)
    );
    assert!(matches!(
        a.enroll(&enrollment, record("late")).await,
        Err(AnchorError::Frozen(_))
    ));
    assert!(
        a.may_issue(U53::ONE).await.is_err() && a.may_issue(U53::new(2).unwrap()).await.is_err()
    );
    let (_, missing, _) = a.outstanding().await.unwrap();
    assert_eq!(
        missing.len(),
        11,
        "the whole inventory union must be retired"
    );
    for n in &missing[1..] {
        a.record_retirement(
            &recovery,
            n,
            RetirementMethod::ResponsiveCertificate,
            "cert-digest",
        )
        .await
        .unwrap();
    }
    let err = a
        .complete_recovery(&recovery)
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains(missing[0].as_str()), "{err}");
    a.record_retirement(
        &recovery,
        &missing[0],
        RetirementMethod::ProviderPowerOff,
        "fence_1",
    )
    .await
    .unwrap();
    let done = a.complete_recovery(&recovery).await.unwrap();
    assert_eq!((done.recovery_term.get(), done.phase), (2, Phase::Active));
    a.may_issue(U53::new(2).unwrap()).await.unwrap();
    assert!(
        a.may_issue(U53::ONE).await.is_err(),
        "the old term never issues again"
    );
}

#[tokio::test]
async fn the_enrollment_key_cannot_change_the_term() {
    let base = serve(true).await;
    let a = anchor(&base);
    let (recovery, enrollment) = (key(1), key(2));
    a.init(&recovery, host("cp-1"), U53::ONE).await.unwrap();
    let state = a.head().await.unwrap();
    // A head whose term certificate the enrollment key signed (term 3).
    let forged_term = TermCertificate {
        recovery_term: U53::new(3).unwrap(),
        ..state.term.clone()
    };
    let forged = Head {
        term: SignedEnvelope::sign(
            &enrollment,
            SignContext::Anchor,
            &AnchorDocument::Term(forged_term),
        )
        .unwrap(),
        ..state.head.clone()
    };
    let bytes = serde_json::to_vec(
        &SignedEnvelope::sign(
            &enrollment,
            SignContext::Anchor,
            &AnchorDocument::Head(forged),
        )
        .unwrap(),
    )
    .unwrap();
    a.s3()
        .put(
            "anchors/inst/head.json",
            bytes,
            otterd_anchor::s3::Condition::IfMatch(state.etag),
        )
        .await
        .unwrap();
    let err = a.head().await.unwrap_err().to_string();
    assert!(err.contains("term certificate"), "{err}");
}

#[tokio::test]
async fn racing_enrollment_against_a_freeze_never_loses_a_record() {
    for round in 0..12 {
        let base = serve(true).await;
        let a = anchor(&base);
        let (recovery, enrollment) = (key(1), key(2));
        a.init(&recovery, host("cp-1"), U53::ONE).await.unwrap();
        let (ea, ek) = (a.clone(), enrollment.clone());
        let enroll =
            tokio::spawn(async move { ea.enroll(&ek, record(&format!("r{round}"))).await });
        if round % 2 == 0 {
            tokio::task::yield_now().await;
        }
        let (fa, fk) = (a.clone(), recovery.clone());
        let freeze = tokio::spawn(async move { fa.begin_recovery(&fk, host("cp-2")).await });
        let outcome = enroll.await.unwrap();
        freeze.await.unwrap().unwrap();
        let inventory = a.inventory().await.unwrap();
        match outcome {
            Ok(EnrollOutcome::Committed { seq } | EnrollOutcome::PendingFrozen { seq, .. }) => {
                assert!(
                    inventory.iter().any(|e| e.record.seq == seq),
                    "round {round}: record missing from the union"
                );
            }
            Err(AnchorError::Frozen(_)) => {}
            Err(e) => panic!("round {round}: {e}"),
        }
        let node: NodeId = format!("r{round}").parse().unwrap();
        let (_, missing, _) = a.outstanding().await.unwrap();
        assert_eq!(
            missing.contains(&node),
            inventory.iter().any(|e| e.record.node_id == node)
        );
    }
}

#[tokio::test]
async fn ambiguous_500_answers_are_resolved_by_reading_back() {
    let base = serve_with(true, true).await;
    let a = anchor(&base);
    let (recovery, enrollment) = (key(1), key(2));
    a.init(&recovery, host("cp-1"), U53::ONE).await.unwrap();
    let mut tasks = Vec::new();
    for i in 0..8 {
        let a = a.clone();
        let k = enrollment.clone();
        tasks.push(tokio::spawn(async move {
            a.enroll(&k, record(&format!("x{i}"))).await
        }));
    }
    let mut committed = 0;
    for t in tasks {
        match t.await.unwrap().unwrap() {
            EnrollOutcome::Committed { .. } => committed += 1,
            other @ EnrollOutcome::PendingFrozen { .. } => panic!("{other:?}"),
        }
    }
    assert_eq!(committed, 8);
    let inventory = a.inventory().await.unwrap();
    for i in 0..8 {
        let node: NodeId = format!("x{i}").parse().unwrap();
        assert!(
            inventory
                .iter()
                .any(|e| e.record.node_id == node && e.committed),
            "x{i} not committed"
        );
    }
}

#[tokio::test]
async fn a_deleted_committed_record_invalidates_the_inventory() {
    let base = serve(true).await;
    let a = anchor(&base);
    let (recovery, enrollment) = (key(1), key(2));
    a.init(&recovery, host("cp-1"), U53::ONE).await.unwrap();
    for n in ["d1", "d2", "d3"] {
        a.enroll(&enrollment, record(n)).await.unwrap();
    }
    let inventory = a.inventory().await.unwrap();
    assert!(inventory.iter().all(|e| e.committed));
    // Someone holding only the store credential deletes a committed record.
    a.s3().delete(&inventory[1].key).await.unwrap();
    let err = a.inventory().await.unwrap_err().to_string();
    assert!(err.contains("missing"), "{err}");
}
