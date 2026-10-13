//! HTTP(S) probes with explicit assertions.

use super::{AttemptCtx, AttemptOutput, CertificateInfo, classify_io, tcp, tls};
use crate::outcome::{Attempt, ConfigCause, Phase, TargetCause};
use crate::spec::{HttpExpect, HttpSpec};
use bytes::{Bytes, BytesMut};
use http::{HeaderMap, Method, Request, StatusCode, Uri, header};
use http_body_util::{BodyExt, Full};
use hyper_util::rt::TokioIo;
use tokio::io::{AsyncRead, AsyncWrite};

/// Bytes of body kept for assertions; the rest is not read.
const BODY_LIMIT: usize = 64 * 1024;

/// A parsed `http(s)://host[:port]/path` target.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Target {
    https: bool,
    host: String,
    port: u16,
    authority: String,
    path: String,
}

fn parse(url: &str) -> Option<Target> {
    let uri: Uri = url.parse().ok()?;
    let https = match uri.scheme_str()? {
        "https" => true,
        "http" => false,
        _ => return None,
    };
    let authority = uri.authority()?;
    let host = authority.host().to_string();
    if host.is_empty() {
        return None;
    }
    let port = authority.port_u16().unwrap_or(if https { 443 } else { 80 });
    let path = uri
        .path_and_query()
        .map_or("/".to_string(), |p| p.as_str().to_string());
    Some(Target {
        https,
        host,
        port,
        authority: authority.as_str().to_string(),
        path,
    })
}

/// Resolve a `Location` against the URL it came from.
fn follow(current: &Target, location: &str) -> Option<Target> {
    if location.starts_with("http://") || location.starts_with("https://") {
        return parse(location);
    }
    let scheme = if current.https { "https" } else { "http" };
    let path = if location.starts_with('/') {
        location.to_string()
    } else {
        let base = current.path.rsplit_once('/').map_or("", |(dir, _)| dir);
        format!("{base}/{location}")
    };
    parse(&format!("{scheme}://{}{path}", current.authority))
}

struct Exchange {
    status: StatusCode,
    headers: HeaderMap,
    body: Bytes,
}

async fn exchange<S>(
    io: S,
    request: Request<Full<Bytes>>,
    ctx: &AttemptCtx,
) -> Result<Exchange, Attempt>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    ctx.progress.set(Phase::Request);
    let (mut sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(io))
        .await
        .map_err(|e| hyper_failure(&e, ctx))?;
    let conn = tokio::spawn(conn);
    // The request is small and written at once; what `send_request` waits
    // for is the response head, so a deadline here is a response deadline.
    ctx.progress.set(Phase::Response);
    let response = sender
        .send_request(request)
        .await
        .map_err(|e| hyper_failure(&e, ctx));
    let result = match response {
        Err(a) => Err(a),
        Ok(response) => {
            let status = response.status();
            let headers = response.headers().clone();
            let mut body = response.into_body();
            let mut kept = BytesMut::new();
            let mut outcome = Ok(());
            while kept.len() < BODY_LIMIT {
                match body.frame().await {
                    None => break,
                    Some(Err(e)) => {
                        outcome = Err(hyper_failure(&e, ctx));
                        break;
                    }
                    Some(Ok(frame)) => {
                        if let Ok(data) = frame.into_data() {
                            let room = BODY_LIMIT.saturating_sub(kept.len());
                            kept.extend_from_slice(data.get(..room).unwrap_or(&data));
                        }
                    }
                }
            }
            outcome.map(|()| Exchange {
                status,
                headers,
                body: kept.freeze(),
            })
        }
    };
    conn.abort();
    result
}

fn hyper_failure(err: &hyper::Error, ctx: &AttemptCtx) -> Attempt {
    let io = std::error::Error::source(err).and_then(|s| s.downcast_ref::<std::io::Error>());
    match io {
        Some(io) => classify_io(io, ctx),
        None if err.is_incomplete_message() || err.is_canceled() => {
            ctx.failure(TargetCause::ConnectionReset)
        }
        None => ctx.failure(TargetCause::ProtocolError),
    }
}

/// Whether a response meets every explicit expectation.
fn meets(expect: &HttpExpect, status: StatusCode, headers: &HeaderMap, body: &[u8]) -> bool {
    let code = status.as_u16();
    if !expect
        .status
        .iter()
        .any(|(lo, hi)| (*lo..=*hi).contains(&code))
    {
        return false;
    }
    let headers_ok = expect.headers.iter().all(|(name, needle)| {
        headers
            .get_all(name.as_str())
            .iter()
            .any(|v| v.to_str().is_ok_and(|v| v.contains(needle.as_str())))
    });
    if !headers_ok {
        return false;
    }
    if !expect.body_contains.is_empty() {
        let text = String::from_utf8_lossy(body);
        if !expect
            .body_contains
            .iter()
            .all(|n| text.contains(n.as_str()))
        {
            return false;
        }
    }
    if expect.json.is_empty() {
        return true;
    }
    let Ok(doc) = serde_json::from_slice::<serde_json::Value>(body) else {
        return false;
    };
    expect
        .json
        .iter()
        .all(|(pointer, want)| doc.pointer(pointer) == Some(want))
}

