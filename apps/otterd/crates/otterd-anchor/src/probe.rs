//! Measure a backend's conditional-write semantics before trusting it.
//!
//! Nothing here is taken from documentation: every step is performed on
//! scratch keys and recorded. A backend whose report is not `semantics_ok`
//! is refused as an anchor.

use crate::s3::{Condition, S3, S3Error};
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Race {
    pub writers: u32,
    pub wins: u32,
    pub rejected: u32,
    pub errors: Vec<String>,
}

// A report of independent yes/no measurements, not a state machine.
#[allow(clippy::struct_excessive_bools)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeReport {
    pub create_if_absent: String,
    pub create_if_absent_on_existing: String,
    pub read_after_create_consistent: bool,
    /// The RFC 7232 quoted `If-Match` form with the correct ETag.
    pub if_match_quoted_form: String,
    /// The form the client is configured to send.
    pub if_match_sent_unquoted: bool,
    pub if_match_wrong_etag: String,
    pub if_match_current_etag: String,
    pub if_match_superseded_etag: String,
    pub read_after_cas_returns_new: bool,
    pub concurrent_if_match: Race,
    pub concurrent_if_none_match: Race,
    pub bucket_versioning: String,
    /// Every required property held.
    pub semantics_ok: bool,
    /// The quoted form is rejected: the client must send ETags unquoted.
    pub needs_unquoted_if_match: bool,
}

fn show<T: std::fmt::Display>(r: &Result<T, S3Error>) -> String {
    match r {
        Ok(v) => format!("accepted {v}"),
        Err(e) => format!("rejected: {e}"),
    }
}

fn rejected<T>(r: &Result<T, S3Error>) -> bool {
    matches!(r, Err(S3Error::PreconditionFailed | S3Error::Conflict))
}

async fn race(s3: &S3, key: &str, cond: Condition, writers: u32) -> Race {
    let mut tasks = Vec::new();
    for i in 0..writers {
        let (s3, key, cond) = (s3.clone(), key.to_owned(), cond.clone());
        tasks.push(tokio::spawn(async move {
            s3.put(&key, format!("racer-{i}").into_bytes(), cond).await
        }));
    }
    let mut out = Race {
        writers,
        wins: 0,
        rejected: 0,
        errors: Vec::new(),
    };
    for t in tasks {
        match t.await {
            Ok(Ok(_)) => out.wins += 1,
            Ok(Err(S3Error::PreconditionFailed | S3Error::Conflict)) => out.rejected += 1,
            Ok(Err(e)) => out.errors.push(e.to_string()),
            Err(e) => out.errors.push(e.to_string()),
        }
    }
    out
}

/// Run the probe under `prefix` (scratch keys are deleted afterwards).
pub async fn probe(s3: &S3, prefix: &str) -> Result<ProbeReport, S3Error> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    let base = format!("{}/probe/{stamp}", prefix.trim_end_matches('/'));
    let k = format!("{base}/obj");
    let create = s3.put(&k, b"v1".to_vec(), Condition::IfNoneMatch).await;
    let create_twice = s3.put(&k, b"v1b".to_vec(), Condition::IfNoneMatch).await;
    let (body1, e1) = s3.get(&k).await?.unwrap_or_default();
    let read_after_create_consistent =
        body1 == b"v1" && create.as_ref().is_ok_and(|e| same_etag(e, &e1));
    let quoted = s3
        .with_unquoted_if_match(false)
        .put(&k, b"vq".to_vec(), Condition::IfMatch(e1.clone()))
        .await;
    let (_, e1) = s3.get(&k).await?.unwrap_or_default();
    let wrong = s3
        .put(
            &k,
            b"vw".to_vec(),
            Condition::IfMatch("\"00000000000000000000000000000000\"".into()),
        )
        .await;
    let cas = s3
        .put(&k, b"v2".to_vec(), Condition::IfMatch(e1.clone()))
        .await;
    let superseded = s3.put(&k, b"v3".to_vec(), Condition::IfMatch(e1)).await;
    let (body2, e2) = s3.get(&k).await?.unwrap_or_default();
    let n = 8;
    let concurrent_cas = race(s3, &k, Condition::IfMatch(e2.clone()), n).await;
    let k2 = format!("{base}/create");
    let concurrent_create = race(s3, &k2, Condition::IfNoneMatch, n).await;
    let versioning = s3
        .versioning()
        .await
        .unwrap_or_else(|e| format!("unknown: {e}"));
    for key in [&k, &k2] {
        if let Err(e) = s3.delete(key).await {
            tracing::warn!(key, error = %e, "could not delete a probe object");
        }
    }
    let semantics_ok = create.is_ok()
        && rejected(&create_twice)
        && rejected(&wrong)
        && cas.is_ok()
        && rejected(&superseded)
        && concurrent_cas.wins == 1
        && concurrent_create.wins == 1;
    Ok(ProbeReport {
        read_after_create_consistent,
        create_if_absent: show(&create),
        create_if_absent_on_existing: show(&create_twice),
        needs_unquoted_if_match: quoted.is_err(),
        if_match_quoted_form: show(&quoted),
        if_match_sent_unquoted: s3.config().unquoted_if_match,
        if_match_wrong_etag: show(&wrong),
        read_after_cas_returns_new: body2 == b"v2" && cas.as_ref().is_ok_and(|e| same_etag(e, &e2)),
        if_match_current_etag: show(&cas),
        if_match_superseded_etag: show(&superseded),
        concurrent_if_match: concurrent_cas,
        concurrent_if_none_match: concurrent_create,
        bucket_versioning: versioning,
        semantics_ok,
    })
}

fn same_etag(a: &str, b: &str) -> bool {
    a.trim_matches('"') == b.trim_matches('"')
}
