//! Minimal S3 client with SigV4 and conditional writes: only what the anchor
//! needs. GET with ETag, PUT with `If-None-Match: *` (create only) or
//! `If-Match: <etag>` (compare-and-swap), LIST, DELETE and the bucket
//! versioning status. Provider-neutral: any S3-compatible store whose
//! conditional writes pass [`crate::probe`].

use hmac::{Hmac, Mac as _};
use sha2::{Digest as _, Sha256};
use std::fmt::Write as _;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug, thiserror::Error)]
pub enum S3Error {
    #[error("transport: {0}")]
    Transport(String),
    #[error("precondition failed (412): the object changed or already exists")]
    PreconditionFailed,
    #[error("conflict (409): a concurrent conditional write is in progress")]
    Conflict,
    #[error("HTTP {status}: {body}")]
    Http { status: u16, body: String },
    #[error("configuration: {0}")]
    Config(String),
}

#[derive(Clone)]
pub struct S3Config {
    /// For example `https://nbg1.your-objectstorage.com`.
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    pub access_key: String,
    pub secret_key: String,
    /// Path-style addressing (`host/bucket/key`) instead of virtual-hosted.
    pub path_style: bool,
    /// Send `If-Match` ETags without their quotes. Some Ceph RGW deployments
    /// (Hetzner Object Storage among them) answer the quoted RFC 7232 form with
    /// 412 even when the ETag matches. [`crate::probe`] measures both forms.
    pub unquoted_if_match: bool,
}

impl std::fmt::Debug for S3Config {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("S3Config")
            .field("endpoint", &self.endpoint)
            .field("region", &self.region)
            .field("bucket", &self.bucket)
            .field("path_style", &self.path_style)
            .field("unquoted_if_match", &self.unquoted_if_match)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Condition {
    None,
    /// Create only if absent: the append-only primitive.
    IfNoneMatch,
    /// Replace only if the current ETag matches: the compare-and-swap primitive.
    IfMatch(String),
}

#[derive(Debug, Clone)]
pub struct S3 {
    cfg: S3Config,
    http: reqwest::Client,
    host: String,
    scheme: String,
}

type HmacSha256 = Hmac<Sha256>;

impl S3 {
    pub fn new(cfg: S3Config) -> Result<Self, S3Error> {
        let (scheme, rest) = cfg
            .endpoint
            .split_once("://")
            .ok_or_else(|| S3Error::Config("endpoint needs a scheme".into()))?;
        if scheme != "https" && scheme != "http" {
            return Err(S3Error::Config(format!("unsupported scheme {scheme}")));
        }
        let rest = rest.trim_end_matches('/');
        let host = if cfg.path_style {
            rest.to_owned()
        } else {
            format!("{}.{rest}", cfg.bucket)
        };
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| S3Error::Transport(e.to_string()))?;
        Ok(Self {
            scheme: scheme.to_owned(),
            host,
            cfg,
            http,
        })
    }

    #[must_use]
    pub fn config(&self) -> &S3Config {
        &self.cfg
    }

    /// The same client with a different `If-Match` quoting (probe only).
    #[must_use]
    pub fn with_unquoted_if_match(&self, unquoted: bool) -> Self {
        let mut c = self.clone();
        c.cfg.unquoted_if_match = unquoted;
        c
    }

    fn object_path(&self, key: &str) -> String {
        let key = encode(key, false);
        if self.cfg.path_style {
            format!("/{}/{key}", self.cfg.bucket)
        } else {
            format!("/{key}")
        }
    }

    fn bucket_path(&self) -> String {
        if self.cfg.path_style {
            format!("/{}", self.cfg.bucket)
        } else {
            "/".into()
        }
    }

