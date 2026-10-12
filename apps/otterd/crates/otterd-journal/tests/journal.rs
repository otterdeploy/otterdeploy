//! Journal behaviour: transition rules, durability, corruption and compaction.
#![allow(
    clippy::unwrap_used,
    clippy::panic,
    clippy::too_many_lines,
    clippy::indexing_slicing,
    clippy::single_match_else
)]

mod common;

use common::*;
use otterd_journal::{Blocker, CompactionPolicy, Journal, JournalError, TransitionError};
use otterd_proto::ids::GrantId;
use otterd_proto::journal::{EngineOutcome, Record, Retirement, UpdatePhase};
use otterd_proto::lifecycle::EngineVerb;
use std::io::Write as _;

fn fresh(dir: &tempfile::TempDir) -> Journal {
    let mut j = Journal::create(&dir.path().join("node.journal"), "test").unwrap();
    j.append(identity(1)).unwrap();
    j.append(started(INCARNATION)).unwrap();
    j
}

fn transition(e: JournalError) -> TransitionError {
    match e {
        JournalError::Transition(t) => t,
        other => panic!("expected a transition error, got {other}"),
    }
}

#[test]
fn format_must_come_first_and_only_once() {
    let dir = tempfile::tempdir().unwrap();
    let mut j = fresh(&dir);
    let e = j
        .append(Record::Format {
            journal_format: 1,
            otterd_version: "x".into(),
        })
        .unwrap_err();
    assert_eq!(transition(e), TransitionError::FormatPlacement);
}

#[test]
fn submitted_survives_reopen_and_blocks_the_slot() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("node.journal");
    {
        let mut j = fresh(&dir);
        j.append(grant("g1", 0, 1, 1, true)).unwrap();
        j.append(attempt("g1", "a1", 1)).unwrap();
        j.append(intent("m1", "g1", 0, "a1", EngineVerb::Start))
            .unwrap();
        j.append(submitted("m1")).unwrap();
    }
    let (j, report) = Journal::open(&path).unwrap();
    assert_eq!(report.entries, 7);
    let blockers = j.state().slot_blockers(&slot(0));
    assert!(
        blockers
            .iter()
            .any(|b| matches!(b, Blocker::UnresolvedSubmission { .. }))
    );
    assert!(
        blockers
            .iter()
            .any(|b| matches!(b, Blocker::UnreleasedGrant { .. }))
    );
}

#[test]
fn a_second_process_cannot_open_the_journal() {
    let dir = tempfile::tempdir().unwrap();
    let _j = fresh(&dir);
    assert!(matches!(
        Journal::open(&dir.path().join("node.journal")),
        Err(JournalError::Locked { .. })
    ));
}

#[test]
fn submission_state_machine() {
    let dir = tempfile::tempdir().unwrap();
    let mut j = fresh(&dir);
    j.append(grant("g1", 0, 1, 1, true)).unwrap();
    j.append(attempt("g1", "a1", 1)).unwrap();
    j.append(intent("m1", "g1", 0, "a1", EngineVerb::Start))
        .unwrap();
    // Settling something never submitted is illegal.
    assert!(matches!(
        transition(j.append(settled("m1", EngineOutcome::Started)).unwrap_err()),
        TransitionError::IllegalSubmission { .. }
    ));
    j.append(submitted("m1")).unwrap();
    // A submitted request can never be retired as not-submitted.
    let e = j
        .append(Record::MutationRetired {
            mutation_id: id("m1"),
            retirement: Retirement::NotSubmitted,
        })
        .unwrap_err();
    assert!(matches!(
        transition(e),
        TransitionError::IllegalSubmission { .. }
    ));
    j.append(settled("m1", EngineOutcome::Started)).unwrap();
    assert!(j.append(submitted("m1")).is_err(), "terminal is terminal");
    assert!(j.append(settled("m1", EngineOutcome::Started)).is_err());
}

