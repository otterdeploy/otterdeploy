//! Property tests for the MODEL §2 invariants the journal enforces.
//!
//! Random operation sequences are appended to a real journal file; refusals
//! are expected and ignored. After every accepted record the invariants are
//! checked; at the end the file is reopened, truncated at a random point and
//! compacted, and each must reproduce the right state.
#![allow(
    clippy::unwrap_used,
    clippy::panic,
    clippy::too_many_lines,
    clippy::indexing_slicing,
    clippy::single_match_else
)]

mod common;

use common::*;
use otterd_journal::{CompactionPolicy, Journal, NodeState, Submission};
use otterd_proto::ids::{GrantId, MutationId, SlotRef};
use otterd_proto::journal::{EngineOutcome, Record, Retirement};
use otterd_proto::lifecycle::EngineVerb;
use proptest::prelude::*;
use std::collections::BTreeMap;

#[derive(Clone, Debug)]
enum Op {
    Grant { slot: u32, exclusive: bool },
    Attempt { grant: usize },
    Intent { grant: usize, verb: u8 },
    Submit { mutation: usize },
    Settle { mutation: usize },
    RetireNotSubmitted { mutation: usize },
    RetireByBarrier { mutation: usize },
    Revoke { grant: usize },
    Certify { grant: usize },
    Reenroll,
}

fn op() -> impl Strategy<Value = Op> {
    prop_oneof![
        3 => (0..2u32, any::<bool>()).prop_map(|(slot, exclusive)| Op::Grant { slot, exclusive }),
        3 => (0..8usize).prop_map(|grant| Op::Attempt { grant }),
        5 => (0..8usize, 0..6u8).prop_map(|(grant, verb)| Op::Intent { grant, verb }),
        5 => (0..24usize).prop_map(|mutation| Op::Submit { mutation }),
        4 => (0..24usize).prop_map(|mutation| Op::Settle { mutation }),
        1 => (0..24usize).prop_map(|mutation| Op::RetireNotSubmitted { mutation }),
        1 => (0..24usize).prop_map(|mutation| Op::RetireByBarrier { mutation }),
        2 => (0..8usize).prop_map(|grant| Op::Revoke { grant }),
        2 => (0..8usize).prop_map(|grant| Op::Certify { grant }),
        1 => Just(Op::Reenroll),
    ]
}

const VERBS: [EngineVerb; 6] = [
    EngineVerb::Create,
    EngineVerb::Start,
    EngineVerb::Restart,
    EngineVerb::Stop,
    EngineVerb::Kill,
    EngineVerb::Remove,
];

/// Turns abstract ops into concrete records against the current state.
#[derive(Default)]
struct Model {
    grants: Vec<String>,
    attempts: BTreeMap<String, Vec<String>>,
    mutations: Vec<String>,
    generation: u64,
    epoch: u64,
}

