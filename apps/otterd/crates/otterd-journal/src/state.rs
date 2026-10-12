//! The fold of all journal records.
//!
//! [`NodeState::check`] enforces the transition rules of MODEL §2, so an illegal
//! sequence can never be written, and a replayed log that violates them is
//! corruption (journal loss), never something to repair silently. Rules that
//! depend on the *current* process (a grant must be issued for this
//! incarnation) are append-time policy in [`NodeState::check_live`]; replay and
//! compaction do not re-apply them to history.

use otterd_proto::U53;
use otterd_proto::capability::Verb;
use otterd_proto::command::OpOutcome;
use otterd_proto::envelope::{PublicKey, SignedEnvelope};
use otterd_proto::identity::{HostBinding, TrustedKey};
use otterd_proto::ids::{
    AttemptId, BootId, ContainerRef, GrantId, HoldId, Incarnation, InstallId, KeyId, MutationId,
    NodeId, OpId, ResourceId, SessionId, Sha256Hex, SlotRef, UpdateId,
};
use otterd_proto::journal::{
    AttemptReason, BackingIdentity, EngineOutcome, Entry, HighWaterKind, HoldRecord,
    MutationRecord, Record, Retirement, UpdatePhase, WorkloadClass,
};
use otterd_proto::lifecycle::{SlotGrant, StopCertificate};
use otterd_proto::version::JOURNAL_FORMAT;
use serde::Serialize;
use sha2::{Digest as _, Sha256};
use std::collections::{BTreeMap, BTreeSet};

/// Why a record was refused.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum TransitionError {
    #[error("the first record of a journal must be `format`, and only the first")]
    FormatPlacement,
    #[error("journal format {0} is not supported by this build")]
    UnsupportedFormat(u16),
    #[error("`compacted` may only follow `format` at the start of a file")]
    CompactedPlacement,
    #[error("no node identity: the journal has no trusted ownership inventory")]
    NoIdentity,
    #[error(
        "identity change must keep install and node and raise the epoch (have {have}, got {got})"
    )]
    BadIdentity { have: U53, got: U53 },
    #[error(
        "re-enrollment refused while start-capable submission {0} is unresolved; settle or retire it first"
    )]
    UnresolvedBeforeReenroll(MutationId),
    #[error("key epoch must rise (have {have}, got {got})")]
    KeyEpochNotRaised { have: U53, got: U53 },
    #[error("no process start recorded")]
    NoProcess,
    #[error("grant {grant} was issued for incarnation {got}, this process is {have}")]
    StaleIncarnation {
        grant: GrantId,
        have: Incarnation,
        got: Incarnation,
    },
    #[error("grant {0} already recorded")]
    DuplicateGrant(GrantId),
    #[error("grant {grant} is for node epoch {got}, node is at {have}")]
    WrongEpoch { grant: GrantId, have: U53, got: U53 },
    #[error("grant {grant} term {term} is below the revoked high-water {below}")]
    RevokedTerm {
        grant: GrantId,
        term: U53,
        below: U53,
    },
    #[error("grant {grant} generation {got} is not above slot {slot} high-water {have}")]
    StaleGeneration {
        grant: GrantId,
        slot: SlotRef,
        have: U53,
        got: U53,
    },
    #[error("exclusive slot {slot} still has unreleased grant {holder}")]
    ExclusiveHeld { slot: SlotRef, holder: GrantId },
    #[error("unknown grant {0}")]
    UnknownGrant(GrantId),
    #[error("grant {0} is revoked or superseded; nothing may start under it")]
    GrantRevoked(GrantId),
    #[error("attempt {0} already recorded")]
    DuplicateAttempt(AttemptId),
    #[error("attempt ordinal under grant {grant} must be {want}, got {got}")]
    AttemptOrdinal { grant: GrantId, want: u32, got: u32 },
    #[error("attempt {attempt} does not belong to grant {grant}")]
    UnknownAttempt { grant: GrantId, attempt: AttemptId },
    #[error("mutation {0} already recorded")]
    DuplicateMutation(MutationId),
    #[error("unknown mutation {0}")]
    UnknownMutation(MutationId),
    #[error("{class:?} mutation {id} lacks its binding")]
    UnboundMutation {
        id: MutationId,
        class: WorkloadClass,
    },
    #[error("mutation {id}: illegal transition from {from} to {to}")]
    IllegalSubmission {
        id: MutationId,
        from: &'static str,
        to: &'static str,
    },
    #[error("op {0} already claimed")]
    DuplicateOp(OpId),
    #[error("op {0} already claimed with a different payload")]
    OpConflict(OpId),
    #[error("unknown op {0}")]
    UnknownOp(OpId),
    #[error("op {0} already has a terminal outcome")]
    OpCompleted(OpId),
    #[error("op {0}: `accepted` is not a terminal outcome")]
    OpNotTerminal(OpId),
    #[error("certificate for grant {grant}: {reason}")]
    BadCertificate { grant: GrantId, reason: String },
    #[error("hold {0} already recorded")]
    DuplicateHold(HoldId),
    #[error("hold {id}: illegal transition from {from} to {to}")]
    IllegalHold {
        id: HoldId,
        from: &'static str,
        to: &'static str,
    },
    #[error("unknown hold {0}")]
    UnknownHold(HoldId),
    #[error("update {id}: illegal phase transition {from:?} -> {to:?}")]
    IllegalUpdate {
        id: UpdateId,
        from: Option<UpdatePhase>,
        to: UpdatePhase,
    },
    #[error("high-water {kind:?}/{scope} would go backwards ({have} -> {got})")]
    HighWaterDecrease {
        kind: HighWaterKind,
        scope: String,
        have: U53,
        got: U53,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityState {
    pub install_id: InstallId,
    pub node_id: NodeId,
    pub node_epoch: U53,
    pub key_epoch: U53,
    pub identity_key_id: KeyId,
    pub cp_keys: Vec<TrustedKey>,
    pub recovery_key: PublicKey,
    pub host: HostBinding,
}

/// Runtime submission state of one Engine mutation (MODEL §2.2.1).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum Submission {
    NotSubmitted,
    #[serde(rename_all = "camelCase")]
    Submitted {
        boot_id: BootId,
        incarnation: Incarnation,
        engine_incarnation: String,
    },
    Settled {
        outcome: EngineOutcome,
    },
    Retired {
        retirement: Retirement,
    },
}

