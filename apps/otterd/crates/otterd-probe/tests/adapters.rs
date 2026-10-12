//! Outcome normalization against real local sockets: each protocol's
//! target failures are failures, and failures of our own facilities are
//! Unknown or configuration errors.

// Fixture setup panics on failure like the assertions do.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use hickory_proto::op::{Message, MessageType, ResponseCode};
use hickory_proto::rr::rdata::{A, NS};
use hickory_proto::rr::{Name, RData, Record, RecordType};
use otterd_probe::outcome::{Attempt, ConfigCause, Phase, TargetCause, UnknownCause};
use otterd_probe::spec::{DnsExpect, DnsSpec, HttpExpect, HttpSpec, ProbeSpec, TlsPolicy, TlsSpec};
use otterd_probe::{Resolver, run_attempt};
use std::net::{Ipv4Addr, SocketAddr};
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, UdpSocket};

const T: Duration = Duration::from_secs(2);

fn no_resolver() -> Arc<Resolver> {
    Arc::new(Resolver::new(Vec::new()))
}

fn target_failure(a: &Attempt) -> Option<(TargetCause, Phase)> {
    match a {
        Attempt::TargetFailure { cause, phase, .. } => Some((*cause, *phase)),
        _ => None,
    }
}

async fn closed_port() -> u16 {
    let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
    l.local_addr().unwrap().port()
}

// ---------- TCP ----------

#[tokio::test]
async fn tcp_refused_is_a_target_failure() {
    let port = closed_port().await;
    let out = run_attempt(
        &ProbeSpec::Tcp {
            host: "127.0.0.1".into(),
            port,
        },
        no_resolver(),
        T,
    )
    .await;
    assert_eq!(
        target_failure(&out.attempt),
        Some((TargetCause::ConnectionRefused, Phase::Connect))
    );
}

#[tokio::test]
async fn tcp_listening_is_a_success() {
    let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = l.local_addr().unwrap().port();
    let out = run_attempt(
        &ProbeSpec::Tcp {
            host: "127.0.0.1".into(),
            port,
        },
        no_resolver(),
        T,
    )
    .await;
    assert!(matches!(out.attempt, Attempt::Success { .. }), "{out:?}");
}

#[tokio::test]
async fn port_zero_is_a_configuration_error() {
    let out = run_attempt(
        &ProbeSpec::Tcp {
            host: "127.0.0.1".into(),
            port: 0,
        },
        no_resolver(),
        T,
    )
    .await;
    assert_eq!(
        out.attempt,
        Attempt::ConfigurationError {
            cause: ConfigCause::InvalidTarget
        }
    );
}

// ---------- HTTP ----------

/// A plain HTTP/1.1 server answering by path.
async fn http_server() -> u16 {
    let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = l.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            let Ok((mut s, _)) = l.accept().await else {
                return;
            };
            tokio::spawn(async move {
                let mut buf = vec![0u8; 4096];
                let n = s.read(&mut buf).await.unwrap_or(0);
                let req = String::from_utf8_lossy(buf.get(..n).unwrap_or(&[])).to_string();
                let path = req.split_whitespace().nth(1).unwrap_or("/").to_string();
                let (status, extra, body) = match path.as_str() {
                    "/ok" => (
                        "200 OK",
                        "Content-Type: application/json\r\n",
                        r#"{"status":"ok"}"#,
                    ),
                    "/down" => ("503 Service Unavailable", "", "nope"),
                    "/moved" => ("302 Found", "Location: /ok\r\n", ""),
                    "/slow" => {
                        tokio::time::sleep(Duration::from_secs(10)).await;
                        ("200 OK", "", "late")
                    }
                    "/hangup" => return,
                    _ => ("404 Not Found", "", ""),
                };
                let resp = format!(
                    "HTTP/1.1 {status}\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = s.write_all(resp.as_bytes()).await;
            });
        }
    });
    port
}