#[test]
fn mutations_need_their_grant_and_attempt() {
    let dir = tempfile::tempdir().unwrap();
    let mut j = fresh(&dir);
    j.append(grant("g1", 0, 1, 1, true)).unwrap();
    assert!(matches!(
        transition(
            j.append(intent("m1", "g1", 0, "a1", EngineVerb::Create))
                .unwrap_err()
        ),
        TransitionError::UnknownAttempt { .. }
    ));
    assert!(matches!(
        transition(j.append(attempt("g1", "a1", 2)).unwrap_err()),
        TransitionError::AttemptOrdinal { .. }
    ));
    j.append(attempt("g1", "a1", 1)).unwrap();
    // Wrong slot for the grant.
    assert!(matches!(
        transition(
            j.append(intent("m1", "g1", 1, "a1", EngineVerb::Create))
                .unwrap_err()
        ),
        TransitionError::UnboundMutation { .. }
    ));
    j.append(intent("m1", "g1", 0, "a1", EngineVerb::Create))
        .unwrap();
}

#[test]
fn exclusive_slot_admits_one_unreleased_grant() {
    let dir = tempfile::tempdir().unwrap();
    let mut j = fresh(&dir);
    j.append(grant("g1", 0, 1, 1, true)).unwrap();
    assert!(matches!(
        transition(j.append(grant("g2", 0, 2, 1, true)).unwrap_err()),
        TransitionError::ExclusiveHeld { .. }
    ));
    // A shared grant cannot slip in beside an exclusive one either.
    assert!(matches!(
        transition(j.append(grant("g2", 0, 2, 1, false)).unwrap_err()),
        TransitionError::ExclusiveHeld { .. }
    ));
    // Revocation alone is not release: a certificate is required (MODEL §2.3).
    j.append(revoked("g1")).unwrap();
    assert!(j.append(grant("g2", 0, 2, 1, true)).is_err());
    let cert = certificate(j.state(), "g1");
    j.append(cert).unwrap();
    j.append(grant("g2", 0, 2, 1, true)).unwrap();
    // I2: generations never go backwards; rollback is a new, higher generation.
    let mut k = fresh(&tempfile::tempdir().unwrap());
    k.append(grant("g1", 1, 5, 1, false)).unwrap();
    assert!(matches!(
        transition(k.append(grant("g0", 1, 5, 1, false)).unwrap_err()),
        TransitionError::StaleGeneration { .. }
    ));
    k.append(grant("g2", 1, 6, 1, false)).unwrap();
}

#[test]
fn certificate_rules() {
    let dir = tempfile::tempdir().unwrap();
    let mut j = fresh(&dir);
    j.append(grant("g1", 0, 1, 1, true)).unwrap();
    j.append(attempt("g1", "a1", 1)).unwrap();
    j.append(intent("m1", "g1", 0, "a1", EngineVerb::Create))
        .unwrap();
    j.append(submitted("m1")).unwrap();
    j.append(settled(
        "m1",
        EngineOutcome::Created {
            container: id("c1"),
        },
    ))
    .unwrap();
    j.append(intent("m2", "g1", 0, "a1", EngineVerb::Start))
        .unwrap();
    j.append(submitted("m2")).unwrap();
    // Not revoked yet.
    let early = certificate(j.state(), "g1");
    assert!(matches!(
        transition(j.append(early).unwrap_err()),
        TransitionError::BadCertificate { .. }
    ));
    j.append(revoked("g1")).unwrap();
    // A revoked grant cannot record a new start.
    assert!(matches!(
        transition(
            j.append(intent("m3", "g1", 0, "a1", EngineVerb::Start))
                .unwrap_err()
        ),
        TransitionError::GrantRevoked(_)
    ));
    // ...but a stop is fine.
    j.append(intent("m4", "g1", 0, "a1", EngineVerb::Stop))
        .unwrap();
    // A start without a terminal outcome blocks certification.
    let pending = certificate(j.state(), "g1");
    assert!(matches!(
        transition(j.append(pending).unwrap_err()),
        TransitionError::BadCertificate { .. }
    ));
    j.append(settled("m2", EngineOutcome::Started)).unwrap();
    // A certificate missing the grant's container is refused.
    let mut state = j.state().clone();
    state.mutations.get_mut(&id("m1")).unwrap().submission = otterd_journal::Submission::Settled {
        outcome: EngineOutcome::Created {
            container: id("other"),
        },
    };
    let wrong = certificate(&state, "g1");
    assert!(j.append(wrong).is_err());
    // The unresolved stop (m4) does not block: it cannot start a process.
    let good = certificate(j.state(), "g1");
    j.append(good).unwrap();
    assert!(j.state().grants[&GrantId::new("g1").unwrap()].is_released());
}

