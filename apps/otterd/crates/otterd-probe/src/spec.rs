//! What a probe checks, per protocol.

use crate::outcome::ConfigCause;
use otterd_proto::health as contract;
use serde::Serialize;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;

/// One check's target and expectations.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "protocol", rename_all = "snake_case")]
pub enum ProbeSpec {
    /// A TCP connect.
    Tcp { host: String, port: u16 },
    /// An HTTP(S) request and assertions on the response.
    Http(HttpSpec),
    /// A TLS handshake, and the certificate's remaining validity.
    Tls(TlsSpec),
    /// A query to a specific resolver: the resolver is the target.
    Dns(DnsSpec),
    /// An ICMP echo.
    Icmp { host: String },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HttpSpec {
    /// `http://` or `https://` URL.
    pub url: String,
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
    pub follow_redirects: bool,
    pub max_redirects: u8,
    pub tls: TlsPolicy,
    pub expect: HttpExpect,
}

impl HttpSpec {
    /// `GET url`, following up to 5 redirects, expecting a 2xx or 3xx final
    /// status with default certificate verification.
    pub fn get(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            method: "GET".into(),
            headers: Vec::new(),
            body: None,
            follow_redirects: true,
            max_redirects: 5,
            tls: TlsPolicy::default(),
            expect: HttpExpect::default(),
        }
    }
}

/// Explicit expectations of an HTTP check. Anything not stated is not
/// checked; the default accepts any 2xx or 3xx final status.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HttpExpect {
    /// Inclusive status ranges, any of which passes.
    pub status: Vec<(u16, u16)>,
    /// `(header, substring)` pairs that must all match.
    pub headers: Vec<(String, String)>,
    /// Substrings the (size-bounded) body must all contain.
    pub body_contains: Vec<String>,
    /// `(JSON pointer, expected value)` pairs that must all match.
    pub json: Vec<(String, serde_json::Value)>,
}

impl Default for HttpExpect {
    fn default() -> Self {
        Self {
            status: vec![(200, 399)],
            headers: Vec::new(),
            body_contains: Vec::new(),
            json: Vec::new(),
        }
    }
}

/// How a certificate is checked.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct TlsPolicy {
    /// `false` skips chain and hostname validation. The certificate's expiry
    /// is still read and the round records that verification was off.
    pub skip_verify: bool,
    /// A PEM bundle to trust instead of the built-in Mozilla roots.
    pub ca_file: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TlsSpec {
    pub host: String,
    pub port: u16,
    /// SNI and verification name, when it differs from `host`.
    pub server_name: Option<String>,
    pub min_days_valid: Option<u32>,
    pub policy: TlsPolicy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DnsSpec {
    pub server: SocketAddr,
    pub name: String,
    /// `A`, `AAAA`, `CNAME`, `MX`, `TXT`, `NS`, `SOA`, `CAA`, `SRV`, `PTR`.
    pub record_type: String,
    pub expect: DnsExpect,
}

/// What the resolver under test must answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DnsExpect {
    /// A successful answer; with `contains`, one record's data must equal
    /// that text (a trailing dot on names is ignored), as the contract says.
    Answer { contains: Option<String> },
    /// The name must not exist (a negative-answer test).
    NxDomain,
    /// The resolver must fail the query (a diagnostic check only).
    ServFail,
}

/// What a contract check's references point at, resolved by the daemon.
///
/// Header and body references are secrets and CA bundles are configuration;
/// the daemon owns both stores, so building a spec asks it rather than
/// reading them here.
pub trait References {
    /// A local PEM bundle for a CA bundle reference.
    fn ca_bundle(&self, reference: &str) -> Option<PathBuf>;
    /// A `(name, value)` header for a header reference.
    fn header(&self, reference: &str) -> Option<(String, String)>;
    /// A request body for a body reference.
    fn body(&self, reference: &str) -> Option<String>;
}

/// No references can be resolved: checks that use one are configuration
/// errors.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoReferences;