fn http(port: u16, path: &str) -> HttpSpec {
    HttpSpec::get(format!("http://127.0.0.1:{port}{path}"))
}

#[tokio::test]
async fn http_status_and_json_assertions() {
    let port = http_server().await;
    let mut ok = http(port, "/ok");
    ok.expect = HttpExpect {
        status: vec![(200, 200)],
        json: vec![("/status".into(), serde_json::json!("ok"))],
        ..HttpExpect::default()
    };
    let out = run_attempt(&ProbeSpec::Http(ok), no_resolver(), T).await;
    assert!(matches!(out.attempt, Attempt::Success { .. }), "{out:?}");

    let out = run_attempt(&ProbeSpec::Http(http(port, "/down")), no_resolver(), T).await;
    assert_eq!(
        target_failure(&out.attempt),
        Some((TargetCause::AssertionFailed, Phase::Assert))
    );
}

#[tokio::test]
async fn http_follows_redirects_only_when_asked() {
    let port = http_server().await;
    let mut strict = http(port, "/moved");
    strict.expect.status = vec![(200, 299)];
    let out = run_attempt(&ProbeSpec::Http(strict.clone()), no_resolver(), T).await;
    assert!(matches!(out.attempt, Attempt::Success { .. }), "{out:?}");
    strict.follow_redirects = false;
    let out = run_attempt(&ProbeSpec::Http(strict), no_resolver(), T).await;
    assert_eq!(
        target_failure(&out.attempt).map(|f| f.0),
        Some(TargetCause::AssertionFailed)
    );
}

#[tokio::test]
async fn http_response_deadline_is_a_target_timeout_in_the_response_phase() {
    let port = http_server().await;
    let out = run_attempt(
        &ProbeSpec::Http(http(port, "/slow")),
        no_resolver(),
        Duration::from_millis(500),
    )
    .await;
    assert_eq!(
        target_failure(&out.attempt),
        Some((TargetCause::TargetTimeout, Phase::Response))
    );
}

#[tokio::test]
async fn http_hangup_is_a_reset() {
    let port = http_server().await;
    let out = run_attempt(&ProbeSpec::Http(http(port, "/hangup")), no_resolver(), T).await;
    assert_eq!(
        target_failure(&out.attempt).map(|f| f.0),
        Some(TargetCause::ConnectionReset),
        "{out:?}"
    );
}

// ---------- TLS ----------

struct TlsFixture {
    port: u16,
    ca: tempfile::NamedTempFile,
}

/// A TLS server on 127.0.0.1 presenting a self-signed certificate for
/// `localhost`, valid from `from_days` to `to_days` relative to now.
async fn tls_server(from_days: i64, to_days: i64) -> TlsFixture {
    let ca_key = rcgen::KeyPair::generate().unwrap();
    let mut ca_params = rcgen::CertificateParams::new(Vec::<String>::new()).unwrap();
    ca_params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    let ca_cert = ca_params.self_signed(&ca_key).unwrap();
    let issuer = rcgen::Issuer::new(ca_params, ca_key);

    let mut params = rcgen::CertificateParams::new(vec!["localhost".to_string()]).unwrap();
    let now = time::OffsetDateTime::now_utc();
    params.not_before = now + time::Duration::days(from_days);
    params.not_after = now + time::Duration::days(to_days);
    let key = rcgen::KeyPair::generate().unwrap();
    let cert = params.signed_by(&key, &issuer).unwrap();
    let mut ca = tempfile::NamedTempFile::new().unwrap();
    std::io::Write::write_all(&mut ca, ca_cert.pem().as_bytes()).unwrap();

    let config = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(
        vec![cert.der().clone()],
        rustls::pki_types::PrivateKeyDer::try_from(key.serialize_der()).unwrap(),
    )
    .unwrap();
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
    let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = l.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            let Ok((s, _)) = l.accept().await else { return };
            let acceptor = acceptor.clone();
            tokio::spawn(async move {
                let _ = acceptor.accept(s).await;
            });
        }
    });
    TlsFixture { port, ca }
}