    async fn send(
        &self,
        method: &str,
        path: &str,
        query: &[(&str, &str)],
        extra: &[(&str, String)],
        body: Vec<u8>,
    ) -> Result<(u16, reqwest::header::HeaderMap, Vec<u8>), S3Error> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| S3Error::Transport(e.to_string()))?
            .as_secs();
        let signed = sign_v4(&SigningInput {
            method,
            host: &self.host,
            path,
            query,
            extra,
            body: &body,
            region: &self.cfg.region,
            access_key: &self.cfg.access_key,
            secret_key: &self.cfg.secret_key,
            unix_secs: now,
        });
        let url = if signed.canonical_query.is_empty() {
            format!("{}://{}{path}", self.scheme, self.host)
        } else {
            format!(
                "{}://{}{path}?{}",
                self.scheme, self.host, signed.canonical_query
            )
        };
        let method = reqwest::Method::from_bytes(method.as_bytes())
            .map_err(|e| S3Error::Transport(e.to_string()))?;
        let mut req = self
            .http
            .request(method, url)
            .header("authorization", signed.authorization);
        for (k, v) in &signed.headers {
            if k != "host" {
                req = req.header(k.as_str(), v.as_str());
            }
        }
        let resp = req
            .body(body)
            .send()
            .await
            .map_err(|e| S3Error::Transport(e.without_url().to_string()))?;
        let status = resp.status().as_u16();
        let headers = resp.headers().clone();
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| S3Error::Transport(e.without_url().to_string()))?
            .to_vec();
        Ok((status, headers, bytes))
    }

    /// `Ok(None)` when the object does not exist; otherwise body and ETag.
    pub async fn get(&self, key: &str) -> Result<Option<(Vec<u8>, String)>, S3Error> {
        let (status, h, body) = self
            .send("GET", &self.object_path(key), &[], &[], Vec::new())
            .await?;
        match status {
            200 => Ok(Some((body, etag(&h)))),
            404 => Ok(None),
            s => Err(http_error(s, &body)),
        }
    }

    /// Conditional PUT; returns the new ETag.
    pub async fn put(&self, key: &str, body: Vec<u8>, cond: Condition) -> Result<String, S3Error> {
        let extra: Vec<(&str, String)> = match &cond {
            Condition::None => vec![],
            Condition::IfNoneMatch => vec![("if-none-match", "*".into())],
            Condition::IfMatch(e) if self.cfg.unquoted_if_match => {
                vec![("if-match", e.trim_matches('"').to_owned())]
            }
            Condition::IfMatch(e) => vec![("if-match", quoted(e))],
        };
        let (status, h, resp) = self
            .send("PUT", &self.object_path(key), &[], &extra, body)
            .await?;
        match status {
            200 => Ok(etag(&h)),
            412 => Err(S3Error::PreconditionFailed),
            409 => Err(S3Error::Conflict),
            s => Err(http_error(s, &resp)),
        }
    }

    /// A conditional PUT whose answer may be lost or ambiguous (a 5xx or a
    /// transport error: some Ceph RGW deployments answer racing conditional
    /// writes with 500). The condition is evaluated atomically when a write
    /// applies, so read the object back and decide by content: ours means it
    /// applied; unchanged (absent, or still at the expected ETag) means it did
    /// not and is sent again; anything else lost the race. `body` must be unique
    /// to this writer (anchor objects carry a signature and a timestamp).
    ///
    /// A write that reading back proved did not apply is always safe to send
    /// again, so those attempts do not end the loop early: only answers that
    /// stay unresolved (the read-back itself failing) count against
    /// [`MAX_UNRESOLVED`]. [`MAX_RESOLVE_ATTEMPTS`] bounds the whole exchange.
    pub async fn put_resolving(
        &self,
        key: &str,
        body: Vec<u8>,
        cond: Condition,
    ) -> Result<String, S3Error> {
        let mut ambiguous = None;
        let mut unresolved = 0u32;
        for attempt in 0..MAX_RESOLVE_ATTEMPTS {
            if attempt > 0 {
                tokio::time::sleep(resolve_backoff(attempt)).await;
            }
            match self.put(key, body.clone(), cond.clone()).await {
                Err(e) if is_ambiguous(&e) => ambiguous = Some(e),
                // An earlier ambiguous attempt may have landed after all.
                Err(S3Error::PreconditionFailed | S3Error::Conflict) if ambiguous.is_some() => {
                    return match self.get(key).await? {
                        Some((current, etag)) if current == body => Ok(etag),
                        _ => Err(S3Error::PreconditionFailed),
                    };
                }
                other => return other,
            }
            match self.get(key).await {
                Ok(Some((current, etag))) if current == body => return Ok(etag),
                // Proven not applied: send again.
                Ok(current) if unchanged(&cond, current.as_ref().map(|(_, e)| e.as_str())) => {}
                Ok(_) => return Err(S3Error::PreconditionFailed),
                Err(e) => {
                    tracing::debug!(key, error = %e, "could not resolve an ambiguous write yet");
                    unresolved += 1;
                    if unresolved >= MAX_UNRESOLVED {
                        break;
                    }
                }
            }
        }
        Err(ambiguous.unwrap_or(S3Error::Conflict))
    }

    pub async fn delete(&self, key: &str) -> Result<(), S3Error> {
        let (status, _, body) = self
            .send("DELETE", &self.object_path(key), &[], &[], Vec::new())
            .await?;
        if matches!(status, 200 | 204 | 404) {
            Ok(())
        } else {
            Err(http_error(status, &body))
        }
    }

    /// Every key under `prefix` (ListObjectsV2, following continuation tokens).
    pub async fn list(&self, prefix: &str) -> Result<Vec<String>, S3Error> {
        let mut keys = Vec::new();
        let mut token: Option<String> = None;
        loop {
            let mut q: Vec<(&str, &str)> = vec![("list-type", "2"), ("prefix", prefix)];
            if let Some(t) = &token {
                q.push(("continuation-token", t));
            }
            let (status, _, body) = self
                .send("GET", &self.bucket_path(), &q, &[], Vec::new())
                .await?;
            if status != 200 {
                return Err(http_error(status, &body));
            }
            let text = String::from_utf8_lossy(&body).into_owned();
            keys.extend(xml_all(&text, "Key"));
            let truncated =
                xml_all(&text, "IsTruncated").first().map(String::as_str) == Some("true");
            token = xml_all(&text, "NextContinuationToken").into_iter().next();
            if !truncated || token.is_none() {
                break;
            }
        }
        Ok(keys)
    }

    /// Bucket versioning status (`Enabled`, `Suspended`, or empty if never set).
    pub async fn versioning(&self) -> Result<String, S3Error> {
        let (status, _, body) = self
            .send(
                "GET",
                &self.bucket_path(),
                &[("versioning", "")],
                &[],
                Vec::new(),
            )
            .await?;
        if status != 200 {
            return Err(http_error(status, &body));
        }
        Ok(xml_all(&String::from_utf8_lossy(&body), "Status")
            .into_iter()
            .next()
            .unwrap_or_default())
    }
}

