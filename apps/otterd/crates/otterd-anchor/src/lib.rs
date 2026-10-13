//! Off-node recovery anchor.
//!
//! The anchor keeps the one fact a restored control-plane database cannot be
//! trusted to know: the current recovery term, and every node ever enrolled.
//! It lives on an operator-controlled S3-compatible object store with
//! conditional writes, outside the database and its backups. Two primitives
//! carry all the safety:
//!
//! * `PUT If-None-Match: *` makes inventory records append-only: a sequence
//!   number can be written once, never replaced;
//! * `PUT If-Match: <etag>` on `head.json` is the compare-and-swap register
//!   that orders enrollment against recovery.
//!
//! Authority is carried by signatures, not by the store credential: every
//! object is an `otterd/anchor/v1` envelope. The term, phase and authorized
//! host live in a [`TermCertificate`] that only the offline recovery key signs;
//! the enrollment key can only advance the inventory sequence under an
//! unchanged certificate. A holder of the store credential alone, or of the
//! enrollment key, cannot forge a term change.
//!
//! Enrollment is append-before-capability: a node's record is committed in the
//! head before its first grant may be issued. A restore advances the term and
//! freezes enrollment in one CAS, then reads the union of all records (committed
//! and pending) as the inventory every old node must be retired from.
//!
//! Layout under `<prefix>/`: `head.json`, `inventory/<seq:010>-<node>.json`,
//! `retirements/<term:06>/<node>.json`.

mod probe;
pub mod s3;

pub use probe::{ProbeReport, probe};

use ed25519_dalek::SigningKey;
use otterd_proto::U53;
use otterd_proto::envelope::{PublicKey, SignContext, SignedEnvelope};
use otterd_proto::identity::HostBinding;
use otterd_proto::ids::{InstallId, KeyId, NodeId, Sha256Hex};
use s3::{Condition, S3, S3Error};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use std::collections::BTreeMap;

/// Attempts at a contended compare-and-swap before giving up.
const MAX_CAS_ATTEMPTS: u32 = 50;

#[derive(Debug, thiserror::Error)]
pub enum AnchorError {
    #[error(transparent)]
    S3(#[from] S3Error),
    #[error("anchor object {key}: {reason}")]
    Invalid { key: String, reason: String },
    #[error("anchor not initialized for install {0}")]
    Uninitialized(InstallId),
    #[error("anchor phase is {0:?}: enrollment is frozen")]
    Frozen(Phase),
    #[error("refused: {0}")]
    Refused(String),
    #[error("gave up after {0} compare-and-swap conflicts")]
    Contended(u32),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Phase {
    /// Normal operation: enrollment may append; the CP may issue for this term.
    Active,
    /// A restore began: the term advanced, enrollment is frozen, issuance is
    /// suspended until every inventory node is retired.
    RecoveryPending,
}

/// Recovery-key-signed term, phase and authorized platform host.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TermCertificate {
    pub install_id: InstallId,
    pub recovery_term: U53,
    pub phase: Phase,
    pub authorized_host: HostBinding,
    pub bootstrap_epoch: U53,
    pub recovery_key: PublicKey,
    pub enrollment_key: PublicKey,
    pub issued_at_unix_ms: U53,
}

/// The CAS register.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Head {
    /// Signed by the recovery key; the only source of term and phase.
    pub term: SignedEnvelope,
    /// Number of committed enrollment records.
    pub inventory_seq: U53,
    /// Hash chain over committed record bytes.
    pub inventory_digest: Option<Sha256Hex>,
    /// Object key of the last committed record; records link backwards.
    pub last_record: Option<String>,
    pub updated_at_unix_ms: U53,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnrollmentRecord {
    pub install_id: InstallId,
    pub seq: U53,
    pub node_id: NodeId,
    pub node_epoch: U53,
    pub identity_key_id: KeyId,
    pub host: HostBinding,
    pub recovery_term: U53,
    pub at_unix_ms: U53,
    /// Key of the committed record this one follows (the head's at write time).
    pub prev_record: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RetirementMethod {
    ProviderPowerOff,
    ManualFence,
    /// The node, still responsive, durably refused the old term and certified
    /// its relevant attempts stopped.
    ResponsiveCertificate,
    Decommissioned,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Retirement {
    pub install_id: InstallId,
    pub recovery_term: U53,
    pub node_id: NodeId,
    pub method: RetirementMethod,
    /// Fence evidence id, certificate digest or ticket.
    pub reference: String,
    pub at_unix_ms: U53,
}

/// Every anchor object, domain-separated by `kind` under one signing context.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum AnchorDocument {
    Term(TermCertificate),
    Head(Head),
    Enrollment(EnrollmentRecord),
    Retirement(Retirement),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "result", rename_all = "kebab-case")]
pub enum EnrollOutcome {
    /// Committed in the head: the CP may now issue this node's first grant.
    Committed { seq: U53 },
    /// Written, but enrollment froze before the head referenced it. It is
    /// pending: it enlarges the recovery inventory and authorizes nothing.
    PendingFrozen { seq: U53, phase: Phase, term: U53 },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryEntry {
    pub key: String,
    pub record: EnrollmentRecord,
    /// Referenced by the head's committed sequence.
    pub committed: bool,
}

/// A verified head with its term and current ETag.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HeadState {
    pub head: Head,
    pub term: TermCertificate,
    pub etag: String,
}

#[derive(Debug, Clone)]
pub struct Anchor {
    s3: S3,
    install: InstallId,
    prefix: String,
    recovery: PublicKey,
    enrollment: PublicKey,
}

fn now_ms() -> U53 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|d| u64::try_from(d.as_millis()).ok())
        .and_then(U53::new)
        .unwrap_or(U53::ZERO)
}