fn tls(port: u16, policy: TlsPolicy, min_days_valid: Option<u32>) -> ProbeSpec {
    ProbeSpec::Tls(TlsSpec {
        host: "127.0.0.1".into(),
        port,
        server_name: Some("localhost".into()),
        min_days_valid,
        policy,
    })
}

#[tokio::test]
async fn tls_untrusted_chain_is_invalid_but_expiry_is_still_read() {
    let f = tls_server(-1, 30).await;
    let out = run_attempt(&tls(f.port, TlsPolicy::default(), None), no_resolver(), T).await;
    assert_eq!(
        target_failure(&out.attempt),
        Some((TargetCause::TlsInvalid, Phase::TlsHandshake))
    );
    let cert = out.certificate.expect("leaf certificate recorded");
    assert!((29..=30).contains(&cert.days_remaining(std::time::SystemTime::now())));
}

#[tokio::test]
async fn tls_trusted_and_valid_long_enough_succeeds() {
    let f = tls_server(-1, 30).await;
    let policy = TlsPolicy {
        skip_verify: false,
        ca_file: Some(f.ca.path().to_path_buf()),
    };
    let out = run_attempt(&tls(f.port, policy.clone(), Some(14)), no_resolver(), T).await;
    assert!(matches!(out.attempt, Attempt::Success { .. }), "{out:?}");
    assert!(out.certificate.unwrap().verified);

    let out = run_attempt(&tls(f.port, policy, Some(45)), no_resolver(), T).await;
    assert_eq!(
        target_failure(&out.attempt),
        Some((TargetCause::CertExpiring, Phase::Assert))
    );
}

#[tokio::test]
async fn tls_hostname_mismatch_is_invalid() {
    let f = tls_server(-1, 30).await;
    let spec = ProbeSpec::Tls(TlsSpec {
        host: "127.0.0.1".into(),
        port: f.port,
        server_name: Some("other.test".into()),
        min_days_valid: None,
        policy: TlsPolicy {
            skip_verify: false,
            ca_file: Some(f.ca.path().to_path_buf()),
        },
    });
    let out = run_attempt(&spec, no_resolver(), T).await;
    assert_eq!(
        target_failure(&out.attempt).map(|f| f.0),
        Some(TargetCause::TlsInvalid)
    );
}

#[tokio::test]
async fn tls_expired_is_invalid_unless_verification_is_skipped() {
    let f = tls_server(-30, -2).await;
    let trusted = TlsPolicy {
        skip_verify: false,
        ca_file: Some(f.ca.path().to_path_buf()),
    };
    let out = run_attempt(&tls(f.port, trusted, None), no_resolver(), T).await;
    assert_eq!(
        target_failure(&out.attempt).map(|f| f.0),
        Some(TargetCause::TlsInvalid)
    );
    let skip = TlsPolicy {
        skip_verify: true,
        ca_file: None,
    };
    let out = run_attempt(&tls(f.port, skip.clone(), None), no_resolver(), T).await;
    assert!(matches!(out.attempt, Attempt::Success { .. }), "{out:?}");
    assert!(!out.certificate.unwrap().verified);
    // a minimum validity still applies with verification off
    let out = run_attempt(&tls(f.port, skip, Some(1)), no_resolver(), T).await;
    assert_eq!(
        target_failure(&out.attempt).map(|f| f.0),
        Some(TargetCause::CertExpiring)
    );
}

#[tokio::test]
async fn tls_missing_ca_file_is_a_configuration_error() {
    let f = tls_server(-1, 30).await;
    let policy = TlsPolicy {
        skip_verify: false,
        ca_file: Some("/nonexistent/ca.pem".into()),
    };
    let out = run_attempt(&tls(f.port, policy, None), no_resolver(), T).await;
    assert_eq!(
        out.attempt,
        Attempt::ConfigurationError {
            cause: ConfigCause::CaMaterialMissing
        }
    );
}