pub(crate) async fn probe(spec: &HttpSpec, ctx: &AttemptCtx) -> AttemptOutput {
    let invalid = |cause| AttemptOutput::from(Attempt::ConfigurationError { cause });
    let Some(mut target) = parse(&spec.url) else {
        return invalid(ConfigCause::InvalidTarget);
    };
    let Ok(method) = Method::from_bytes(spec.method.as_bytes()) else {
        return invalid(ConfigCause::Unsupported);
    };
    let mut certificate: Option<CertificateInfo> = None;
    let mut hops = 0u8;
    loop {
        let mut builder = Request::builder()
            .method(method.clone())
            .uri(target.path.as_str())
            .header(header::HOST, target.authority.as_str())
            .header(header::USER_AGENT, "otterd-probe")
            .header(header::CONNECTION, "close");
        for (k, v) in &spec.headers {
            builder = builder.header(k.as_str(), v.as_str());
        }
        let body = Full::new(Bytes::from(spec.body.clone().unwrap_or_default()));
        let Ok(request) = builder.body(body) else {
            return invalid(ConfigCause::Unsupported);
        };
        let stream = match tcp::connect(&target.host, target.port, ctx).await {
            Ok(s) => s,
            Err(a) => {
                return AttemptOutput {
                    attempt: a,
                    certificate,
                };
            }
        };
        let exchanged = if target.https {
            let hs = tls::handshake(stream, &target.host, &spec.tls, &[b"http/1.1"], ctx).await;
            certificate = hs.certificate.or(certificate);
            match hs.result {
                Ok(tls_stream) => exchange(tls_stream, request, ctx).await,
                Err(a) => Err(a),
            }
        } else {
            exchange(stream, request, ctx).await
        };
        let ex = match exchanged {
            Ok(ex) => ex,
            Err(a) => {
                return AttemptOutput {
                    attempt: a,
                    certificate,
                };
            }
        };
        if spec.follow_redirects && ex.status.is_redirection() && hops < spec.max_redirects {
            let next = ex
                .headers
                .get(header::LOCATION)
                .and_then(|l| l.to_str().ok())
                .and_then(|l| follow(&target, l));
            if let Some(next) = next {
                target = next;
                hops += 1;
                continue;
            }
        }
        ctx.progress.set(Phase::Assert);
        let attempt = if meets(&spec.expect, ex.status, &ex.headers, &ex.body) {
            ctx.success()
        } else {
            ctx.failure(TargetCause::AssertionFailed)
        };
        return AttemptOutput {
            attempt,
            certificate,
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use http::HeaderValue;

    #[test]
    fn parses_targets_with_default_ports() {
        let t = parse("https://example.com/health?x=1").unwrap();
        assert_eq!(
            (t.https, t.port, t.path.as_str()),
            (true, 443, "/health?x=1")
        );
        let t = parse("http://[::1]:8080").unwrap();
        assert_eq!(
            (t.host.as_str(), t.port, t.path.as_str()),
            ("[::1]", 8080, "/")
        );
        assert_eq!(parse("ftp://example.com/"), None);
        assert_eq!(parse("/relative"), None);
    }

    #[test]
    fn follows_absolute_and_relative_locations() {
        let cur = parse("http://a.test:81/x/y").unwrap();
        assert_eq!(follow(&cur, "/z").unwrap().path, "/z");
        assert_eq!(follow(&cur, "w").unwrap().path, "/x/w");
        assert_eq!(follow(&cur, "w").unwrap().authority, "a.test:81");
        assert!(follow(&cur, "https://b.test/").unwrap().https);
    }

    fn json_headers() -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json; charset=utf-8"),
        );
        h
    }

    #[test]
    fn default_expectation_accepts_2xx_and_3xx_only() {
        let e = HttpExpect::default();
        assert!(meets(&e, StatusCode::OK, &HeaderMap::new(), b""));
        assert!(meets(&e, StatusCode::FOUND, &HeaderMap::new(), b""));
        assert!(!meets(
            &e,
            StatusCode::SERVICE_UNAVAILABLE,
            &HeaderMap::new(),
            b""
        ));
    }

    #[test]
    fn header_body_and_json_assertions_all_apply() {
        let e = HttpExpect {
            status: vec![(200, 200)],
            headers: vec![("content-type".into(), "json".into())],
            body_contains: vec!["ok".into()],
            json: vec![("/status".into(), serde_json::json!("ok"))],
        };
        let body = br#"{"status":"ok","n":1}"#;
        assert!(meets(&e, StatusCode::OK, &json_headers(), body));
        assert!(!meets(&e, StatusCode::OK, &HeaderMap::new(), body));
        assert!(!meets(
            &e,
            StatusCode::OK,
            &json_headers(),
            br#"{"status":"degraded"}"#
        ));
        assert!(!meets(
            &e,
            StatusCode::OK,
            &json_headers(),
            b"ok but not json"
        ));
    }
}