fn chain(prev: Option<&Sha256Hex>, record: &[u8]) -> Sha256Hex {
    let mut h = Sha256::new();
    h.update(prev.map(Sha256Hex::as_str).unwrap_or_default().as_bytes());
    h.update(Sha256::digest(record));
    Sha256Hex::new(hex::encode(h.finalize())).unwrap_or_else(|_| Sha256Hex::digest(record))
}

fn encode(key: &SigningKey, doc: &AnchorDocument) -> Result<Vec<u8>, AnchorError> {
    let env =
        SignedEnvelope::sign(key, SignContext::Anchor, doc).map_err(|e| AnchorError::Invalid {
            key: "(new)".into(),
            reason: e.to_string(),
        })?;
    serde_json::to_vec_pretty(&env).map_err(|e| AnchorError::Invalid {
        key: "(new)".into(),
        reason: e.to_string(),
    })
}

fn decode(
    key: &str,
    bytes: &[u8],
    trusted: &[PublicKey],
) -> Result<(AnchorDocument, KeyId), AnchorError> {
    let bad = |reason: String| AnchorError::Invalid {
        key: key.to_owned(),
        reason,
    };
    let env: SignedEnvelope = serde_json::from_slice(bytes).map_err(|e| bad(e.to_string()))?;
    let doc: AnchorDocument = env
        .verify(trusted, SignContext::Anchor)
        .map_err(|e| bad(e.to_string()))?;
    Ok((doc, env.key_id))
}

fn term_envelope(
    recovery: &SigningKey,
    term: &TermCertificate,
) -> Result<SignedEnvelope, AnchorError> {
    SignedEnvelope::sign(
        recovery,
        SignContext::Anchor,
        &AnchorDocument::Term(term.clone()),
    )
    .map_err(|e| AnchorError::Refused(e.to_string()))
}

/// The record an `enroll` call wrote, reused only while the head it followed
/// is still the current one.
struct Written {
    seq: U53,
    bytes: Vec<u8>,
    term: U53,
    key: String,
    prev: Option<String>,
}