#[test]
fn torn_tail_is_truncated_but_mid_log_corruption_refuses() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("node.journal");
    {
        let mut j = fresh(&dir);
        j.append(grant("g1", 0, 1, 1, true)).unwrap();
    }
    std::fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap()
        .write_all(&[9, 0, 0])
        .unwrap();
    let (j, report) = Journal::open(&path).unwrap();
    assert_eq!(report.entries, 4);
    assert_eq!(report.truncated_torn_tail_bytes, 3);
    drop(j);
    let mut bytes = std::fs::read(&path).unwrap();
    bytes[30] ^= 0x55;
    std::fs::write(&path, &bytes).unwrap();
    assert!(matches!(
        Journal::open(&path),
        Err(JournalError::Corrupt { .. })
    ));
}

#[test]
fn missing_journal_is_not_created_on_open() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("absent");
    assert!(matches!(
        Journal::open(&path),
        Err(JournalError::Missing { .. })
    ));
    assert!(!path.exists());
    assert!(matches!(
        Journal::create(&dir.path().join("x"), "t")
            .and_then(|_| Journal::create(&dir.path().join("x"), "t")),
        Err(JournalError::AlreadyExists { .. })
    ));
}

#[test]
fn re_enrollment_supersedes_old_epoch_grants() {
    let dir = tempfile::tempdir().unwrap();
    let mut j = fresh(&dir);
    j.append(grant("g1", 0, 1, 1, true)).unwrap();
    assert!(j.append(identity(1)).is_err(), "epoch must rise");
    j.append(identity(2)).unwrap();
    assert!(j.state().slot_blockers(&slot(0)).is_empty());
    assert!(matches!(
        transition(j.append(grant("g2", 0, 2, 1, true)).unwrap_err()),
        TransitionError::WrongEpoch { .. }
    ));
    j.append(grant("g2", 0, 2, 2, true)).unwrap();
}

#[test]
fn no_start_crosses_after_revocation_and_no_reenroll_over_pending_work() {
    let dir = tempfile::tempdir().unwrap();
    let mut j = fresh(&dir);
    j.append(grant("g1", 0, 1, 1, true)).unwrap();
    j.append(attempt("g1", "a1", 1)).unwrap();
    j.append(intent("m1", "g1", 0, "a1", EngineVerb::Create))
        .unwrap();
    j.append(intent("m2", "g1", 0, "a1", EngineVerb::Start))
        .unwrap();
    j.append(submitted("m2")).unwrap();
    j.append(revoked("g1")).unwrap();
    // m1 never crossed: after revocation it may only be retired, not submitted.
    assert!(matches!(
        transition(j.append(submitted("m1")).unwrap_err()),
        TransitionError::GrantRevoked(_)
    ));
    j.append(Record::MutationRetired {
        mutation_id: id("m1"),
        retirement: Retirement::NotSubmitted,
    })
    .unwrap();
    // m2 crossed and is unresolved: a new epoch would hide it, so it is refused.
    assert!(matches!(
        transition(j.append(identity(2)).unwrap_err()),
        TransitionError::UnresolvedBeforeReenroll(_)
    ));
    j.append(Record::MutationRetired {
        mutation_id: id("m2"),
        retirement: Retirement::HostReboot {
            submitted_boot_id: id("boot-1"),
            observed_boot_id: id("boot-2"),
            profile: "validated".into(),
        },
    })
    .unwrap();
    j.append(identity(2)).unwrap();
}

#[test]
fn grants_never_survive_a_restart() {
    let dir = tempfile::tempdir().unwrap();
    let mut j = fresh(&dir);
    j.append(started("inc_00000000000000000000000000000002"))
        .unwrap();
    // The builder's grants name INCARNATION, the previous process.
    assert!(matches!(
        transition(j.append(grant("g1", 0, 1, 1, true)).unwrap_err()),
        TransitionError::StaleIncarnation { .. }
    ));
}