impl Submission {
    #[must_use]
    pub fn name(&self) -> &'static str {
        match self {
            Self::NotSubmitted => "not-submitted",
            Self::Submitted { .. } => "submitted",
            Self::Settled { .. } => "settled",
            Self::Retired { .. } => "retired",
        }
    }

    /// Terminal: the request can never take effect later.
    #[must_use]
    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Settled { .. } | Self::Retired { .. })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationState {
    pub record: MutationRecord,
    pub submission: Submission,
    /// Kept after settlement so the history can be rewritten faithfully.
    pub submitted: Option<SubmittedInfo>,
    /// Journal sequence of the intent: chronological order across mutations.
    pub intent_seq: U53,
}

/// What `mutationSubmitted` recorded.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmittedInfo {
    pub boot_id: BootId,
    pub incarnation: Incarnation,
    pub engine_incarnation: String,
}

impl MutationState {
    /// The container this mutation created or acted upon, if known.
    #[must_use]
    pub fn container(&self) -> Option<&ContainerRef> {
        match &self.submission {
            Submission::Settled {
                outcome: EngineOutcome::Created { container },
            } => Some(container),
            _ => self.record.container.as_ref(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptState {
    pub grant_id: GrantId,
    pub ordinal: u32,
    pub reason: AttemptReason,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantState {
    pub grant: SlotGrant,
    pub spec_digest: Sha256Hex,
    pub op_id: OpId,
    pub revoked: Option<String>,
    pub certificate: Option<SignedEnvelope>,
    /// Set when a newer node epoch superseded this grant's epoch (re-enrollment).
    pub superseded_by_epoch: Option<U53>,
    /// Attempts in ordinal order.
    pub attempts: Vec<AttemptId>,
}

impl GrantState {
    /// Released: start authority revoked **and** positive stop certified, or the
    /// whole node epoch superseded by a re-enrollment (MODEL §2.4).
    #[must_use]
    pub fn is_released(&self) -> bool {
        (self.revoked.is_some() && self.certificate.is_some()) || self.superseded_by_epoch.is_some()
    }

    /// Nothing may start under this grant any more.
    #[must_use]
    pub fn start_revoked(&self) -> bool {
        self.revoked.is_some() || self.superseded_by_epoch.is_some()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpState {
    pub verb: Verb,
    pub payload_hash: Sha256Hex,
    pub capability_digest: Sha256Hex,
    pub session_id: SessionId,
    pub operation_epoch: U53,
    pub resource_id: Option<ResourceId>,
    pub claimed_at_unix_ms: U53,
    pub outcome: Option<OpOutcome>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "phase", rename_all = "kebab-case")]
pub enum HoldPhase {
    Intent,
    #[serde(rename_all = "camelCase")]
    Staged {
        backing: BackingIdentity,
        staging_mnt_id: U53,
    },
    Unknown {
        reason: String,
    },
    Released {
        reason: String,
    },
}

impl HoldPhase {
    #[must_use]
    pub fn name(&self) -> &'static str {
        match self {
            Self::Intent => "intent",
            Self::Staged { .. } => "staged",
            Self::Unknown { .. } => "unknown",
            Self::Released { .. } => "released",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HoldState {
    pub record: HoldRecord,
    pub phase: HoldPhase,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveManifest {
    pub manifest_digest: Sha256Hex,
    pub manifest_revision: U53,
    pub bootstrap_epoch: U53,
    pub authority_term: U53,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    pub update_id: UpdateId,
    pub phase: UpdatePhase,
    pub from_manifest_digest: Sha256Hex,
    pub to_manifest_digest: Sha256Hex,
    /// Once the schema boundary is crossed, only recover-forward or DR remain.
    pub irreversible: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Revocation {
    pub below_term: U53,
    pub revocation_digest: Sha256Hex,
    pub reason: String,
}

/// Why a slot may not get a new attempt right now.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Blocker {
    /// A create/start/restart crossed the Engine boundary without a terminal outcome.
    #[serde(rename_all = "camelCase")]
    UnresolvedSubmission {
        mutation_id: MutationId,
        object_name: String,
    },
    /// An exclusive grant that is neither revoked+certified nor superseded.
    #[serde(rename_all = "camelCase")]
    UnreleasedGrant { grant_id: GrantId },
    /// A retained mount hold whose state is unknown keeps its data claim.
    #[serde(rename_all = "camelCase")]
    UnknownHold { hold_id: HoldId },
}

/// Key of a high-water mark.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
pub struct HighWaterKey {
    pub kind: HighWaterKind,
    pub scope: String,
}

impl HighWaterKey {
    #[must_use]
    pub fn new(kind: HighWaterKind, scope: impl Into<String>) -> Self {
        Self {
            kind,
            scope: scope.into(),
        }
    }

    #[must_use]
    pub fn slot_generation(slot: &SlotRef) -> Self {
        Self::new(HighWaterKind::SlotGeneration, slot.to_string())
    }
}

/// The folded journal.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeState {
    pub format: Option<u16>,
    pub identity: Option<IdentityState>,
    pub incarnation: Option<Incarnation>,
    pub boot_id: Option<BootId>,
    pub revocation: Option<Revocation>,
    pub grants: BTreeMap<GrantId, GrantState>,
    pub attempts: BTreeMap<AttemptId, AttemptState>,
    pub mutations: BTreeMap<MutationId, MutationState>,
    pub ops: BTreeMap<OpId, OpState>,
    pub holds: BTreeMap<HoldId, HoldState>,
    #[serde(serialize_with = "serialize_high_water")]
    pub high_water: BTreeMap<HighWaterKey, U53>,
    /// Slots cleared from boot quarantine in the current incarnation only.
    pub cleared: BTreeSet<SlotRef>,
    pub manifest: Option<ActiveManifest>,
    pub update: Option<UpdateState>,
    /// Sequence of the last applied entry.
    pub last_seq: U53,
    /// Entries applied since the file began (for compaction triggers).
    pub entries_in_file: u64,
}

fn serialize_high_water<S: serde::Serializer>(
    map: &BTreeMap<HighWaterKey, U53>,
    s: S,
) -> Result<S::Ok, S::Error> {
    use serde::ser::SerializeSeq as _;
    let mut seq = s.serialize_seq(Some(map.len()))?;
    for (k, v) in map {
        seq.serialize_element(&(k, v))?;
    }
    seq.end()
}

fn illegal(id: &MutationId, from: &Submission, to: &'static str) -> TransitionError {
    TransitionError::IllegalSubmission {
        id: id.clone(),
        from: from.name(),
        to,
    }
}

fn illegal_hold(id: &HoldId, from: &HoldPhase, to: &'static str) -> TransitionError {
    TransitionError::IllegalHold {
        id: id.clone(),
        from: from.name(),
        to,
    }
}

impl NodeState {
    /// Apply one entry: validate, then fold. The state is unchanged on error.
    pub fn apply(&mut self, entry: &Entry) -> Result<(), TransitionError> {
        self.check(&entry.record)?;
        self.commit(&entry.record, entry.seq, entry.at_unix_ms);
        self.last_seq = entry.seq;
        self.entries_in_file += 1;
        Ok(())
    }

    /// Append-time policy on top of [`Self::check`]: rules about the *current*
    /// process that do not hold for history (a grant must be for this
    /// incarnation; quarantine is cleared only by a grant of this incarnation).
    pub fn check_live(&self, record: &Record) -> Result<(), TransitionError> {
        let grant_incarnation = match record {
            Record::GrantAccepted { grant, .. } => Some((&grant.grant_id, &grant.incarnation)),
            Record::QuarantineCleared {
                grant_id,
                incarnation,
                ..
            } => self
                .grants
                .get(grant_id)
                .map(|g| (grant_id, &g.grant.incarnation))
                .or(Some((grant_id, incarnation))),
            _ => None,
        };
        if let Some((grant, got)) = grant_incarnation {
            let have = self
                .incarnation
                .as_ref()
                .ok_or(TransitionError::NoProcess)?;
            if got != have {
                return Err(TransitionError::StaleIncarnation {
                    grant: grant.clone(),
                    have: have.clone(),
                    got: got.clone(),
                });
            }
        }
        if let Record::QuarantineCleared {
            incarnation,
            grant_id,
            ..
        } = record
        {
            let have = self
                .incarnation
                .as_ref()
                .ok_or(TransitionError::NoProcess)?;
            if incarnation != have {
                return Err(TransitionError::StaleIncarnation {
                    grant: grant_id.clone(),
                    have: have.clone(),
                    got: incarnation.clone(),
                });
            }
        }
        self.check(record)
    }

    /// Validate a record against the current state without changing it.
    #[allow(clippy::too_many_lines)] // one arm per record kind reads best as one match
    pub fn check(&self, record: &Record) -> Result<(), TransitionError> {
        if self.format.is_none() && !matches!(record, Record::Format { .. }) {
            return Err(TransitionError::FormatPlacement);
        }
        match record {
            Record::Format { journal_format, .. } => {
                if self.format.is_some() {
                    return Err(TransitionError::FormatPlacement);
                }
                if *journal_format != JOURNAL_FORMAT {
                    return Err(TransitionError::UnsupportedFormat(*journal_format));
                }
                Ok(())
            }
            Record::Compacted { .. } => {
                if self.entries_in_file == 1 {
                    Ok(())
                } else {
                    Err(TransitionError::CompactedPlacement)
                }
            }
            Record::Identity {
                install_id,
                node_id,
                node_epoch,
                ..
            } => self.check_identity(install_id, node_id, *node_epoch),
            Record::KeysRotated { key_epoch, .. } => {
                let id = self.identity.as_ref().ok_or(TransitionError::NoIdentity)?;
                if *key_epoch > id.key_epoch {
                    Ok(())
                } else {
                    Err(TransitionError::KeyEpochNotRaised {
                        have: id.key_epoch,
                        got: *key_epoch,
                    })
                }
            }
            Record::CpKeysChanged { .. } => self
                .identity
                .as_ref()
                .map(|_| ())
                .ok_or(TransitionError::NoIdentity),
            Record::ProcessStarted { .. }
            | Record::AuthorityRevoked { .. }
            | Record::ManifestActivated { .. } => Ok(()),
            Record::OpClaimed {
                op_id,
                payload_hash,
                ..
            } => match self.ops.get(op_id) {
                Some(op) if &op.payload_hash != payload_hash => {
                    Err(TransitionError::OpConflict(op_id.clone()))
                }
                Some(_) => Err(TransitionError::DuplicateOp(op_id.clone())),
                None => Ok(()),
            },
            Record::OpCompleted { op_id, outcome } => {
                let op = self
                    .ops
                    .get(op_id)
                    .ok_or_else(|| TransitionError::UnknownOp(op_id.clone()))?;
                if op.outcome.is_some() {
                    Err(TransitionError::OpCompleted(op_id.clone()))
                } else if !outcome.is_terminal() {
                    Err(TransitionError::OpNotTerminal(op_id.clone()))
                } else {
                    Ok(())
                }
            }
            Record::GrantAccepted { grant, .. } => self.check_grant(grant),
            Record::GrantRevoked { grant_id, .. } => self.grant(grant_id).map(|_| ()),
            Record::AttemptBegun {
                grant_id,
                attempt_id,
                ordinal,
                ..
            } => self.check_attempt(grant_id, attempt_id, *ordinal),
            Record::MutationIntent { mutation } => self.check_intent(mutation),
            Record::MutationSubmitted { .. }
            | Record::MutationSettled { .. }
            | Record::MutationRetired { .. } => self.check_submission(record),
            Record::StopCertified {
                grant_id,
                certificate,
            } => self.check_certificate(grant_id, certificate),
            Record::QuarantineCleared { grant_id, slot, .. } => {
                let g = self.grant(grant_id)?;
                if g.start_revoked() {
                    return Err(TransitionError::GrantRevoked(grant_id.clone()));
                }
                if &g.grant.slot != slot {
                    return Err(TransitionError::UnknownGrant(grant_id.clone()));
                }
                Ok(())
            }
            Record::HoldIntent { .. }
            | Record::HoldStaged { .. }
            | Record::HoldUnknown { .. }
            | Record::HoldReleased { .. } => self.check_hold(record),
            Record::UpdatePhaseEntered {
                update_id, phase, ..
            } => self.check_update(update_id, *phase),
            Record::HighWater { kind, scope, value } => {
                let key = HighWaterKey::new(*kind, scope.clone());
                match self.high_water.get(&key) {
                    Some(have) if value < have => Err(TransitionError::HighWaterDecrease {
                        kind: *kind,
                        scope: scope.clone(),
                        have: *have,
                        got: *value,
                    }),
                    _ => Ok(()),
                }
            }
        }
    }

    fn check_submission(&self, record: &Record) -> Result<(), TransitionError> {
        match record {
            Record::MutationSubmitted { mutation_id, .. } => {
                let m = self.mutation(mutation_id)?;
                if !matches!(m.submission, Submission::NotSubmitted) {
                    return Err(illegal(mutation_id, &m.submission, "submitted"));
                }
                // Revocation retires unsubmitted starts; it never lets one cross later.
                if m.record.verb.can_start_process()
                    && let Some(grant_id) = &m.record.grant_id
                    && self.grant(grant_id)?.start_revoked()
                {
                    return Err(TransitionError::GrantRevoked(grant_id.clone()));
                }
                Ok(())
            }
            Record::MutationSettled { mutation_id, .. } => {
                let m = self.mutation(mutation_id)?;
                match m.submission {
                    Submission::Submitted { .. } => Ok(()),
                    ref s => Err(illegal(mutation_id, s, "settled")),
                }
            }
            Record::MutationRetired {
                mutation_id,
                retirement,
            } => {
                let m = self.mutation(mutation_id)?;
                match (&m.submission, retirement) {
                    // Only a request that never crossed the boundary retires as not-submitted.
                    (Submission::Submitted { .. }, Retirement::NotSubmitted) => {
                        Err(illegal(mutation_id, &m.submission, "retired-not-submitted"))
                    }
                    (Submission::NotSubmitted | Submission::Submitted { .. }, _) => Ok(()),
                    (s, _) => Err(illegal(mutation_id, s, "retired")),
                }
            }
            _ => Ok(()),
        }
    }

    fn check_hold(&self, record: &Record) -> Result<(), TransitionError> {
        match record {
            Record::HoldIntent { hold } => {
                if self.holds.contains_key(&hold.hold_id) {
                    Err(TransitionError::DuplicateHold(hold.hold_id.clone()))
                } else {
                    Ok(())
                }
            }
            Record::HoldStaged { hold_id, .. } => match &self.hold(hold_id)?.phase {
                HoldPhase::Intent => Ok(()),
                p => Err(illegal_hold(hold_id, p, "staged")),
            },
            Record::HoldUnknown { hold_id, .. } => match &self.hold(hold_id)?.phase {
                HoldPhase::Intent | HoldPhase::Staged { .. } => Ok(()),
                p => Err(illegal_hold(hold_id, p, "unknown")),
            },
            Record::HoldReleased { hold_id, .. } => match &self.hold(hold_id)?.phase {
                p @ HoldPhase::Released { .. } => Err(illegal_hold(hold_id, p, "released")),
                _ => Ok(()),
            },
            _ => Ok(()),
        }
    }

    fn check_identity(
        &self,
        install_id: &InstallId,
        node_id: &NodeId,
        node_epoch: U53,
    ) -> Result<(), TransitionError> {
        match &self.identity {
            None => Ok(()),
            Some(id)
                if &id.install_id == install_id
                    && &id.node_id == node_id
                    && node_epoch > id.node_epoch =>
            {
                // A new epoch supersedes every old grant; old Engine work must be
                // settled or retired by a barrier first (MODEL §2.4, §6.5).
                match self.unresolved_submissions().next() {
                    Some(m) => Err(TransitionError::UnresolvedBeforeReenroll(
                        m.record.mutation_id.clone(),
                    )),
                    None => Ok(()),
                }
            }
            Some(id) => Err(TransitionError::BadIdentity {
                have: id.node_epoch,
                got: node_epoch,
            }),
        }
    }

    fn check_grant(&self, grant: &SlotGrant) -> Result<(), TransitionError> {
        let identity = self.identity.as_ref().ok_or(TransitionError::NoIdentity)?;
        if self.grants.contains_key(&grant.grant_id) {
            return Err(TransitionError::DuplicateGrant(grant.grant_id.clone()));
        }
        if grant.node_epoch != identity.node_epoch {
            return Err(TransitionError::WrongEpoch {
                grant: grant.grant_id.clone(),
                have: identity.node_epoch,
                got: grant.node_epoch,
            });
        }
        let below = self.revoked_below_term();
        if grant.authority_term < below {
            return Err(TransitionError::RevokedTerm {
                grant: grant.grant_id.clone(),
                term: grant.authority_term,
                below,
            });
        }
        let have = self.generation_high_water(&grant.slot);
        if grant.generation <= have {
            return Err(TransitionError::StaleGeneration {
                grant: grant.grant_id.clone(),
                slot: grant.slot.clone(),
                have,
                got: grant.generation,
            });
        }
        // I1: an exclusive slot admits one non-released grant, and an exclusive
        // grant cannot join a slot that still holds a non-exclusive one either.
        if let Some(holder) = self.grants.values().find(|g| {
            g.grant.slot == grant.slot && !g.is_released() && (grant.exclusive || g.grant.exclusive)
        }) {
            return Err(TransitionError::ExclusiveHeld {
                slot: grant.slot.clone(),
                holder: holder.grant.grant_id.clone(),
            });
        }
        Ok(())
    }

    fn check_attempt(
        &self,
        grant_id: &GrantId,
        attempt_id: &AttemptId,
        ordinal: u32,
    ) -> Result<(), TransitionError> {
        let g = self.grant(grant_id)?;
        if g.start_revoked() {
            return Err(TransitionError::GrantRevoked(grant_id.clone()));
        }
        if self.attempts.contains_key(attempt_id) {
            return Err(TransitionError::DuplicateAttempt(attempt_id.clone()));
        }
        let want = u32::try_from(g.attempts.len())
            .unwrap_or(u32::MAX)
            .saturating_add(1);
        if ordinal != want {
            return Err(TransitionError::AttemptOrdinal {
                grant: grant_id.clone(),
                want,
                got: ordinal,
            });
        }
        Ok(())
    }

    fn check_intent(&self, m: &MutationRecord) -> Result<(), TransitionError> {
        if self.mutations.contains_key(&m.mutation_id) {
            return Err(TransitionError::DuplicateMutation(m.mutation_id.clone()));
        }
        let unbound = || TransitionError::UnboundMutation {
            id: m.mutation_id.clone(),
            class: m.class,
        };
        match m.class {
            WorkloadClass::Tenant | WorkloadClass::System => {
                let grant_id = m.grant_id.as_ref().ok_or_else(unbound)?;
                let g = self.grant(grant_id)?;
                if g.grant.slot != m.slot {
                    return Err(unbound());
                }
                if !g.attempts.contains(&m.attempt_id) {
                    return Err(TransitionError::UnknownAttempt {
                        grant: grant_id.clone(),
                        attempt: m.attempt_id.clone(),
                    });
                }
                if m.verb.can_start_process() && g.start_revoked() {
                    return Err(TransitionError::GrantRevoked(grant_id.clone()));
                }
                Ok(())
            }
            WorkloadClass::Platform => {
                if m.grant_id.is_some() || self.manifest.is_none() {
                    Err(unbound())
                } else {
                    Ok(())
                }
            }
        }
    }

    fn check_certificate(
        &self,
        grant_id: &GrantId,
        envelope: &SignedEnvelope,
    ) -> Result<(), TransitionError> {
        let bad = |reason: &str| TransitionError::BadCertificate {
            grant: grant_id.clone(),
            reason: reason.to_owned(),
        };
        let g = self.grant(grant_id)?;
        let c: StopCertificate = envelope
            .decode_own_payload()
            .map_err(|e| bad(&format!("undecodable certificate: {e}")))?;
        if g.revoked.is_none() {
            return Err(bad("start authority not revoked before certification"));
        }
        if g.certificate.is_some() {
            return Err(bad("grant already certified"));
        }
        if &c.grant_id != grant_id || c.slot != g.grant.slot || c.node_epoch != g.grant.node_epoch {
            return Err(bad("certificate names another grant, slot or epoch"));
        }
        let attempts: BTreeSet<&AttemptId> = g.attempts.iter().collect();
        let certified: BTreeSet<&AttemptId> = c.attempt_ids.iter().collect();
        if attempts != certified {
            return Err(bad(
                "certificate does not cover exactly the grant's attempts",
            ));
        }
        // Every create/start/restart must be terminal. An unresolved stop/kill/remove
        // cannot start a process; the observed state covers what it did.
        if self
            .mutations_of_grant(grant_id)
            .any(|m| m.record.verb.can_start_process() && !m.submission.is_terminal())
        {
            return Err(bad(
                "a start-capable mutation of the grant has no terminal outcome",
            ));
        }
        if !c.cgroups_empty
            || !c
                .containers
                .iter()
                .all(|o| o.process.is_positively_stopped())
        {
            return Err(bad("a container is not positively stopped"));
        }
        let known: BTreeSet<&ContainerRef> = self.containers_of_grant(grant_id).collect();
        let observed: BTreeSet<&ContainerRef> = c.containers.iter().map(|o| &o.container).collect();
        if !known.is_subset(&observed) {
            return Err(bad(
                "a container of the grant is missing from the certificate",
            ));
        }
        let count = u32::try_from(self.mutations_of_grant(grant_id).count()).unwrap_or(u32::MAX);
        if c.mutation_count != count
            || c.mutation_inventory_digest != self.mutation_inventory_digest(grant_id)
        {
            return Err(bad("mutation inventory does not match the journal"));
        }
        Ok(())
    }

    fn check_update(&self, id: &UpdateId, phase: UpdatePhase) -> Result<(), TransitionError> {
        let current = self.update.as_ref().filter(|u| &u.update_id == id);
        let ok = match (current, phase) {
            (None, UpdatePhase::Staged) => {
                self.update.as_ref().is_none_or(|u| u.phase.is_terminal())
            }
            (None, _) => false,
            (Some(u), _) if u.phase.is_terminal() => false,
            // Rollback is permitted only before the irreversible schema boundary.
            (Some(u), UpdatePhase::RolledBack) => !u.irreversible,
            (Some(u), next) => next > u.phase,
        };
        if ok {
            Ok(())
        } else {
            Err(TransitionError::IllegalUpdate {
                id: id.clone(),
                from: current.map(|u| u.phase),
                to: phase,
            })
        }
    }

    #[allow(clippy::too_many_lines)] // one arm per record kind reads best as one match
    fn commit(&mut self, record: &Record, seq: U53, at: U53) {
        match record {
            Record::Format { journal_format, .. } => self.format = Some(*journal_format),
            Record::Compacted { .. } => {}
            Record::Identity {
                install_id,
                node_id,
                node_epoch,
                key_epoch,
                identity_key_id,
                cp_keys,
                recovery_key,
                host,
            } => {
                for g in self.grants.values_mut() {
                    if g.grant.node_epoch < *node_epoch && g.superseded_by_epoch.is_none() {
                        g.superseded_by_epoch = Some(*node_epoch);
                    }
                }
                self.identity = Some(IdentityState {
                    install_id: install_id.clone(),
                    node_id: node_id.clone(),
                    node_epoch: *node_epoch,
                    key_epoch: *key_epoch,
                    identity_key_id: identity_key_id.clone(),
                    cp_keys: cp_keys.clone(),
                    recovery_key: recovery_key.clone(),
                    host: host.clone(),
                });
            }
            Record::KeysRotated {
                key_epoch,
                identity_key_id,
            } => {
                if let Some(id) = &mut self.identity {
                    id.key_epoch = *key_epoch;
                    id.identity_key_id = identity_key_id.clone();
                }
            }
            Record::CpKeysChanged { cp_keys } => {
                if let Some(id) = &mut self.identity {
                    id.cp_keys.clone_from(cp_keys);
                }
            }
            Record::ProcessStarted {
                incarnation,
                boot_id,
            } => {
                self.incarnation = Some(incarnation.clone());
                self.boot_id = Some(boot_id.clone());
                self.cleared.clear();
            }
            Record::AuthorityRevoked {
                below_term,
                revocation_digest,
                reason,
            } => {
                if self
                    .revocation
                    .as_ref()
                    .is_none_or(|r| *below_term > r.below_term)
                {
                    self.revocation = Some(Revocation {
                        below_term: *below_term,
                        revocation_digest: revocation_digest.clone(),
                        reason: reason.clone(),
                    });
                }
            }
            Record::OpClaimed {
                op_id,
                verb,
                payload_hash,
                capability_digest,
                session_id,
                operation_epoch,
                resource_id,
            } => {
                if let Some(resource) = resource_id {
                    self.raise(
                        HighWaterKey::new(HighWaterKind::OperationEpoch, resource.as_str()),
                        *operation_epoch,
                    );
                }
                self.ops.insert(
                    op_id.clone(),
                    OpState {
                        verb: *verb,
                        payload_hash: payload_hash.clone(),
                        capability_digest: capability_digest.clone(),
                        session_id: session_id.clone(),
                        operation_epoch: *operation_epoch,
                        resource_id: resource_id.clone(),
                        claimed_at_unix_ms: at,
                        outcome: None,
                    },
                );
            }
            Record::OpCompleted { op_id, outcome } => {
                if let Some(op) = self.ops.get_mut(op_id) {
                    op.outcome = Some(outcome.clone());
                }
            }
            Record::GrantAccepted {
                grant,
                spec_digest,
                op_id,
            } => {
                self.raise(HighWaterKey::slot_generation(&grant.slot), grant.generation);
                self.grants.insert(
                    grant.grant_id.clone(),
                    GrantState {
                        grant: grant.clone(),
                        spec_digest: spec_digest.clone(),
                        op_id: op_id.clone(),
                        revoked: None,
                        certificate: None,
                        superseded_by_epoch: None,
                        attempts: Vec::new(),
                    },
                );
            }
            Record::GrantRevoked { grant_id, reason } => {
                if let Some(g) = self.grants.get_mut(grant_id) {
                    g.revoked.get_or_insert_with(|| reason.clone());
                    let slot = g.grant.slot.clone();
                    self.cleared.remove(&slot);
                }
            }
            Record::AttemptBegun {
                grant_id,
                attempt_id,
                ordinal,
                reason,
            } => {
                if let Some(g) = self.grants.get_mut(grant_id) {
                    g.attempts.push(attempt_id.clone());
                }
                self.attempts.insert(
                    attempt_id.clone(),
                    AttemptState {
                        grant_id: grant_id.clone(),
                        ordinal: *ordinal,
                        reason: *reason,
                    },
                );
            }
            Record::MutationIntent { mutation } => {
                self.mutations.insert(
                    mutation.mutation_id.clone(),
                    MutationState {
                        record: mutation.clone(),
                        submission: Submission::NotSubmitted,
                        submitted: None,
                        intent_seq: seq,
                    },
                );
            }
            Record::MutationSubmitted {
                mutation_id,
                boot_id,
                incarnation,
                engine_incarnation,
            } => {
                if let Some(m) = self.mutations.get_mut(mutation_id) {
                    m.submitted = Some(SubmittedInfo {
                        boot_id: boot_id.clone(),
                        incarnation: incarnation.clone(),
                        engine_incarnation: engine_incarnation.clone(),
                    });
                }
                self.set_submission(
                    mutation_id,
                    Submission::Submitted {
                        boot_id: boot_id.clone(),
                        incarnation: incarnation.clone(),
                        engine_incarnation: engine_incarnation.clone(),
                    },
                );
            }
            Record::MutationSettled {
                mutation_id,
                outcome,
            } => self.set_submission(
                mutation_id,
                Submission::Settled {
                    outcome: outcome.clone(),
                },
            ),
            Record::MutationRetired {
                mutation_id,
                retirement,
            } => self.set_submission(
                mutation_id,
                Submission::Retired {
                    retirement: retirement.clone(),
                },
            ),
            Record::StopCertified {
                grant_id,
                certificate,
            } => {
                if let Some(g) = self.grants.get_mut(grant_id) {
                    g.certificate = Some(certificate.clone());
                }
            }
            Record::QuarantineCleared { slot, .. } => {
                self.cleared.insert(slot.clone());
            }
            Record::HoldIntent { hold } => {
                self.holds.insert(
                    hold.hold_id.clone(),
                    HoldState {
                        record: hold.clone(),
                        phase: HoldPhase::Intent,
                    },
                );
            }
            Record::HoldStaged {
                hold_id,
                backing,
                staging_mnt_id,
            } => self.set_hold(
                hold_id,
                HoldPhase::Staged {
                    backing: backing.clone(),
                    staging_mnt_id: *staging_mnt_id,
                },
            ),
            Record::HoldUnknown { hold_id, reason } => self.set_hold(
                hold_id,
                HoldPhase::Unknown {
                    reason: reason.clone(),
                },
            ),
            Record::HoldReleased { hold_id, reason } => self.set_hold(
                hold_id,
                HoldPhase::Released {
                    reason: reason.clone(),
                },
            ),
            Record::ManifestActivated {
                manifest_digest,
                manifest_revision,
                bootstrap_epoch,
                authority_term,
            } => {
                self.manifest = Some(ActiveManifest {
                    manifest_digest: manifest_digest.clone(),
                    manifest_revision: *manifest_revision,
                    bootstrap_epoch: *bootstrap_epoch,
                    authority_term: *authority_term,
                });
            }
            Record::UpdatePhaseEntered {
                update_id,
                phase,
                from_manifest_digest,
                to_manifest_digest,
            } => {
                let irreversible = self
                    .update
                    .as_ref()
                    .filter(|u| &u.update_id == update_id)
                    .is_some_and(|u| u.irreversible)
                    || (*phase >= UpdatePhase::SchemaBoundary && *phase != UpdatePhase::RolledBack);
                self.update = Some(UpdateState {
                    update_id: update_id.clone(),
                    phase: *phase,
                    from_manifest_digest: from_manifest_digest.clone(),
                    to_manifest_digest: to_manifest_digest.clone(),
                    irreversible,
                });
            }
            Record::HighWater { kind, scope, value } => {
                self.raise(HighWaterKey::new(*kind, scope.clone()), *value);
            }
        }
    }

    fn raise(&mut self, key: HighWaterKey, value: U53) {
        let hw = self.high_water.entry(key).or_insert(value);
        if value > *hw {
            *hw = value;
        }
    }

    fn set_submission(&mut self, id: &MutationId, submission: Submission) {
        if let Some(m) = self.mutations.get_mut(id) {
            m.submission = submission;
        }
    }

    fn set_hold(&mut self, id: &HoldId, phase: HoldPhase) {
        if let Some(h) = self.holds.get_mut(id) {
            h.phase = phase;
        }
    }

    fn grant(&self, id: &GrantId) -> Result<&GrantState, TransitionError> {
        self.grants
            .get(id)
            .ok_or_else(|| TransitionError::UnknownGrant(id.clone()))
    }

    fn mutation(&self, id: &MutationId) -> Result<&MutationState, TransitionError> {
        self.mutations
            .get(id)
            .ok_or_else(|| TransitionError::UnknownMutation(id.clone()))
    }

    fn hold(&self, id: &HoldId) -> Result<&HoldState, TransitionError> {
        self.holds
            .get(id)
            .ok_or_else(|| TransitionError::UnknownHold(id.clone()))
    }

    // ---- Queries ----

    /// Every authority term below this was revoked by the recovery root.
    #[must_use]
    pub fn revoked_below_term(&self) -> U53 {
        self.revocation.as_ref().map_or(U53::ZERO, |r| r.below_term)
    }

    #[must_use]
    pub fn generation_high_water(&self, slot: &SlotRef) -> U53 {
        self.high_water
            .get(&HighWaterKey::slot_generation(slot))
            .copied()
            .unwrap_or(U53::ZERO)
    }

    #[must_use]
    pub fn high_water(&self, kind: HighWaterKind, scope: &str) -> U53 {
        self.high_water
            .get(&HighWaterKey::new(kind, scope))
            .copied()
            .unwrap_or(U53::ZERO)
    }

    pub fn mutations_of_grant<'a>(
        &'a self,
        grant: &'a GrantId,
    ) -> impl Iterator<Item = &'a MutationState> + 'a {
        self.mutations
            .values()
            .filter(move |m| m.record.grant_id.as_ref() == Some(grant))
    }

    pub fn mutations_of_slot<'a>(
        &'a self,
        slot: &'a SlotRef,
    ) -> impl Iterator<Item = &'a MutationState> + 'a {
        self.mutations
            .values()
            .filter(move |m| &m.record.slot == slot)
    }

    /// Every container identity any mutation of the grant produced or touched.
    pub fn containers_of_grant<'a>(
        &'a self,
        grant: &'a GrantId,
    ) -> impl Iterator<Item = &'a ContainerRef> + 'a {
        self.mutations_of_grant(grant)
            .filter_map(MutationState::container)
    }

    /// Digest over every mutation of the grant with its submission state; a stop
    /// certificate binds it. Order: mutation id (the map's order).
    #[must_use]
    pub fn mutation_inventory_digest(&self, grant: &GrantId) -> Sha256Hex {
        let mut h = Sha256::new();
        for m in self.mutations_of_grant(grant) {
            h.update(m.record.mutation_id.as_str().as_bytes());
            h.update([0]);
            h.update(m.record.payload_hash.as_str().as_bytes());
            h.update([0]);
            h.update(serde_json::to_vec(&m.submission).unwrap_or_default());
            h.update([0xff]);
        }
        Sha256Hex::new(hex::encode(h.finalize())).unwrap_or_else(|_| Sha256Hex::digest(b""))
    }

    /// Everything that prevents a new attempt in `slot`. Empty means the slot is
    /// free *as far as this journal knows*; the CP still needs a fresh grant.
    #[must_use]
    pub fn slot_blockers(&self, slot: &SlotRef) -> Vec<Blocker> {
        let mut out: Vec<Blocker> = self
            .mutations_of_slot(slot)
            .filter(|m| {
                matches!(m.submission, Submission::Submitted { .. })
                    && m.record.verb.can_start_process()
            })
            .map(|m| Blocker::UnresolvedSubmission {
                mutation_id: m.record.mutation_id.clone(),
                object_name: m.record.object_name.clone(),
            })
            .collect();
        out.extend(
            self.grants
                .values()
                .filter(|g| &g.grant.slot == slot && g.grant.exclusive && !g.is_released())
                .map(|g| Blocker::UnreleasedGrant {
                    grant_id: g.grant.grant_id.clone(),
                }),
        );
        out.extend(
            self.holds
                .values()
                .filter(|h| &h.record.slot == slot && matches!(h.phase, HoldPhase::Unknown { .. }))
                .map(|h| Blocker::UnknownHold {
                    hold_id: h.record.hold_id.clone(),
                }),
        );
        out
    }

    /// Start-capable submissions anywhere on the node without a terminal outcome.
    pub fn unresolved_submissions(&self) -> impl Iterator<Item = &MutationState> {
        self.mutations.values().filter(|m| {
            matches!(m.submission, Submission::Submitted { .. })
                && m.record.verb.can_start_process()
        })
    }

    /// Holds that are not released.
    pub fn open_holds(&self) -> impl Iterator<Item = &HoldState> {
        self.holds
            .values()
            .filter(|h| !matches!(h.phase, HoldPhase::Released { .. }))
    }

    /// Whether `slot` has been reconciled under a fresh grant in this incarnation.
    #[must_use]
    pub fn is_cleared(&self, slot: &SlotRef) -> bool {
        self.cleared.contains(slot)
    }
}