/// Walk the committed records back from the head and verify the hash chain:
/// a deleted or altered committed record is an invalid anchor, never silently
/// a shorter inventory.
fn committed_chain(
    head: &Head,
    records: &BTreeMap<String, (EnrollmentRecord, Vec<u8>)>,
) -> Result<std::collections::BTreeSet<String>, AnchorError> {
    let bad = |reason: String| AnchorError::Invalid {
        key: "head.json".into(),
        reason,
    };
    let mut keys = Vec::new();
    let mut next = head.last_record.clone();
    while let Some(key) = next.take() {
        let (record, _) = records
            .get(&key)
            .ok_or_else(|| bad(format!("committed record {key} is missing")))?;
        next.clone_from(&record.prev_record);
        keys.push(key);
        if keys.len() as u64 > head.inventory_seq.get() {
            return Err(bad("the record chain is longer than the head says".into()));
        }
    }
    keys.reverse();
    if keys.len() as u64 != head.inventory_seq.get() {
        return Err(bad(format!(
            "{} committed records reachable, head says {}",
            keys.len(),
            head.inventory_seq
        )));
    }
    let mut digest: Option<Sha256Hex> = None;
    for (i, key) in keys.iter().enumerate() {
        let (record, bytes) = &records[key];
        if record.seq.get() != i as u64 + 1 {
            return Err(bad(format!("record {key} is out of sequence")));
        }
        digest = Some(chain(digest.as_ref(), bytes));
    }
    if digest != head.inventory_digest {
        return Err(bad(
            "the committed records do not match the head digest".into()
        ));
    }
    Ok(keys.into_iter().collect())
}

impl Anchor {
    /// `prefix` scopes one install inside a bucket (for example `anchors/<install>`).
    #[must_use]
    pub fn new(
        s3: S3,
        install: InstallId,
        prefix: &str,
        recovery: PublicKey,
        enrollment: PublicKey,
    ) -> Self {
        Self {
            s3,
            install,
            prefix: prefix.trim_end_matches('/').to_owned(),
            recovery,
            enrollment,
        }
    }

    fn key(&self, rest: &str) -> String {
        format!("{}/{rest}", self.prefix)
    }

    /// Refuse to sign with a key this anchor does not trust for the role:
    /// readers would reject the object, and a head they cannot verify leaves
    /// the anchor unreadable until it is repaired by hand.
    fn require(signer: &SigningKey, trusted: &PublicKey, role: &str) -> Result<(), AnchorError> {
        if &PublicKey::from_verifying_key(&signer.verifying_key()) == trusted {
            Ok(())
        } else {
            Err(AnchorError::Refused(format!(
                "the key given is not this anchor's {role} key"
            )))
        }
    }

    /// Read and verify the head: outer signature by either key, term
    /// certificate by the recovery key only, both for this install.
    pub async fn head(&self) -> Result<HeadState, AnchorError> {
        let key = self.key("head.json");
        let (bytes, etag) = self
            .s3
            .get(&key)
            .await?
            .ok_or_else(|| AnchorError::Uninitialized(self.install.clone()))?;
        let (doc, _) = decode(
            &key,
            &bytes,
            &[self.recovery.clone(), self.enrollment.clone()],
        )?;
        let AnchorDocument::Head(head) = doc else {
            return Err(AnchorError::Invalid {
                key,
                reason: "not a head".into(),
            });
        };
        let term: TermCertificate = match head
            .term
            .verify(std::slice::from_ref(&self.recovery), SignContext::Anchor)
        {
            Ok(AnchorDocument::Term(t)) => t,
            Ok(_) => {
                return Err(AnchorError::Invalid {
                    key,
                    reason: "term is not a term certificate".into(),
                });
            }
            Err(e) => {
                return Err(AnchorError::Invalid {
                    key,
                    reason: format!("term certificate: {e}"),
                });
            }
        };
        if term.install_id != self.install
            || term.recovery_key != self.recovery
            || term.enrollment_key != self.enrollment
        {
            return Err(AnchorError::Invalid {
                key,
                reason: "term certificate names another install or keys".into(),
            });
        }
        Ok(HeadState { head, term, etag })
    }

