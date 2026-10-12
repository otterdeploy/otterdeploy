//! What a probe checks, per protocol.

use serde::Serialize;
use std::net::SocketAddr;
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
    pub body_contains: Option<String>,
    /// `(JSON pointer, expected value)` pairs that must all match.
    pub json: Vec<(String, serde_json::Value)>,
}

impl Default for HttpExpect {
    fn default() -> Self {
        Self {
            status: vec![(200, 399)],
            headers: Vec::new(),
            body_contains: None,
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
