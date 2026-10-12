//! Outcome normalization against real local sockets: each protocol's
//! target failures are failures, and failures of our own facilities are
//! Unknown or configuration errors.

// Fixture setup panics on failure like the assertions do.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use hickory_proto::op::{Message, MessageType, ResponseCode};
use hickory_proto::rr::rdata::{A, NS};
use hickory_proto::rr::{Name, RData, Record, RecordType};
use otterd_probe::outcome::{Attempt, ConfigCause, Phase, TargetCause, UnknownCause};
use otterd_probe::spec::{DnsExpect, DnsSpec, ProbeSpec};
use otterd_probe::{Resolver, run_attempt};
use std::net::{Ipv4Addr, SocketAddr};
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
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