    /// Create the anchor (recovery key). Refuses if a head exists.
    pub async fn init(
        &self,
        recovery: &SigningKey,
        host: HostBinding,
        bootstrap_epoch: U53,
    ) -> Result<HeadState, AnchorError> {
        Self::require(recovery, &self.recovery, "recovery")?;
        let term = TermCertificate {
            install_id: self.install.clone(),
            recovery_term: U53::ONE,
            phase: Phase::Active,
            authorized_host: host,
            bootstrap_epoch,
            recovery_key: self.recovery.clone(),
            enrollment_key: self.enrollment.clone(),
            issued_at_unix_ms: now_ms(),
        };
        let head = Head {
            term: term_envelope(recovery, &term)?,
            inventory_seq: U53::ZERO,
            inventory_digest: None,
            last_record: None,
            updated_at_unix_ms: now_ms(),
        };
        let etag = self
            .s3
            .put_resolving(
                &self.key("head.json"),
                encode(recovery, &AnchorDocument::Head(head.clone()))?,
                Condition::IfNoneMatch,
            )
            .await?;
        Ok(HeadState { head, term, etag })
    }

    /// Append-before-capability enrollment: write the immutable record at the
    /// next sequence (create-only), then CAS the head to reference it. Only
    /// `Committed` lets the CP issue the node's first grant.
    pub async fn enroll(
        &self,
        enrollment: &SigningKey,
        mut record: EnrollmentRecord,
    ) -> Result<EnrollOutcome, AnchorError> {
        Self::require(enrollment, &self.enrollment, "enrollment")?;
        let mut written: Option<Written> = None;
        for _ in 0..MAX_CAS_ATTEMPTS {
            let state = self.head().await?;
            let term_moved = written
                .as_ref()
                .is_some_and(|w| w.term != state.term.recovery_term);
            if state.term.phase != Phase::Active || term_moved {
                return match written {
                    Some(Written { seq, .. }) => Ok(EnrollOutcome::PendingFrozen {
                        seq,
                        phase: state.term.phase,
                        term: state.term.recovery_term,
                    }),
                    None => Err(AnchorError::Frozen(state.term.phase)),
                };
            }
            // An ambiguous head write of ours may have applied and then been
            // built on by another enrollment: then our record is committed.
            if let Some(w) = &written
                && state.head.inventory_seq > w.seq
                && self.chain_reaches(&state.head, &w.key, w.seq).await?
            {
                return Ok(EnrollOutcome::Committed { seq: w.seq });
            }
            let seq = state
                .head
                .inventory_seq
                .next()
                .ok_or_else(|| AnchorError::Refused("inventory full".into()))?;
            let (bytes, record_key) = match &written {
                Some(w) if w.seq == seq && w.prev == state.head.last_record => {
                    (w.bytes.clone(), w.key.clone())
                }
                _ => {
                    // Fresh, or our earlier record was passed by a concurrent
                    // enrollment: it stays as a pending record, write another.
                    record.seq = seq;
                    record.recovery_term = state.term.recovery_term;
                    record.install_id = self.install.clone();
                    record.at_unix_ms = now_ms();
                    record.prev_record.clone_from(&state.head.last_record);
                    let bytes = encode(enrollment, &AnchorDocument::Enrollment(record.clone()))?;
                    let key = self.key(&format!(
                        "inventory/{:010}-{}.json",
                        seq.get(),
                        record.node_id
                    ));
                    match self
                        .s3
                        .put_resolving(&key, bytes.clone(), Condition::IfNoneMatch)
                        .await
                    {
                        Ok(_) => {}
                        Err(S3Error::PreconditionFailed | S3Error::Conflict) => continue,
                        Err(e) => return Err(e.into()),
                    }
                    written = Some(Written {
                        seq,
                        bytes: bytes.clone(),
                        term: state.term.recovery_term,
                        key: key.clone(),
                        prev: state.head.last_record.clone(),
                    });
                    (bytes, key)
                }
            };
            let next = Head {
                term: state.head.term.clone(),
                inventory_seq: seq,
                inventory_digest: Some(chain(state.head.inventory_digest.as_ref(), &bytes)),
                last_record: Some(record_key),
                updated_at_unix_ms: now_ms(),
            };
            match self
                .s3
                .put_resolving(
                    &self.key("head.json"),
                    encode(enrollment, &AnchorDocument::Head(next))?,
                    Condition::IfMatch(state.etag),
                )
                .await
            {
                Ok(_) => return Ok(EnrollOutcome::Committed { seq }),
                Err(S3Error::PreconditionFailed | S3Error::Conflict) => {}
                Err(e) => return Err(e.into()),
            }
        }
        Err(AnchorError::Contended(MAX_CAS_ATTEMPTS))
    }

