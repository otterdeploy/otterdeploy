//! TLS trust for the control-plane connection.

use crate::TransportError;
use rustls::pki_types::CertificateDer;
use rustls::pki_types::pem::PemObject as _;
use rustls::{ClientConfig, RootCertStore};
use std::path::PathBuf;
use std::sync::Arc;

/// Which certificate authorities may vouch for the control plane.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Trust {
    /// The public web PKI.
    PublicRoots,
    /// The public web PKI plus the CAs in this PEM file.
    PublicRootsAnd(PathBuf),
    /// Only the CAs in this PEM file (a self-hosted control plane with its own CA).
    Only(PathBuf),
}

fn add_pem(roots: &mut RootCertStore, pem: &std::path::Path) -> Result<(), TransportError> {
    let certs = CertificateDer::pem_file_iter(pem)
        .map_err(|e| TransportError::Tls(format!("{}: {e}", pem.display())))?;
    let mut added = 0;
    for cert in certs {
        let cert = cert.map_err(|e| TransportError::Tls(format!("{}: {e}", pem.display())))?;
        roots
            .add(cert)
            .map_err(|e| TransportError::Tls(format!("{}: {e}", pem.display())))?;
        added += 1;
    }
    if added == 0 {
        return Err(TransportError::Tls(format!(
            "{} holds no certificates",
            pem.display()
        )));
    }
    Ok(())
}

/// A client configuration for `trust`, TLS 1.2 and 1.3, no client certificate
/// (the node authenticates inside the session with its identity key).
pub fn client_config(trust: &Trust) -> Result<Arc<ClientConfig>, TransportError> {
    let mut roots = RootCertStore::empty();
    match trust {
        Trust::PublicRoots => roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned()),
        Trust::PublicRootsAnd(pem) => {
            roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
            add_pem(&mut roots, pem)?;
        }
        Trust::Only(pem) => add_pem(&mut roots, pem)?,
    }
    let config =
        ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()
            .map_err(|e| TransportError::Tls(e.to_string()))?
            .with_root_certificates(roots)
            .with_no_client_auth();
    Ok(Arc::new(config))
}
