//! TLS handshakes and certificate validity.

use super::{AttemptCtx, AttemptOutput, CertificateInfo, bare_host, classify_io, tcp};
use crate::outcome::{Attempt, ConfigCause, Phase, TargetCause};
use crate::spec::{TlsPolicy, TlsSpec};
use rustls::client::WebPkiServerVerifier;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{CryptoProvider, verify_tls12_signature, verify_tls13_signature};
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, RootCertStore, SignatureScheme};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::time::SystemTime;
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;
use tokio_rustls::client::TlsStream;

fn provider() -> Arc<CryptoProvider> {
    static PROVIDER: OnceLock<Arc<CryptoProvider>> = OnceLock::new();
    PROVIDER
        .get_or_init(|| Arc::new(rustls::crypto::ring::default_provider()))
        .clone()
}

fn mozilla_roots() -> Arc<RootCertStore> {
    static ROOTS: OnceLock<Arc<RootCertStore>> = OnceLock::new();
    ROOTS
        .get_or_init(|| {
            Arc::new(RootCertStore {
                roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
            })
        })
        .clone()
}

fn roots(policy: &TlsPolicy) -> Result<Arc<RootCertStore>, Attempt> {
    let Some(path) = &policy.ca_file else {
        return Ok(mozilla_roots());
    };
    let missing = Attempt::ConfigurationError {
        cause: ConfigCause::CaMaterialMissing,
    };
    let mut store = RootCertStore::empty();
    let certs = CertificateDer::pem_file_iter(path).map_err(|_| missing.clone())?;
    for cert in certs {
        let cert = cert.map_err(|_| missing.clone())?;
        store.add(cert).map_err(|_| missing.clone())?;
    }
    if store.is_empty() {
        return Err(missing);
    }
    Ok(Arc::new(store))
}

/// Verifies like the default verifier (or not at all, when the check skips
/// verification) and keeps the leaf certificate, so its expiry is known even
/// when verification rejects it.
#[derive(Debug)]
struct Recording {
    inner: Option<Arc<WebPkiServerVerifier>>,
    leaf: Mutex<Option<CertificateDer<'static>>>,
}

impl Recording {
    fn leaf(&self) -> Option<CertificateDer<'static>> {
        self.leaf
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

impl ServerCertVerifier for Recording {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp_response: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        *self.leaf.lock().unwrap_or_else(PoisonError::into_inner) =
            Some(end_entity.clone().into_owned());
        match &self.inner {
            Some(v) => {
                v.verify_server_cert(end_entity, intermediates, server_name, ocsp_response, now)
            }
            None => Ok(ServerCertVerified::assertion()),
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(
            message,
            cert,
            dss,
            &provider().signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(
            message,
            cert,
            dss,
            &provider().signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

fn not_after(der: &CertificateDer<'_>) -> Option<i64> {
    let (_, cert) = x509_parser::parse_x509_certificate(der.as_ref()).ok()?;
    Some(cert.validity().not_after.timestamp())
}

/// A finished handshake, or why it failed, plus the leaf certificate seen.
pub(crate) struct Handshake {
    pub result: Result<TlsStream<TcpStream>, Attempt>,
    pub certificate: Option<CertificateInfo>,
}

/// Handshake over `stream` for `name`, with ALPN `alpn`.
pub(crate) async fn handshake(
    stream: TcpStream,
    name: &str,
    policy: &TlsPolicy,
    alpn: &[&[u8]],
    ctx: &AttemptCtx,
) -> Handshake {
    let fail = |a| Handshake {
        result: Err(a),
        certificate: None,
    };
    let roots = match roots(policy) {
        Ok(r) => r,
        Err(a) => return fail(a),
    };
    let inner = if policy.skip_verify {
        None
    } else {
        match WebPkiServerVerifier::builder_with_provider(roots, provider()).build() {
            Ok(v) => Some(v),
            Err(_) => {
                return fail(Attempt::ConfigurationError {
                    cause: ConfigCause::CaMaterialMissing,
                });
            }
        }
    };
    let verifier = Arc::new(Recording {
        inner,
        leaf: Mutex::new(None),
    });
    let Ok(builder) =
        ClientConfig::builder_with_provider(provider()).with_safe_default_protocol_versions()
    else {
        return fail(Attempt::ConfigurationError {
            cause: ConfigCause::Unsupported,
        });
    };
    let mut config = builder
        .dangerous()
        .with_custom_certificate_verifier(verifier.clone())
        .with_no_client_auth();
    config.alpn_protocols = alpn.iter().map(|p| p.to_vec()).collect();
    let Ok(server_name) = ServerName::try_from(bare_host(name).to_string()) else {
        return fail(Attempt::ConfigurationError {
            cause: ConfigCause::InvalidTarget,
        });
    };
    ctx.progress.set(Phase::TlsHandshake);
    let result = TlsConnector::from(Arc::new(config))
        .connect(server_name, stream)
        .await
        .map_err(|e| classify_tls(&e, ctx));
    let certificate = verifier.leaf().and_then(|der| {
        Some(CertificateInfo {
            not_after: not_after(&der)?,
            verified: !policy.skip_verify,
        })
    });
    Handshake {
        result,
        certificate,
    }
}

fn classify_tls(err: &std::io::Error, ctx: &AttemptCtx) -> Attempt {
    match err
        .get_ref()
        .and_then(|e| e.downcast_ref::<rustls::Error>())
    {
        Some(rustls::Error::InvalidCertificate(_)) => ctx.failure(TargetCause::TlsInvalid),
        Some(_) => ctx.failure(TargetCause::ProtocolError),
        None => classify_io(err, ctx),
    }
}

pub(crate) async fn probe(spec: &TlsSpec, ctx: &AttemptCtx) -> AttemptOutput {
    let stream = match tcp::connect(&spec.host, spec.port, ctx).await {
        Ok(s) => s,
        Err(a) => return a.into(),
    };
    let name = spec.server_name.as_deref().unwrap_or(&spec.host);
    let hs = handshake(stream, name, &spec.policy, &[], ctx).await;
    let attempt = if let Err(a) = hs.result {
        a
    } else {
        ctx.progress.set(Phase::Assert);
        match (spec.min_days_valid, hs.certificate) {
            (Some(min), Some(cert)) if cert.days_remaining(SystemTime::now()) < i64::from(min) => {
                ctx.failure(TargetCause::CertExpiring)
            }
            (Some(_), None) => ctx.failure(TargetCause::ProtocolError),
            _ => ctx.success(),
        }
    };
    AttemptOutput {
        attempt,
        certificate: hs.certificate,
    }
}