/// Attempts at one ambiguous conditional write, in all.
const MAX_RESOLVE_ATTEMPTS: u32 = 24;
/// Attempts whose outcome could not be read back before giving up.
const MAX_UNRESOLVED: u32 = 4;

/// Linear backoff between attempts, capped at one second.
fn resolve_backoff(attempt: u32) -> Duration {
    Duration::from_millis(150 * u64::from(attempt)).min(Duration::from_secs(1))
}

fn is_ambiguous(e: &S3Error) -> bool {
    matches!(
        e,
        S3Error::Transport(_)
            | S3Error::Http {
                status: 500..=599,
                ..
            }
    )
}

/// The object is still in the state the condition expected: the write did not apply.
fn unchanged(cond: &Condition, current_etag: Option<&str>) -> bool {
    match (cond, current_etag) {
        (Condition::IfNoneMatch, None) => true,
        (Condition::IfMatch(want), Some(etag)) => want.trim_matches('"') == etag.trim_matches('"'),
        _ => false,
    }
}

fn quoted(etag: &str) -> String {
    if etag.starts_with('"') {
        etag.to_owned()
    } else {
        format!("\"{etag}\"")
    }
}

fn http_error(status: u16, body: &[u8]) -> S3Error {
    S3Error::Http {
        status,
        body: String::from_utf8_lossy(body).chars().take(400).collect(),
    }
}

fn etag(h: &reqwest::header::HeaderMap) -> String {
    h.get("etag")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_owned()
}

pub(crate) struct SigningInput<'a> {
    pub method: &'a str,
    pub host: &'a str,
    pub path: &'a str,
    pub query: &'a [(&'a str, &'a str)],
    pub extra: &'a [(&'a str, String)],
    pub body: &'a [u8],
    pub region: &'a str,
    pub access_key: &'a str,
    pub secret_key: &'a str,
    pub unix_secs: u64,
}

pub(crate) struct Signed {
    pub authorization: String,
    pub headers: Vec<(String, String)>,
    pub canonical_query: String,
}

/// AWS Signature Version 4 for the `s3` service.
pub(crate) fn sign_v4(input: &SigningInput<'_>) -> Signed {
    let amz_date = amz_date(input.unix_secs);
    let date = amz_date.get(..8).unwrap_or_default().to_owned();
    let payload_hash = hex::encode(Sha256::digest(input.body));
    let mut q: Vec<(String, String)> = input
        .query
        .iter()
        .map(|(k, v)| (encode(k, true), encode(v, true)))
        .collect();
    q.sort();
    let canonical_query = q
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&");
    let mut headers: Vec<(String, String)> = vec![
        ("host".into(), input.host.to_owned()),
        ("x-amz-content-sha256".into(), payload_hash.clone()),
        ("x-amz-date".into(), amz_date.clone()),
    ];
    headers.extend(
        input
            .extra
            .iter()
            .map(|(k, v)| (k.to_ascii_lowercase(), v.trim().to_owned())),
    );
    headers.sort();
    let canonical_headers: String = headers.iter().fold(String::new(), |mut s, (k, v)| {
        let _ = writeln!(s, "{k}:{v}");
        s
    });
    let signed_headers = headers
        .iter()
        .map(|(k, _)| k.as_str())
        .collect::<Vec<_>>()
        .join(";");
    let canonical_request = format!(
        "{}\n{}\n{canonical_query}\n{canonical_headers}\n{signed_headers}\n{payload_hash}",
        input.method, input.path
    );
    let scope = format!("{date}/{}/s3/aws4_request", input.region);
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}",
        hex::encode(Sha256::digest(canonical_request.as_bytes()))
    );
    let k_date = hmac(
        format!("AWS4{}", input.secret_key).as_bytes(),
        date.as_bytes(),
    );
    let k_region = hmac(&k_date, input.region.as_bytes());
    let k_service = hmac(&k_region, b"s3");
    let k_signing = hmac(&k_service, b"aws4_request");
    let signature = hex::encode(hmac(&k_signing, string_to_sign.as_bytes()));
    Signed {
        authorization: format!(
            "AWS4-HMAC-SHA256 Credential={}/{scope}, SignedHeaders={signed_headers}, Signature={signature}",
            input.access_key
        ),
        headers,
        canonical_query,
    }
}