impl Model {
    fn record(&mut self, op: &Op, state: &NodeState) -> Option<Record> {
        let pick = |v: &Vec<String>, i: usize| v.get(i % v.len().max(1)).cloned();
        Some(match op {
            Op::Grant { slot, exclusive } => {
                self.generation += 1;
                let g = format!("g{}", self.grants.len());
                self.grants.push(g.clone());
                grant(&g, *slot, self.generation, self.epoch, *exclusive)
            }
            Op::Attempt { grant } => {
                let g = pick(&self.grants, *grant)?;
                let list = self.attempts.entry(g.clone()).or_default();
                let a = format!("{g}-a{}", list.len());
                let ordinal = u32::try_from(list.len()).unwrap() + 1;
                list.push(a.clone());
                attempt(&g, &a, ordinal)
            }
            Op::Intent { grant, verb } => {
                let g = pick(&self.grants, *grant)?;
                let a = self.attempts.get(&g).and_then(|l| l.last().cloned())?;
                let slot = state.grants.get(&id::<GrantId>(&g))?.grant.slot.index;
                let m = format!("m{}", self.mutations.len());
                self.mutations.push(m.clone());
                intent(&m, &g, slot, &a, VERBS[usize::from(*verb) % VERBS.len()])
            }
            Op::Submit { mutation } => submitted(&pick(&self.mutations, *mutation)?),
            Op::Settle { mutation } => {
                let m = pick(&self.mutations, *mutation)?;
                let verb = state.mutations.get(&id::<MutationId>(&m))?.record.verb;
                let outcome = if verb == EngineVerb::Create {
                    EngineOutcome::Created {
                        container: id(&format!("c-{m}")),
                    }
                } else {
                    EngineOutcome::Started
                };
                settled(&m, outcome)
            }
            Op::RetireNotSubmitted { mutation } => Record::MutationRetired {
                mutation_id: id(&pick(&self.mutations, *mutation)?),
                retirement: Retirement::NotSubmitted,
            },
            Op::RetireByBarrier { mutation } => Record::MutationRetired {
                mutation_id: id(&pick(&self.mutations, *mutation)?),
                retirement: Retirement::HostReboot {
                    submitted_boot_id: id("boot-1"),
                    observed_boot_id: id("boot-2"),
                    profile: "validated".into(),
                },
            },
            Op::Revoke { grant } => revoked(&pick(&self.grants, *grant)?),
            Op::Certify { grant } => {
                let g = pick(&self.grants, *grant)?;
                state.grants.get(&id::<GrantId>(&g))?;
                certificate(state, &g)
            }
            Op::Reenroll => {
                self.epoch += 1;
                identity(self.epoch)
            }
        })
    }
}

fn rank(s: &Submission) -> u8 {
    match s {
        Submission::NotSubmitted => 0,
        Submission::Submitted { .. } => 1,
        Submission::Settled { .. } | Submission::Retired { .. } => 2,
    }
}

