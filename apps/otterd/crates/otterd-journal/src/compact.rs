//! Compaction: rewrite the journal keeping every fact an open obligation
//! still depends on.
//!
//! The new file starts with `format` and `compacted` (naming the last sequence
//! covered and the SHA-256 of the previous file), then re-records, in an order
//! the reducer accepts, everything that is still live: identity, the current
//! process, revocations, the active manifest and update, every grant that is
//! not released with its attempts and mutations, platform work that is still
//! needed, open holds, recent and unfinished operations, cleared slots and every
//! high-water mark. Sequence numbers continue; they are never reset.
//!
//! Before the new file replaces the old one, its fold is compared with the old
//! fold over exactly those facts; any difference refuses the compaction. The
//! previous file is kept as `<name>.prev` (hard link) until the next compaction.

use crate::log::{Journal, JournalError, io_err, now_unix_ms, sync_dir};
use crate::state::{GrantState, HoldPhase, MutationState, NodeState, OpState, Submission};
use otterd_proto::U53;
use otterd_proto::ids::{AttemptId, GrantId, Sha256Hex, SlotRef};
use otterd_proto::journal::{Record, WorkloadClass};
use otterd_proto::version::JOURNAL_FORMAT;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

/// What compaction keeps beyond live obligations.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CompactionPolicy {
    /// Completed operations younger than this are kept so a retry still finds
    /// its recorded outcome (capability windows are ≤ 60 s; keep far longer).
    pub op_retention_ms: u64,
}

