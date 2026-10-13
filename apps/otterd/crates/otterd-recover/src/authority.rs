//! Authority revocation: everything below a term stops authorizing, on every
//! node it names (or all of them), signed by the offline recovery key.

use crate::{RecoverError, now_ms};
use ed25519_dalek::SigningKey;
use otterd_journal::Journal;
use otterd_proto::U53;
use otterd_proto::envelope::{SignContext, SignedEnvelope};
use otterd_proto::identity::AuthorityRevocation;
use otterd_proto::ids::{InstallId, NodeId};
use otterd_proto::journal::Record;
use std::io::{Read as _, Write as _};
use std::os::unix::net::UnixStream;
use std::path::Path;

pub fn sign(
    recovery: &SigningKey,
    install_id: InstallId,
    below_term: U53,
    nodes: Vec<NodeId>,
    reason: &str,
) -> Result<SignedEnvelope, RecoverError> {
    if below_term < U53::from_const(2) {
        return Err(RecoverError::Refused(
            "revoking below term 1 revokes nothing".into(),
        ));
    }
    Ok(SignedEnvelope::sign(
        recovery,
        SignContext::AuthorityRevoke,
        &AuthorityRevocation {
            install_id,
            below_term,
            nodes,
            issued_at_unix_ms: now_ms(),
            reason: reason.to_owned(),
        },
    )?)
}

/// Apply with the daemon stopped (it holds the journal lock otherwise): verify
/// against the recovery key pinned in this node's journal, then journal it.
pub fn apply_offline(journal: &Path, revocation: &SignedEnvelope) -> Result<U53, RecoverError> {
    let (mut j, _) = Journal::open(journal)?;
    let id = j
        .state()
        .identity
        .clone()
        .ok_or_else(|| RecoverError::Refused("the journal has no node identity".into()))?;
    let r: AuthorityRevocation = revocation.verify(
        std::slice::from_ref(&id.recovery_key),
        SignContext::AuthorityRevoke,
    )?;
    if r.install_id != id.install_id || (!r.nodes.is_empty() && !r.nodes.contains(&id.node_id)) {
        return Err(RecoverError::Refused(
            "the revocation is addressed to another install or node".into(),
        ));
    }
    j.append(Record::AuthorityRevoked {
        below_term: r.below_term,
        revocation_digest: revocation.payload_digest()?,
        reason: r.reason,
    })?;
    Ok(j.state().revoked_below_term())
}

/// Apply through a running daemon's local socket. Returns its answer.
pub fn apply_via_socket(
    socket: &Path,
    revocation: &SignedEnvelope,
) -> Result<serde_json::Value, RecoverError> {
    let body = serde_json::to_string(revocation)?;
    let mut s = UnixStream::connect(socket).map_err(RecoverError::io(socket))?;
    write!(
        s,
        "POST /authority/revoke HTTP/1.1\r\nHost: otterd\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .map_err(RecoverError::io(socket))?;
    let mut text = String::new();
    s.read_to_string(&mut text)
        .map_err(RecoverError::io(socket))?;
    let (head, body) = text
        .split_once("\r\n\r\n")
        .ok_or_else(|| RecoverError::Refused("malformed answer from the daemon".into()))?;
    let answer: serde_json::Value = serde_json::from_str(body)?;
    if head.starts_with("HTTP/1.1 200") {
        Ok(answer)
    } else {
        Err(RecoverError::Refused(format!(
            "the daemon refused: {answer}"
        )))
    }
}