fn hmac(key: &[u8], data: &[u8]) -> Vec<u8> {
    // HMAC accepts keys of any length; the error branch is unreachable.
    let Ok(mut m) = HmacSha256::new_from_slice(key) else {
        return Vec::new();
    };
    m.update(data);
    m.finalize().into_bytes().to_vec()
}

/// `YYYYMMDDTHHMMSSZ` from Unix seconds (proleptic Gregorian, UTC).
pub(crate) fn amz_date(unix_secs: u64) -> String {
    let days = unix_secs / 86_400;
    let secs = unix_secs % 86_400;
    let (y, m, d) = civil_from_days(i64::try_from(days).unwrap_or(0));
    format!(
        "{y:04}{m:02}{d:02}T{:02}{:02}{:02}Z",
        secs / 3600,
        (secs % 3600) / 60,
        secs % 60
    )
}

/// Days since 1970-01-01 to (year, month, day); Howard Hinnant's algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    (
        y,
        u32::try_from(m).unwrap_or(1),
        u32::try_from(d).unwrap_or(1),
    )
}

/// RFC 3986 encoding as SigV4 wants it; `/` kept in object paths.
fn encode(s: &str, encode_slash: bool) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(char::from(b));
            }
            b'/' if !encode_slash => out.push('/'),
            _ => {
                let _ = write!(out, "%{b:02X}");
            }
        }
    }
    out
}

fn xml_all(text: &str, tag: &str) -> Vec<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let mut out = Vec::new();
    let mut rest = text;
    while let Some((_, after)) = rest.split_once(open.as_str()) {
        let Some((value, tail)) = after.split_once(close.as_str()) else {
            break;
        };
        out.push(
            value
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&apos;", "'")
                .replace("&amp;", "&"),
        );
        rest = tail;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xml_and_encoding() {
        let x = "<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>a/b c</Key></Contents><Contents><Key>a/&amp;d</Key></Contents></ListBucketResult>";
        assert_eq!(xml_all(x, "Key"), vec!["a/b c", "a/&d"]);
        assert_eq!(encode("a/b c", false), "a/b%20c");
        assert_eq!(encode("a/b", true), "a%2Fb");
    }

    #[test]
    fn signing_key_matches_the_aws_example() {
        // AWS documentation: secret wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY, 20120215, us-east-1, iam.
        let k_date = hmac(b"AWS4wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", b"20120215");
        let k_region = hmac(&k_date, b"us-east-1");
        let k_service = hmac(&k_region, b"iam");
        let k_signing = hmac(&k_service, b"aws4_request");
        assert_eq!(
            hex::encode(k_signing),
            "f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d"
        );
    }

    #[test]
    fn amz_dates() {
        assert_eq!(amz_date(0), "19700101T000000Z");
        assert_eq!(amz_date(1_329_264_000), "20120215T000000Z");
        assert_eq!(amz_date(1_791_000_061), "20261003T040101Z");
        assert_eq!(amz_date(951_782_400), "20000229T000000Z");
    }

    #[test]
    fn aws_get_object_example_signature() {
        // AWS SigV4 S3 example: GET /test.txt with Range header, 20130524.
        let signed = sign_v4(&SigningInput {
            method: "GET",
            host: "examplebucket.s3.amazonaws.com",
            path: "/test.txt",
            query: &[],
            extra: &[("range", "bytes=0-9".into())],
            body: b"",
            region: "us-east-1",
            access_key: "AKIAIOSFODNN7EXAMPLE",
            secret_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
            unix_secs: 1_369_353_600,
        });
        assert!(
            signed.authorization.ends_with(
                "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
            ),
            "{}",
            signed.authorization
        );
    }
}