// ---------- DNS ----------

#[derive(Clone, Copy)]
enum DnsMode {
    /// Answers by name: `ok.test` A, `nx.test` NXDOMAIN, `servfail.test`
    /// SERVFAIL, the root zone's NS, anything else NXDOMAIN.
    Normal,
    /// SERVFAIL for everything, the root included: a broken resolver.
    AllServfail,
    /// Never answers.
    Silent,
}

async fn dns_server(mode: DnsMode) -> SocketAddr {
    let sock = UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let addr = sock.local_addr().unwrap();
    tokio::spawn(async move {
        let mut buf = vec![0u8; 1500];
        loop {
            let Ok((n, from)) = sock.recv_from(&mut buf).await else {
                return;
            };
            if matches!(mode, DnsMode::Silent) {
                continue;
            }
            let Some(Ok(q)) = buf.get(..n).map(Message::from_vec) else {
                continue;
            };
            let Some(query) = q.queries.first().cloned() else {
                continue;
            };
            let mut r = Message::new(q.metadata.id, MessageType::Response, q.metadata.op_code);
            r.metadata.recursion_desired = true;
            r.metadata.recursion_available = true;
            let name = query.name().to_ascii();
            let rtype = query.query_type();
            r.add_query(query.clone());
            r.metadata.response_code = match (mode, name.as_str(), rtype) {
                (DnsMode::AllServfail, _, _) | (_, "servfail.test.", _) => ResponseCode::ServFail,
                (_, "ok.test.", RecordType::A) => {
                    r.add_answer(Record::from_rdata(
                        query.name().clone(),
                        60,
                        RData::A(A(Ipv4Addr::new(192, 0, 2, 7))),
                    ));
                    ResponseCode::NoError
                }
                (_, "ok.test.", _) => ResponseCode::NoError,
                (_, ".", RecordType::NS) => {
                    r.add_answer(Record::from_rdata(
                        Name::root(),
                        60,
                        RData::NS(NS(Name::from_str("a.root-servers.net.").unwrap())),
                    ));
                    ResponseCode::NoError
                }
                _ => ResponseCode::NXDomain,
            };
            let _ = sock.send_to(&r.to_vec().unwrap(), from).await;
        }
    });
    addr
}

fn dns(server: SocketAddr, name: &str, expect: DnsExpect) -> ProbeSpec {
    ProbeSpec::Dns(DnsSpec {
        server,
        name: name.into(),
        record_type: "A".into(),
        expect,
    })
}

fn answer(contains: Option<&str>) -> DnsExpect {
    DnsExpect::Answer {
        contains: contains.map(str::to_string),
    }
}

#[tokio::test]
async fn dns_answers_from_the_resolver_under_test_are_target_results() {
    let server = dns_server(DnsMode::Normal).await;
    let cases = [
        ("ok.test", answer(Some("192.0.2.7")), None),
        (
            "ok.test",
            answer(Some("198.51.100.1")),
            Some(TargetCause::AssertionFailed),
        ),
        (
            "servfail.test",
            answer(None),
            Some(TargetCause::DnsServfail),
        ),
        ("nx.test", answer(None), Some(TargetCause::DnsNxdomain)),
        // explicit negative and diagnostic expectations
        ("nx.test", DnsExpect::NxDomain, None),
        ("servfail.test", DnsExpect::ServFail, None),
        (
            "ok.test",
            DnsExpect::NxDomain,
            Some(TargetCause::AssertionFailed),
        ),
    ];
    for (name, expect, want) in cases {
        let out = run_attempt(&dns(server, name, expect.clone()), no_resolver(), T).await;
        match want {
            None => assert!(
                matches!(out.attempt, Attempt::Success { .. }),
                "{name} {expect:?}: {out:?}"
            ),
            Some(cause) => assert_eq!(
                target_failure(&out.attempt).map(|f| f.0),
                Some(cause),
                "{name} {expect:?}"
            ),
        }
    }
}