    /// Whether the committed chain from `head` passes through the record at
    /// `key` (sequence `seq`). Reads back only the records above it.
    async fn chain_reaches(&self, head: &Head, key: &str, seq: U53) -> Result<bool, AnchorError> {
        let mut cursor = head.last_record.clone();
        while let Some(k) = cursor {
            if k == key {
                return Ok(true);
            }
            let Some((bytes, _)) = self.s3.get(&k).await? else {
                return Ok(false);
            };
            let (doc, _) = decode(&k, &bytes, std::slice::from_ref(&self.enrollment))?;
            let AnchorDocument::Enrollment(record) = doc else {
                return Err(AnchorError::Invalid {
                    key: k,
                    reason: "not an enrollment record".into(),
                });
            };
            if record.seq <= seq {
                return Ok(false);
            }
            cursor = record.prev_record;
        }
        Ok(false)
    }

    /// Every enrollment record ever written, committed or pending. Recovery
    /// fences the union: a backup that predates an enrollment cannot hide it.
    pub async fn inventory(&self) -> Result<Vec<InventoryEntry>, AnchorError> {
        let state = self.head().await?;
        let mut records: BTreeMap<String, (EnrollmentRecord, Vec<u8>)> = BTreeMap::new();
        for key in self.s3.list(&self.key("inventory/")).await? {
            let Some((bytes, _)) = self.s3.get(&key).await? else {
                continue;
            };
            let (doc, _) = decode(&key, &bytes, std::slice::from_ref(&self.enrollment))?;
            let AnchorDocument::Enrollment(record) = doc else {
                return Err(AnchorError::Invalid {
                    key,
                    reason: "not an enrollment record".into(),
                });
            };
            if record.install_id != self.install {
                return Err(AnchorError::Invalid {
                    key,
                    reason: "record names another install".into(),
                });
            }
            records.insert(key, (record, bytes));
        }
        let committed = committed_chain(&state.head, &records)?;
        Ok(records
            .into_iter()
            .map(|(key, (record, _))| InventoryEntry {
                committed: committed.contains(&key),
                key,
                record,
            })
            .collect())
    }

    /// Recovery key: advance the term, bind the new platform host and freeze
    /// enrollment in one CAS. Never resets a term.
    pub async fn begin_recovery(
        &self,
        recovery: &SigningKey,
        new_host: HostBinding,
    ) -> Result<TermCertificate, AnchorError> {
        Self::require(recovery, &self.recovery, "recovery")?;
        for _ in 0..MAX_CAS_ATTEMPTS {
            let state = self.head().await?;
            let term = TermCertificate {
                recovery_term: state
                    .term
                    .recovery_term
                    .next()
                    .ok_or_else(|| AnchorError::Refused("term exhausted".into()))?,
                phase: Phase::RecoveryPending,
                authorized_host: new_host.clone(),
                bootstrap_epoch: state.term.bootstrap_epoch.saturating_add(1),
                issued_at_unix_ms: now_ms(),
                ..state.term
            };
            let next = Head {
                term: term_envelope(recovery, &term)?,
                updated_at_unix_ms: now_ms(),
                ..state.head
            };
            match self
                .s3
                .put_resolving(
                    &self.key("head.json"),
                    encode(recovery, &AnchorDocument::Head(next))?,
                    Condition::IfMatch(state.etag),
                )
                .await
            {
                Ok(_) => return Ok(term),
                Err(S3Error::PreconditionFailed | S3Error::Conflict) => {}
                Err(e) => return Err(e.into()),
            }
        }
        Err(AnchorError::Contended(MAX_CAS_ATTEMPTS))
    }