/// MODEL I1, I2 and the submission rules, checked after every accepted record.
fn check_invariants(state: &NodeState, prev: &NodeState, generations: &mut BTreeMap<SlotRef, u64>) {
    // I1: per slot, no two non-released grants if either is exclusive.
    let mut live: BTreeMap<&SlotRef, Vec<bool>> = BTreeMap::new();
    for g in state.grants.values().filter(|g| !g.is_released()) {
        live.entry(&g.grant.slot)
            .or_default()
            .push(g.grant.exclusive);
    }
    for (slot, flags) in &live {
        assert!(
            flags.len() <= 1 || flags.iter().all(|e| !e),
            "I1 violated on {slot}: {flags:?}"
        );
    }
    // I2: a newly accepted grant raises its slot's generation.
    for (gid, g) in &state.grants {
        if !prev.grants.contains_key(gid) {
            let last = generations.entry(g.grant.slot.clone()).or_insert(0);
            assert!(g.grant.generation.get() > *last, "I2 violated for {gid}");
            *last = g.grant.generation.get();
        }
    }
    // Submissions only move forward; terminal stays terminal.
    for (mid, m) in &state.mutations {
        if let Some(before) = prev.mutations.get(mid) {
            assert!(
                rank(&m.submission) >= rank(&before.submission),
                "{mid} went backwards"
            );
            if before.submission.is_terminal() {
                assert_eq!(
                    m.submission, before.submission,
                    "{mid} left a terminal state"
                );
            }
            if matches!(before.submission, Submission::Submitted { .. }) {
                assert!(
                    !matches!(
                        m.submission,
                        Submission::Retired {
                            retirement: Retirement::NotSubmitted
                        }
                    ),
                    "{mid}: submitted retired as not-submitted"
                );
            }
        }
    }
    // A certified grant has every start-capable request terminal, and nothing
    // can start under a revoked grant afterwards.
    for (gid, g) in &state.grants {
        if g.certificate.is_some() {
            assert!(g.revoked.is_some(), "{gid} certified without revocation");
            for m in state.mutations_of_grant(gid) {
                if m.record.verb.can_start_process() {
                    assert!(
                        m.submission.is_terminal(),
                        "{gid}: pending start after certificate"
                    );
                }
            }
        }
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 128, ..ProptestConfig::default() })]

    #[test]
    fn invariants_replay_truncation_and_compaction(ops in prop::collection::vec(op(), 1..120), cut in any::<u16>()) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("node.journal");
        let mut j = Journal::create(&path, "test").unwrap();
        let mut boundaries = vec![(j.len_bytes(), j.state().clone())];
        j.append(identity(1)).unwrap();
        boundaries.push((j.len_bytes(), j.state().clone()));
        j.append(started(INCARNATION)).unwrap();
        boundaries.push((j.len_bytes(), j.state().clone()));
        let mut model = Model { epoch: 1, ..Model::default() };
        let mut generations = BTreeMap::new();
        for op in &ops {
            let Some(record) = model.record(op, j.state()) else { continue };
            let prev = j.state().clone();
            if j.append(record).is_ok() {
                check_invariants(j.state(), &prev, &mut generations);
                boundaries.push((j.len_bytes(), j.state().clone()));
            } else {
                prop_assert_eq!(j.state(), &prev, "a refused record changed state");
            }
        }
        let final_state = j.state().clone();
        drop(j);

        // Replay reproduces the exact fold.
        let (reopened, _) = Journal::open(&path).unwrap();
        prop_assert_eq!(reopened.state(), &final_state);
        drop(reopened);

        // Truncating anywhere leaves exactly the last complete prefix; a cut
        // inside the format record leaves no journal at all, which is refused.
        let bytes = std::fs::read(&path).unwrap();
        let format_end = boundaries[0].0;
        let at = u64::from(cut) % (bytes.len() as u64 + 1);
        let torn = dir.path().join("torn.journal");
        std::fs::write(&torn, &bytes[..usize::try_from(at).unwrap()]).unwrap();
        match boundaries.iter().rev().find(|(end, _)| *end <= at) {
            Some((_, expected)) => {
                let (t, _) = Journal::open(&torn).unwrap();
                prop_assert_eq!(t.state(), expected);
            }
            None => {
                prop_assert!(at < format_end);
                prop_assert!(Journal::open(&torn).is_err());
            }
        }

        // Compaction keeps every obligation: the same probes are accepted or
        // refused before and after.
        let (j, _) = Journal::open(&path).unwrap();
        let (compacted, _) = j.compact(CompactionPolicy::default(), "test").unwrap();
        let after = compacted.state().clone();
        for slot in [slot(0), slot(1)] {
            prop_assert_eq!(after.slot_blockers(&slot), final_state.slot_blockers(&slot));
            prop_assert_eq!(after.generation_high_water(&slot), final_state.generation_high_water(&slot));
        }
        let probe_generation = model.generation + 1;
        for exclusive in [true, false] {
            for s in 0..2 {
                let probe = grant("probe", s, probe_generation, model.epoch, exclusive);
                prop_assert_eq!(
                    final_state.check(&probe).is_ok(),
                    after.check(&probe).is_ok(),
                    "grant probe on slot {} differs after compaction", s
                );
            }
        }
        for m in &model.mutations {
            for probe in [submitted(m), settled(m, EngineOutcome::Started)] {
                let live_before = final_state
                    .mutations
                    .get(&id::<MutationId>(m))
                    .and_then(|x| x.record.grant_id.clone())
                    .is_some_and(|g| !final_state.grants[&g].is_released());
                if live_before {
                    prop_assert_eq!(final_state.check(&probe).is_ok(), after.check(&probe).is_ok());
                }
            }
        }
        drop(compacted);
        let (again, _) = Journal::open(&path).unwrap();
        prop_assert_eq!(again.state(), &after);
    }
}