#[tokio::test]
async fn dns_resolver_under_test_silent_or_closed_is_a_target_failure() {
    let silent = dns_server(DnsMode::Silent).await;
    let out = run_attempt(
        &dns(silent, "ok.test", answer(None)),
        no_resolver(),
        Duration::from_millis(500),
    )
    .await;
    assert_eq!(
        target_failure(&out.attempt).map(|f| f.0),
        Some(TargetCause::TargetTimeout)
    );
    let closed = {
        let s = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        s.local_addr().unwrap()
    };
    let out = run_attempt(&dns(closed, "ok.test", answer(None)), no_resolver(), T).await;
    assert_eq!(
        target_failure(&out.attempt).map(|f| f.0),
        Some(TargetCause::ConnectionRefused)
    );
}

#[tokio::test]
async fn unsupported_record_type_is_a_configuration_error() {
    let server = dns_server(DnsMode::Normal).await;
    let spec = ProbeSpec::Dns(DnsSpec {
        server,
        name: "ok.test".into(),
        record_type: "AXFR".into(),
        expect: answer(None),
    });
    let out = run_attempt(&spec, no_resolver(), T).await;
    assert_eq!(
        out.attempt,
        Attempt::ConfigurationError {
            cause: ConfigCause::Unsupported
        }
    );
}

// ---------- name resolution for other probes ----------

fn tcp_to(host: &str) -> ProbeSpec {
    ProbeSpec::Tcp {
        host: host.into(),
        port: 9,
    }
}

#[tokio::test]
async fn target_name_failures_through_a_healthy_resolver_are_target_dns_failures() {
    let resolver = Arc::new(Resolver::new(vec![dns_server(DnsMode::Normal).await]));
    for host in ["nx.test", "servfail.test"] {
        let out = run_attempt(&tcp_to(host), resolver.clone(), T).await;
        assert_eq!(
            target_failure(&out.attempt),
            Some((TargetCause::TargetDnsFailure, Phase::Resolve)),
            "{host}"
        );
    }
}

#[tokio::test]
async fn a_broken_local_resolver_is_unknown_never_a_failure() {
    let closed = {
        let s = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        s.local_addr().unwrap()
    };
    for resolver in [
        Resolver::new(vec![dns_server(DnsMode::AllServfail).await]),
        Resolver::new(vec![dns_server(DnsMode::Silent).await]),
        Resolver::new(vec![closed]),
    ] {
        let out = run_attempt(
            &tcp_to("ok.test"),
            Arc::new(resolver.clone()),
            Duration::from_secs(5),
        )
        .await;
        assert_eq!(
            out.attempt,
            Attempt::Unknown {
                cause: UnknownCause::LocalResolverFailure,
                phase: Phase::Resolve
            },
            "{resolver:?}"
        );
    }
}

#[tokio::test]
async fn resolved_names_are_used() {
    let resolver = Arc::new(Resolver::new(vec![dns_server(DnsMode::Normal).await]));
    // ok.test resolves to 192.0.2.7 (TEST-NET-1): the connect then goes
    // nowhere, so this only shows resolution got past the Resolve phase.
    let out = run_attempt(&tcp_to("ok.test"), resolver, Duration::from_millis(300)).await;
    assert_ne!(
        target_failure(&out.attempt).map(|f| f.1),
        Some(Phase::Resolve),
        "{out:?}"
    );
}

// ---------- ICMP ----------

#[tokio::test]
async fn icmp_loopback_answers_or_reports_missing_permission() {
    let out = run_attempt(
        &ProbeSpec::Icmp {
            host: "127.0.0.1".into(),
        },
        no_resolver(),
        T,
    )
    .await;
    match out.attempt {
        Attempt::Success { .. }
        | Attempt::ConfigurationError {
            cause: ConfigCause::PermissionMissing,
        } => {}
        other => panic!("loopback echo: {other:?}"),
    }
}