    /// Record that `node` no longer holds any old-term authority.
    pub async fn record_retirement(
        &self,
        recovery: &SigningKey,
        node: &NodeId,
        method: RetirementMethod,
        reference: &str,
    ) -> Result<(), AnchorError> {
        Self::require(recovery, &self.recovery, "recovery")?;
        let state = self.head().await?;
        if state.term.phase != Phase::RecoveryPending {
            return Err(AnchorError::Refused("no recovery in progress".into()));
        }
        let r = Retirement {
            install_id: self.install.clone(),
            recovery_term: state.term.recovery_term,
            node_id: node.clone(),
            method,
            reference: reference.to_owned(),
            at_unix_ms: now_ms(),
        };
        let key = self.key(&format!(
            "retirements/{:06}/{node}.json",
            state.term.recovery_term.get()
        ));
        self.s3
            .put_resolving(
                &key,
                encode(recovery, &AnchorDocument::Retirement(r))?,
                Condition::IfNoneMatch,
            )
            .await?;
        Ok(())
    }

    /// Nodes of the inventory union without a retirement for the current term.
    pub async fn outstanding(
        &self,
    ) -> Result<
        (
            TermCertificate,
            Vec<NodeId>,
            BTreeMap<NodeId, RetirementMethod>,
        ),
        AnchorError,
    > {
        let state = self.head().await?;
        let nodes: std::collections::BTreeSet<NodeId> = self
            .inventory()
            .await?
            .into_iter()
            .map(|e| e.record.node_id)
            .collect();
        let mut retired = BTreeMap::new();
        let prefix = self.key(&format!(
            "retirements/{:06}/",
            state.term.recovery_term.get()
        ));
        for key in self.s3.list(&prefix).await? {
            let Some((bytes, _)) = self.s3.get(&key).await? else {
                continue;
            };
            let (doc, _) = decode(&key, &bytes, std::slice::from_ref(&self.recovery))?;
            if let AnchorDocument::Retirement(r) = doc
                && r.recovery_term == state.term.recovery_term
                && r.install_id == self.install
            {
                retired.insert(r.node_id, r.method);
            }
        }
        let missing = nodes
            .into_iter()
            .filter(|n| !retired.contains_key(n))
            .collect();
        Ok((state.term, missing, retired))
    }

    /// Recovery key: finish only when every inventory node is retired.
    pub async fn complete_recovery(
        &self,
        recovery: &SigningKey,
    ) -> Result<TermCertificate, AnchorError> {
        Self::require(recovery, &self.recovery, "recovery")?;
        let (term, missing, _) = self.outstanding().await?;
        if term.phase != Phase::RecoveryPending {
            return Err(AnchorError::Refused("no recovery in progress".into()));
        }
        if !missing.is_empty() {
            let list: Vec<String> = missing.iter().map(ToString::to_string).collect();
            return Err(AnchorError::Refused(format!(
                "not retired for term {}: {}",
                term.recovery_term,
                list.join(", ")
            )));
        }
        let state = self.head().await?;
        let term = TermCertificate {
            phase: Phase::Active,
            issued_at_unix_ms: now_ms(),
            ..state.term
        };
        let next = Head {
            term: term_envelope(recovery, &term)?,
            updated_at_unix_ms: now_ms(),
            ..state.head
        };
        self.s3
            .put_resolving(
                &self.key("head.json"),
                encode(recovery, &AnchorDocument::Head(next))?,
                Condition::IfMatch(state.etag),
            )
            .await?;
        Ok(term)
    }

    /// CP issuance gate: issue only under an active anchor at exactly this term.
    pub async fn may_issue(&self, cp_term: U53) -> Result<(), AnchorError> {
        let state = self.head().await?;
        if state.term.phase != Phase::Active {
            return Err(AnchorError::Frozen(state.term.phase));
        }
        if state.term.recovery_term != cp_term {
            return Err(AnchorError::Refused(format!(
                "control plane term {cp_term} != anchor term {}",
                state.term.recovery_term
            )));
        }
        Ok(())
    }

    #[must_use]
    pub fn s3(&self) -> &S3 {
        &self.s3
    }

    #[must_use]
    pub fn prefix(&self) -> &str {
        &self.prefix
    }
}
