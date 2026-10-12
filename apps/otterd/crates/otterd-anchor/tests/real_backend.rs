//! The probe and the protocol against a real S3-compatible backend. Ignored by
//! default; set `OTTERD_ANCHOR_S3_ENDPOINT`, `_REGION`, `_BUCKET`, `_ACCESS_KEY`,
//! `_SECRET_KEY` and run with `--ignored`. Everything is written under a fresh
//! prefix and deleted afterwards.
#![allow(
    clippy::unwrap_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::too_many_lines
)]

use ed25519_dalek::SigningKey;
use otterd_anchor::s3::{S3, S3Config};
use otterd_anchor::{
    Anchor, AnchorError, EnrollOutcome, EnrollmentRecord, Phase, RetirementMethod, probe,
};
use otterd_proto::U53;
use otterd_proto::envelope::PublicKey;
use otterd_proto::identity::HostBinding;

fn env(name: &str) -> String {
    std::env::var(format!("OTTERD_ANCHOR_S3_{name}"))
        .unwrap_or_else(|_| panic!("OTTERD_ANCHOR_S3_{name} is not set"))
}

fn s3(unquoted: bool) -> S3 {
    S3::new(S3Config {
        endpoint: env("ENDPOINT"),
        region: env("REGION"),
        bucket: env("BUCKET"),
        access_key: env("ACCESS_KEY"),
        secret_key: env("SECRET_KEY"),
        path_style: false,
        unquoted_if_match: unquoted,
    })
    .unwrap()
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
        install_id: "inst-real".parse().unwrap(),
        seq: U53::ZERO,
        node_id: node.parse().unwrap(),
        node_epoch: U53::ONE,
        identity_key_id: public(&SigningKey::from_bytes(&[9; 32])).key_id(),
        host: host(node),
        recovery_term: U53::ZERO,
        at_unix_ms: U53::ZERO,
        prev_record: None,
    }
}

async fn cleanup(s3: &S3, prefix: &str) {
    for k in s3.list(prefix).await.unwrap() {
        s3.delete(&k).await.unwrap();
    }
}

#[tokio::test]
#[ignore = "needs a real S3-compatible backend"]
async fn real_backend_semantics_and_protocol() {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let prefix = format!("otterd-anchor-test/{stamp}");
    let quoted = probe(&s3(false), &prefix).await.unwrap();
    let unquoted = probe(&s3(true), &prefix).await.unwrap();
    println!(
        "PROBE quoted-form {}",
        serde_json::to_string(&quoted).unwrap()
    );
    println!(
        "PROBE unquoted-form {}",
        serde_json::to_string(&unquoted).unwrap()
    );
    let use_unquoted = quoted.needs_unquoted_if_match;
    let chosen = if use_unquoted { &unquoted } else { &quoted };
    assert!(chosen.semantics_ok, "backend semantics: {chosen:#?}");

    let (recovery, enrollment) = (
        SigningKey::from_bytes(&[1; 32]),
        SigningKey::from_bytes(&[2; 32]),
    );
    let a = Anchor::new(
        s3(use_unquoted),
        "inst-real".parse().unwrap(),
        &format!("{prefix}/anchor"),
        public(&recovery),
        public(&enrollment),
    );
    a.init(&recovery, host("cp-1"), U53::ONE).await.unwrap();
    let mut tasks = Vec::new();
    for i in 0..6 {
        let (a, k) = (a.clone(), enrollment.clone());
        tasks.push(tokio::spawn(async move {
            a.enroll(&k, record(&format!("n{i}"))).await
        }));
    }
    let mut seqs: Vec<u64> = Vec::new();
    for t in tasks {
        match t.await.unwrap().unwrap() {
            EnrollOutcome::Committed { seq } => seqs.push(seq.get()),
            other @ EnrollOutcome::PendingFrozen { .. } => panic!("{other:?}"),
        }
    }
    seqs.sort_unstable();
    assert_eq!(seqs, (1..=6).collect::<Vec<_>>());

    // Race an enrollment against the freeze several times.
    let mut raced = Vec::new();
    for round in 0..4 {
        if round > 0 {
            let (_, missing, _) = a.outstanding().await.unwrap();
            for n in &missing {
                a.record_retirement(
                    &recovery,
                    n,
                    RetirementMethod::ResponsiveCertificate,
                    "test",
                )
                .await
                .unwrap();
            }
            a.complete_recovery(&recovery).await.unwrap();
        }
        let (ea, ek) = (a.clone(), enrollment.clone());
        let enroll =
            tokio::spawn(async move { ea.enroll(&ek, record(&format!("race{round}"))).await });
        let (fa, fk) = (a.clone(), recovery.clone());
        let freeze = tokio::spawn(async move { fa.begin_recovery(&fk, host("cp-next")).await });
        let outcome = enroll.await.unwrap();
        let term = freeze.await.unwrap().unwrap();
        assert_eq!(term.phase, Phase::RecoveryPending);
        let inventory = a.inventory().await.unwrap();
        let verdict = match &outcome {
            Ok(EnrollOutcome::Committed { seq } | EnrollOutcome::PendingFrozen { seq, .. }) => {
                assert!(
                    inventory.iter().any(|e| e.record.seq == *seq),
                    "round {round}: record missing from union"
                );
                format!("{outcome:?}")
            }
            Err(AnchorError::Frozen(_)) => "frozen before writing".into(),
            Err(e) => panic!("round {round}: {e}"),
        };
        raced.push(verdict);
        assert!(a.may_issue(term.recovery_term).await.is_err());
    }
    println!("RACE {raced:?}");
    let (term, missing, _) = a.outstanding().await.unwrap();
    for n in &missing {
        a.record_retirement(&recovery, n, RetirementMethod::ProviderPowerOff, "test")
            .await
            .unwrap();
    }
    a.complete_recovery(&recovery).await.unwrap();
    a.may_issue(term.recovery_term).await.unwrap();
    assert!(a.may_issue(U53::ONE).await.is_err());
    println!(
        "FINAL term {} active, {} inventory records",
        term.recovery_term,
        a.inventory().await.unwrap().len()
    );
    cleanup(&s3(use_unquoted), &prefix).await;
    assert!(s3(use_unquoted).list(&prefix).await.unwrap().is_empty());
}