#[test]
fn op_claims() {
    let dir = tempfile::tempdir().unwrap();
    let mut j = fresh(&dir);
    let claim = |hash: &[u8]| Record::OpClaimed {
        op_id: id("op-1"),
        verb: otterd_proto::capability::Verb::WorkloadStop,
        payload_hash: otterd_proto::ids::Sha256Hex::digest(hash),
        capability_digest: digest(),
        session_id: id("sess"),
        operation_epoch: u(4),
        resource_id: Some(id("db")),
    };
    j.append(claim(b"a")).unwrap();
    assert!(matches!(
        transition(j.append(claim(b"a")).unwrap_err()),
        TransitionError::DuplicateOp(_)
    ));
    assert!(matches!(
        transition(j.append(claim(b"b")).unwrap_err()),
        TransitionError::OpConflict(_)
    ));
    assert_eq!(
        j.state()
            .high_water(otterd_proto::journal::HighWaterKind::OperationEpoch, "db"),
        u(4)
    );
    let done = |outcome| Record::OpCompleted {
        op_id: id("op-1"),
        outcome,
    };
    assert!(
        j.append(done(otterd_proto::command::OpOutcome::Accepted))
            .is_err()
    );
    j.append(done(otterd_proto::command::OpOutcome::Unknown {
        reason: "r".into(),
    }))
    .unwrap();
    assert!(
        j.append(done(otterd_proto::command::OpOutcome::Unknown {
            reason: "r".into()
        }))
        .is_err()
    );
}

#[test]
fn update_rollback_is_refused_after_schema_boundary() {
    let dir = tempfile::tempdir().unwrap();
    let mut j = fresh(&dir);
    let phase = |p| Record::UpdatePhaseEntered {
        update_id: id("upd_1"),
        phase: p,
        from_manifest_digest: digest(),
        to_manifest_digest: digest(),
    };
    j.append(phase(UpdatePhase::Staged)).unwrap();
    j.append(phase(UpdatePhase::CpStopped)).unwrap();
    assert!(
        j.append(phase(UpdatePhase::Staged)).is_err(),
        "phases only advance"
    );
    j.append(phase(UpdatePhase::SchemaBoundary)).unwrap();
    assert!(j.append(phase(UpdatePhase::RolledBack)).is_err());
    j.append(phase(UpdatePhase::NewCpStarted)).unwrap();
    j.append(phase(UpdatePhase::Committed)).unwrap();
}

#[test]
fn compaction_keeps_obligations_and_drops_released_history() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("node.journal");
    let mut j = fresh(&dir);
    // A released grant with history.
    j.append(grant("g1", 0, 1, 1, true)).unwrap();
    j.append(attempt("g1", "a1", 1)).unwrap();
    j.append(intent("m1", "g1", 0, "a1", EngineVerb::Create))
        .unwrap();
    j.append(submitted("m1")).unwrap();
    j.append(settled(
        "m1",
        EngineOutcome::Created {
            container: id("c1"),
        },
    ))
    .unwrap();
    j.append(revoked("g1")).unwrap();
    let cert = certificate(j.state(), "g1");
    j.append(cert).unwrap();
    // A live grant with an unresolved start.
    j.append(grant("g2", 0, 2, 1, true)).unwrap();
    j.append(attempt("g2", "a2", 1)).unwrap();
    j.append(intent("m2", "g2", 0, "a2", EngineVerb::Start))
        .unwrap();
    j.append(submitted("m2")).unwrap();
    let before = j.state().clone();
    let next_seq_before = before.last_seq;
    let (mut j, report) = j.compact(CompactionPolicy::default(), "test").unwrap();
    assert!(report.records_after < report.records_before, "{report:?}");
    assert!(dir.path().join("node.journal.prev").exists());
    let after = j.state().clone();
    assert!(!after.grants.contains_key(&id::<GrantId>("g1")));
    assert!(after.grants.contains_key(&id::<GrantId>("g2")));
    assert_eq!(after.generation_high_water(&slot(0)), u(2));
    assert_eq!(
        after.slot_blockers(&slot(0)),
        before.slot_blockers(&slot(0))
    );
    assert!(after.last_seq > next_seq_before, "sequence continues");
    // The released generation can still never be reused.
    assert!(j.append(grant("g0", 0, 1, 1, false)).is_err());
    // Reopen reproduces the compacted state, and appends continue.
    j.append(settled("m2", EngineOutcome::Started)).unwrap();
    let expected = j.state().clone();
    drop(j);
    let (reopened, _) = Journal::open(&path).unwrap();
    assert_eq!(reopened.state(), &expected);
}