impl References for NoReferences {
    fn ca_bundle(&self, _: &str) -> Option<PathBuf> {
        None
    }
    fn header(&self, _: &str) -> Option<(String, String)> {
        None
    }
    fn body(&self, _: &str) -> Option<String> {
        None
    }
}

fn tls_policy(
    tls_verify: bool,
    ca_bundle_ref: Option<&str>,
    refs: &impl References,
) -> Result<TlsPolicy, ConfigCause> {
    let ca_file = match ca_bundle_ref {
        None => None,
        Some(r) => Some(refs.ca_bundle(r).ok_or(ConfigCause::CaMaterialMissing)?),
    };
    Ok(TlsPolicy {
        skip_verify: !tls_verify,
        ca_file,
    })
}

fn http_expect(assertions: &[contract::HttpAssertion]) -> HttpExpect {
    let mut expect = HttpExpect {
        status: Vec::new(),
        ..HttpExpect::default()
    };
    for a in assertions {
        match a {
            contract::HttpAssertion::StatusRange { min, max } => expect.status.push((*min, *max)),
            contract::HttpAssertion::HeaderContains { name, value } => {
                expect.headers.push((name.clone(), value.clone()));
            }
            contract::HttpAssertion::BodyContains { value } => {
                expect.body_contains.push(value.clone());
            }
            contract::HttpAssertion::JsonEquals { pointer, value } => {
                expect.json.push((pointer.clone(), value.clone()));
            }
        }
    }
    if expect.status.is_empty() {
        expect.status = HttpExpect::default().status;
    }
    expect
}

/// Build the spec for a contract check's probe.
///
/// `default_dns` is the resolver a DNS check without its own server tests.
///
/// # Errors
/// The probe kind has no adapter here (exec, gRPC), a reference cannot be
/// resolved, or the target is malformed. Each is the check's
/// configuration error, never a failed vote.
pub fn from_contract(
    probe: &contract::Probe,
    refs: &impl References,
    default_dns: Option<SocketAddr>,
) -> Result<ProbeSpec, ConfigCause> {
    Ok(match probe {
        contract::Probe::Tcp { host, port } => ProbeSpec::Tcp {
            host: host.clone(),
            port: *port,
        },
        contract::Probe::Http {
            url,
            method,
            header_refs,
            body_ref,
            assertions,
            follow_redirects,
            max_redirects,
            tls_verify,
            ca_bundle_ref,
        } => ProbeSpec::Http(HttpSpec {
            url: url.clone(),
            method: method.clone(),
            headers: header_refs
                .iter()
                .map(|r| refs.header(r).ok_or(ConfigCause::Unsupported))
                .collect::<Result<_, _>>()?,
            body: match body_ref {
                None => None,
                Some(r) => Some(refs.body(r).ok_or(ConfigCause::Unsupported)?),
            },
            follow_redirects: *follow_redirects,
            max_redirects: *max_redirects,
            tls: tls_policy(*tls_verify, ca_bundle_ref.as_deref(), refs)?,
            expect: http_expect(assertions),
        }),
        contract::Probe::Tls {
            host,
            port,
            server_name,
            tls_verify,
            ca_bundle_ref,
            min_days_valid,
        } => ProbeSpec::Tls(TlsSpec {
            host: host.clone(),
            port: *port,
            server_name: server_name.clone(),
            min_days_valid: (*min_days_valid > 0).then_some(*min_days_valid),
            policy: tls_policy(*tls_verify, ca_bundle_ref.as_deref(), refs)?,
        }),
        contract::Probe::Dns {
            name,
            record_type,
            server,
            expect,
        } => ProbeSpec::Dns(DnsSpec {
            server: match server {
                Some(s) => parse_server(s).ok_or(ConfigCause::InvalidTarget)?,
                None => default_dns.ok_or(ConfigCause::Unsupported)?,
            },
            name: name.clone(),
            record_type: record_type.clone(),
            expect: match expect {
                contract::DnsExpect::Answer { contains } => DnsExpect::Answer {
                    contains: contains.clone(),
                },
                contract::DnsExpect::Nxdomain => DnsExpect::NxDomain,
                contract::DnsExpect::Servfail => DnsExpect::ServFail,
            },
        }),
        contract::Probe::Icmp { host } => ProbeSpec::Icmp { host: host.clone() },
        contract::Probe::Exec { .. } | contract::Probe::Grpc { .. } => {
            return Err(ConfigCause::Unsupported);
        }
    })
}