impl Default for CompactionPolicy {
    fn default() -> Self {
        Self {
            op_retention_ms: 24 * 60 * 60 * 1000,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompactionReport {
    pub through_seq: U53,
    pub records_before: u64,
    pub records_after: u64,
    pub bytes_before: u64,
    pub bytes_after: u64,
    pub prior_digest: Sha256Hex,
}

/// Grants whose facts a compaction keeps: every unreleased grant, and every
/// grant whose attempt a kept grant adopted (its history is that attempt's).
fn kept_grants(state: &NodeState) -> BTreeSet<GrantId> {
    let mut kept: BTreeSet<GrantId> = state
        .grants
        .values()
        .filter(|g| !g.is_released())
        .map(|g| g.grant.grant_id.clone())
        .collect();
    loop {
        let more: Vec<GrantId> = state
            .grants
            .values()
            .filter(|g| !kept.contains(&g.grant.grant_id))
            .filter(|g| g.adopted_by.as_ref().is_some_and(|by| kept.contains(by)))
            .map(|g| g.grant.grant_id.clone())
            .collect();
        if more.is_empty() {
            return kept;
        }
        kept.extend(more);
    }
}

/// Platform attempts whose history must survive: the newest per slot, and any
/// attempt with a start-capable request still unresolved.
fn live_platform_attempts(state: &NodeState) -> BTreeSet<AttemptId> {
    let mut newest: BTreeMap<&SlotRef, (&U53, &AttemptId)> = BTreeMap::new();
    let mut keep = BTreeSet::new();
    for m in state
        .mutations
        .values()
        .filter(|m| m.record.class == WorkloadClass::Platform)
    {
        let slot_newest = newest
            .entry(&m.record.slot)
            .or_insert((&m.intent_seq, &m.record.attempt_id));
        if m.intent_seq > *slot_newest.0 {
            *slot_newest = (&m.intent_seq, &m.record.attempt_id);
        }
        if !m.submission.is_terminal() {
            keep.insert(m.record.attempt_id.clone());
        }
    }
    keep.extend(newest.into_values().map(|(_, a)| a.clone()));
    keep
}

fn op_is_kept(op: &OpState, cutoff: U53) -> bool {
    op.outcome.is_none() || op.claimed_at_unix_ms >= cutoff
}

/// The facts compaction must preserve, in a comparable form. Sequence numbers
/// and per-file counters are deliberately excluded.
fn projection(state: &NodeState, cutoff: U53) -> Value {
    let platform = live_platform_attempts(state);
    let kept = kept_grants(state);
    let grants: BTreeMap<_, _> = state
        .grants
        .iter()
        .filter(|(id, _)| kept.contains(*id))
        .collect();
    let keep_mutation = |m: &MutationState| match &m.record.grant_id {
        Some(g) => grants.contains_key(g),
        None => platform.contains(&m.record.attempt_id),
    };
    let mutations: BTreeMap<_, _> = state
        .mutations
        .iter()
        .filter(|(_, m)| keep_mutation(m))
        .map(|(id, m)| {
            (
                id,
                json!({"record": m.record, "submission": m.submission, "submitted": m.submitted}),
            )
        })
        .collect();
    let attempts: BTreeMap<_, _> = state
        .attempts
        .iter()
        .filter(|(_, a)| grants.contains_key(&a.grant_id))
        .collect();
    let ops: BTreeMap<_, _> = state
        .ops
        .iter()
        .filter(|(_, o)| op_is_kept(o, cutoff))
        .collect();
    let holds: Vec<_> = state.open_holds().collect();
    let cleared: Vec<_> = state
        .cleared
        .iter()
        .filter(|s| grants.values().any(|g| &g.grant.slot == *s))
        .collect();
    json!({
        "identity": state.identity,
        "incarnation": state.incarnation,
        "bootId": state.boot_id,
        "revocation": state.revocation,
        "grants": grants,
        "attempts": attempts,
        "mutations": mutations,
        "ops": ops,
        "holds": holds,
        "highWater": state.high_water.iter().collect::<Vec<_>>(),
        "cleared": cleared,
        "manifest": state.manifest,
        "update": state.update,
    })
}

fn mutation_records(m: &MutationState) -> Vec<Record> {
    let mut out = vec![Record::MutationIntent {
        mutation: m.record.clone(),
    }];
    if let Some(s) = &m.submitted {
        out.push(Record::MutationSubmitted {
            mutation_id: m.record.mutation_id.clone(),
            boot_id: s.boot_id.clone(),
            incarnation: s.incarnation.clone(),
            engine_incarnation: s.engine_incarnation.clone(),
        });
    }
    match &m.submission {
        Submission::Settled { outcome } => out.push(Record::MutationSettled {
            mutation_id: m.record.mutation_id.clone(),
            outcome: outcome.clone(),
        }),
        Submission::Retired { retirement } => out.push(Record::MutationRetired {
            mutation_id: m.record.mutation_id.clone(),
            retirement: retirement.clone(),
        }),
        Submission::NotSubmitted | Submission::Submitted { .. } => {}
    }
    out
}

/// The retained history, in an order the reducer accepts, with the original
/// timestamp of each operation claim (so retention keeps counting from it).
#[allow(clippy::too_many_lines)] // a flat list of what is kept, in replay order
fn retained(state: &NodeState, cutoff: U53) -> Vec<(Record, Option<U53>)> {
    let mut out: Vec<(Record, Option<U53>)> = Vec::new();
    let mut push = |r: Record| out.push((r, None));
    if let Some(id) = &state.identity {
        push(Record::Identity {
            install_id: id.install_id.clone(),
            node_id: id.node_id.clone(),
            node_epoch: id.node_epoch,
            key_epoch: id.key_epoch,
            identity_key_id: id.identity_key_id.clone(),
            cp_keys: id.cp_keys.clone(),
            recovery_key: id.recovery_key.clone(),
            host: id.host.clone(),
        });
    }
    if let (Some(incarnation), Some(boot_id)) = (&state.incarnation, &state.boot_id) {
        push(Record::ProcessStarted {
            incarnation: incarnation.clone(),
            boot_id: boot_id.clone(),
        });
    }
    if let Some(r) = &state.revocation {
        push(Record::AuthorityRevoked {
            below_term: r.below_term,
            revocation_digest: r.revocation_digest.clone(),
            reason: r.reason.clone(),
        });
    }
    if let Some(m) = &state.manifest {
        push(Record::ManifestActivated {
            manifest_digest: m.manifest_digest.clone(),
            manifest_revision: m.manifest_revision,
            bootstrap_epoch: m.bootstrap_epoch,
            authority_term: m.authority_term,
        });
    }
    if let Some(u) = &state.update {
        let phase = |phase| Record::UpdatePhaseEntered {
            update_id: u.update_id.clone(),
            phase,
            from_manifest_digest: u.from_manifest_digest.clone(),
            to_manifest_digest: u.to_manifest_digest.clone(),
        };
        push(phase(otterd_proto::journal::UpdatePhase::Staged));
        if u.phase != otterd_proto::journal::UpdatePhase::Staged {
            push(phase(u.phase));
        }
    }
    let kept = kept_grants(state);
    let mut live: Vec<&GrantState> = state
        .grants
        .values()
        .filter(|g| kept.contains(&g.grant.grant_id))
        .collect();
    live.sort_by_key(|g| (g.grant.slot.clone(), g.grant.generation));
    let mut by_seq: Vec<&MutationState> = state.mutations.values().collect();
    by_seq.sort_by_key(|m| m.intent_seq);
    for g in &live {
        push(Record::GrantAccepted {
            grant: g.grant.clone(),
            spec_digest: g.spec_digest.clone(),
            op_id: g.op_id.clone(),
        });
        // An adopting grant takes its first attempt by adoption, not a new start.
        if let Some(adopted) = &g.grant.adopts_attempt
            && let Some(old) = state
                .grants
                .values()
                .find(|o| o.adopted_by.as_ref() == Some(&g.grant.grant_id))
        {
            push(Record::GrantAdopted {
                grant_id: old.grant.grant_id.clone(),
                by_grant: g.grant.grant_id.clone(),
                attempt_id: adopted.clone(),
            });
        }
        for attempt_id in &g.attempts {
            if g.grant.adopts_attempt.as_ref() == Some(attempt_id) {
                continue;
            }
            if let Some(a) = state.attempts.get(attempt_id) {
                push(Record::AttemptBegun {
                    grant_id: g.grant.grant_id.clone(),
                    attempt_id: attempt_id.clone(),
                    ordinal: a.ordinal,
                    reason: a.reason,
                });
            }
        }
        // Start-capable intents precede the revocation in the original history;
        // replaying all intents first and revoking last keeps that order valid.
        for m in by_seq
            .iter()
            .filter(|m| m.record.grant_id.as_ref() == Some(&g.grant.grant_id))
        {
            for r in mutation_records(m) {
                push(r);
            }
        }
        if let Some(h) = &g.held {
            push(Record::GrantHeld {
                grant_id: g.grant.grant_id.clone(),
                incarnation: h.incarnation.clone(),
                container: h.container.clone(),
                paused: h.paused,
                since_unix_ms: h.since_unix_ms,
            });
        }
        if let Some(reason) = &g.revoked {
            push(Record::GrantRevoked {
                grant_id: g.grant.grant_id.clone(),
                reason: reason.clone(),
            });
        }
    }
    let platform = live_platform_attempts(state);
    for m in by_seq
        .iter()
        .filter(|m| m.record.grant_id.is_none() && platform.contains(&m.record.attempt_id))
    {
        for r in mutation_records(m) {
            push(r);
        }
    }
    for h in state.open_holds() {
        push(Record::HoldIntent {
            hold: h.record.clone(),
        });
        match &h.phase {
            HoldPhase::Staged {
                backing,
                staging_mnt_id,
            } => push(Record::HoldStaged {
                hold_id: h.record.hold_id.clone(),
                backing: backing.clone(),
                staging_mnt_id: *staging_mnt_id,
            }),
            HoldPhase::Unknown { reason } => push(Record::HoldUnknown {
                hold_id: h.record.hold_id.clone(),
                reason: reason.clone(),
            }),
            HoldPhase::Intent | HoldPhase::Released { .. } => {}
        }
    }
    for g in &live {
        if state.cleared.contains(&g.grant.slot)
            && state.incarnation.as_ref() == Some(&g.grant.incarnation)
        {
            push(Record::QuarantineCleared {
                slot: g.grant.slot.clone(),
                grant_id: g.grant.grant_id.clone(),
                incarnation: g.grant.incarnation.clone(),
            });
        }
    }
    for (key, value) in &state.high_water {
        push(Record::HighWater {
            kind: key.kind,
            scope: key.scope.clone(),
            value: *value,
        });
    }
    for (op_id, op) in state.ops.iter().filter(|(_, o)| op_is_kept(o, cutoff)) {
        out.push((
            Record::OpClaimed {
                op_id: op_id.clone(),
                verb: op.verb,
                payload_hash: op.payload_hash.clone(),
                capability_digest: op.capability_digest.clone(),
                session_id: op.session_id.clone(),
                operation_epoch: op.operation_epoch,
                resource_id: op.resource_id.clone(),
            },
            Some(op.claimed_at_unix_ms),
        ));
        if let Some(outcome) = &op.outcome {
            out.push((
                Record::OpCompleted {
                    op_id: op_id.clone(),
                    outcome: outcome.clone(),
                },
                Some(op.claimed_at_unix_ms),
            ));
        }
    }
    out
}

fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path
        .file_name()
        .map(std::ffi::OsStr::to_os_string)
        .unwrap_or_default();
    name.push(suffix);
    path.with_file_name(name)
}

impl Journal {
    /// Rewrite the journal keeping only what open obligations need. Returns the
    /// compacted journal; on any failure the original file is untouched.
    pub fn compact(
        self,
        policy: CompactionPolicy,
        otterd_version: &str,
    ) -> Result<(Self, CompactionReport), JournalError> {
        let cutoff = now_unix_ms().saturating_sub(policy.op_retention_ms);
        let state = self.state().clone();
        let records_before = state.entries_in_file;
        let bytes_before = self.len_bytes();
        let through_seq = state.last_seq;
        let prior_bytes = std::fs::read(self.path()).map_err(io_err(self.path()))?;
        let prior_digest = Sha256Hex::digest(&prior_bytes);
        let path = self.path().to_owned();
        let tmp = sibling(&path, ".compact");
        if tmp.exists() {
            std::fs::remove_file(&tmp).map_err(io_err(&tmp))?;
        }
        let retained = retained(&state, cutoff);
        let mut next = Journal::create_empty(&tmp, self.next_seq())?;
        let built = (|| {
            next.append_unchecked_live(Record::Format {
                journal_format: JOURNAL_FORMAT,
                otterd_version: otterd_version.to_owned(),
            })?;
            next.append_unchecked_live(Record::Compacted {
                through_seq,
                dropped_records: U53::new(records_before.saturating_sub(retained.len() as u64))
                    .unwrap_or(U53::MAX),
                prior_digest: prior_digest.clone(),
            })?;
            for (record, at) in retained {
                next.append_at(record, at)?;
            }
            let (old, new) = (projection(&state, cutoff), projection(next.state(), cutoff));
            if old == new {
                Ok(())
            } else {
                Err(JournalError::CompactionMismatch(diff_keys(&old, &new)))
            }
        })();
        if let Err(e) = built {
            drop(next);
            if std::fs::remove_file(&tmp).is_err() {
                tracing::warn!(path = %tmp.display(), "could not remove a failed compaction file");
            }
            return Err(e);
        }
        let prev = sibling(&path, ".prev");
        if prev.exists() {
            std::fs::remove_file(&prev).map_err(io_err(&prev))?;
        }
        std::fs::hard_link(&path, &prev).map_err(io_err(&prev))?;
        std::fs::rename(&tmp, &path).map_err(io_err(&path))?;
        sync_dir(&path)?;
        drop(self);
        let report = CompactionReport {
            through_seq,
            records_before,
            records_after: next.state().entries_in_file,
            bytes_before,
            bytes_after: next.len_bytes(),
            prior_digest,
        };
        Ok((next.with_path(path), report))
    }
}

fn diff_keys(a: &Value, b: &Value) -> String {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => x
            .iter()
            .filter(|(k, v)| y.get(*k) != Some(v))
            .map(|(k, _)| k.clone())
            .collect::<Vec<_>>()
            .join(", "),
        _ => "root".into(),
    }
}