/// `1.1.1.1`, `1.1.1.1:5353`, `[::1]:53` or `::1`.
fn parse_server(s: &str) -> Option<SocketAddr> {
    s.parse::<SocketAddr>()
        .ok()
        .or_else(|| s.parse::<IpAddr>().ok().map(|ip| SocketAddr::new(ip, 53)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn probe(json: serde_json::Value) -> contract::Probe {
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn http_assertions_become_explicit_expectations() {
        let p = probe(serde_json::json!({
            "kind": "http", "url": "https://example.com/health", "method": "GET",
            "assertions": [
                {"kind": "status-range", "min": 200, "max": 204},
                {"kind": "header-contains", "name": "content-type", "value": "json"},
                {"kind": "body-contains", "value": "ok"},
                {"kind": "json-equals", "pointer": "/status", "value": "ok"}
            ],
            "followRedirects": false, "maxRedirects": 0, "tlsVerify": true
        }));
        let ProbeSpec::Http(spec) = from_contract(&p, &NoReferences, None).unwrap() else {
            panic!("http");
        };
        assert_eq!(spec.expect.status, vec![(200, 204)]);
        assert_eq!(spec.expect.body_contains, vec!["ok".to_string()]);
        assert_eq!(spec.expect.json.len(), 1);
        assert!(!spec.tls.skip_verify);
        assert!(!spec.follow_redirects);
    }

    #[test]
    fn unresolvable_references_are_configuration_errors() {
        let p = probe(serde_json::json!({
            "kind": "tls", "host": "example.com", "port": 443, "tlsVerify": true,
            "caBundleRef": "cfg:private-ca", "minDaysValid": 14
        }));
        assert_eq!(
            from_contract(&p, &NoReferences, None),
            Err(ConfigCause::CaMaterialMissing)
        );
        let p = probe(serde_json::json!({
            "kind": "http", "url": "https://example.com/", "method": "POST",
            "bodyRef": "secret:payload",
            "followRedirects": true, "maxRedirects": 5, "tlsVerify": true
        }));
        assert_eq!(
            from_contract(&p, &NoReferences, None),
            Err(ConfigCause::Unsupported)
        );
    }

    #[test]
    fn dns_checks_need_a_server_and_keep_their_expectation() {
        let p = probe(serde_json::json!({
            "kind": "dns", "name": "example.com", "recordType": "A",
            "server": "1.1.1.1", "expect": {"kind": "nxdomain"}
        }));
        let ProbeSpec::Dns(spec) = from_contract(&p, &NoReferences, None).unwrap() else {
            panic!("dns");
        };
        assert_eq!(spec.server, "1.1.1.1:53".parse().unwrap());
        assert_eq!(spec.expect, DnsExpect::NxDomain);
        let p = probe(serde_json::json!({
            "kind": "dns", "name": "example.com", "recordType": "A",
            "expect": {"kind": "answer"}
        }));
        assert_eq!(
            from_contract(&p, &NoReferences, None),
            Err(ConfigCause::Unsupported)
        );
    }

    #[test]
    fn exec_and_grpc_have_no_adapter_here() {
        let p = probe(serde_json::json!({"kind": "grpc", "host": "x", "port": 1, "tls": false}));
        assert_eq!(
            from_contract(&p, &NoReferences, None),
            Err(ConfigCause::Unsupported)
        );
    }
}
