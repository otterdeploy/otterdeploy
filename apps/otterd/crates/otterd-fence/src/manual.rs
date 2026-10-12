//! Verified manual fence: an operator's out-of-band proof that a machine is
//! off, for hosts without a fence API (bare metal, other providers).
//!
//! This is an explicit trust assertion, recorded as such, never typing a
//! hostname into a box. [`ManualFence::verify`] accepts a proof only when:
//!
//! * it answers the single-use challenge issued when this fence began, within
//!   its window (a stale or replayed proof cannot unlock a later fence);
//! * it names the bound machine by its provider server id (and machine id when
//!   one was recorded), copied from the provider or the host, not from a label;
//! * it carries a method and an external reference (provider action, BMC
//!   event, ticket) and the authenticated operator who asserts it;
//! * the node has had no authenticated contact since before the claimed
//!   power-off time, and has been silent for at least the minimum silence:
//!   a node that spoke after "it was off" contradicts the proof.
//!
//! The control plane is responsible for the operator being an install admin
//! after step-up; this module checks the proof itself.

use crate::{FenceError, FenceEvidence, MachineBinding, Observation, new_evidence_id};
use otterd_proto::U53;
use otterd_proto::lifecycle::BarrierMethod;
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// How the operator established the machine is off.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProofMethod {
    /// Hard power-off in a provider console, with its action/event id.
    ProviderConsole,
    /// BMC/IPMI power-off, with its event log id.
    Bmc,
    /// Power or network physically disconnected.
    PhysicalDisconnect,
    /// The machine was destroyed or returned to the provider.
    Decommissioned,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualProof {
    /// Authenticated install admin asserting the proof.
    pub asserted_by: String,
    pub method: ProofMethod,
    /// Provider action id, BMC event id or ticket reference.
    pub reference: String,
    /// Provider server id as shown by the provider or the BMC.
    pub server_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub machine_id: Option<String>,
    pub observed_off_at_unix_ms: U53,
    /// The challenge shown when the fence began.
    pub challenge: String,
}

/// The node's authenticated-contact history, from the control plane.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Silence {
    /// Last authenticated message from the node (control session or peer answer).
    pub last_contact_unix_ms: U53,
    pub now_unix_ms: U53,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualFence {
    challenge: String,
    issued_at_unix_ms: U53,
    /// How long a challenge stays answerable.
    pub window: Duration,
    /// How long the node must have been silent.
    pub min_silence: Duration,
}

/// Default minimum silence before a manual proof is accepted.
pub const DEFAULT_MIN_SILENCE: Duration = Duration::from_secs(60);
/// Default challenge lifetime.
pub const DEFAULT_WINDOW: Duration = Duration::from_secs(60 * 60);

fn millis(d: Duration) -> u64 {
    u64::try_from(d.as_millis()).unwrap_or(u64::MAX)
}

impl ManualFence {
    /// Begin a manual fence: mint the single-use challenge the operator must
    /// return with the proof.
    pub fn begin(now_unix_ms: U53) -> Result<Self, FenceError> {
        let code = otterd_proto::ids::random_hex::<6>()
            .map_err(|e| FenceError::Unavailable(format!("rng: {e}")))?;
        Ok(Self {
            challenge: code,
            issued_at_unix_ms: now_unix_ms,
            window: DEFAULT_WINDOW,
            min_silence: DEFAULT_MIN_SILENCE,
        })
    }

    #[must_use]
    pub fn challenge(&self) -> &str {
        &self.challenge
    }

    /// Check the proof; on success return evidence recorded as a manual fence.
    pub fn verify(
        &self,
        binding: &MachineBinding,
        proof: &ManualProof,
        silence: Silence,
    ) -> Result<FenceEvidence, FenceError> {
        let refuse = |why: &str| Err(FenceError::ProofRefused(why.to_owned()));
        let now = silence.now_unix_ms;
        if proof.challenge != self.challenge {
            return refuse("the challenge does not match this fence");
        }
        if now.get()
            > self
                .issued_at_unix_ms
                .get()
                .saturating_add(millis(self.window))
        {
            return refuse("the challenge expired; begin the fence again");
        }
        if proof.asserted_by.trim().is_empty() {
            return refuse("no operator is named");
        }
        if proof.reference.trim().len() < 4 {
            return refuse("an external reference (action, event or ticket id) is required");
        }
        if proof.server_id != binding.server_id {
            return refuse("the proof names another machine");
        }
        if let (Some(want), Some(got)) = (&binding.machine_id, &proof.machine_id)
            && want != got
        {
            return refuse("the proof names another machine id");
        }
        if proof.observed_off_at_unix_ms > now {
            return refuse("the power-off time is in the future");
        }
        if silence.last_contact_unix_ms > proof.observed_off_at_unix_ms {
            return refuse("the node made authenticated contact after the claimed power-off");
        }
        if now.get().saturating_sub(silence.last_contact_unix_ms.get()) < millis(self.min_silence) {
            return refuse("the node has not been silent long enough");
        }
        Ok(FenceEvidence {
            evidence_id: new_evidence_id("manual")?,
            method: BarrierMethod::ManualFence,
            adapter: "manual".into(),
            binding: binding.clone(),
            requested_at_unix_ms: self.issued_at_unix_ms,
            reference: proof.reference.clone(),
            asserted_by: Some(proof.asserted_by.clone()),
            observations: vec![Observation {
                at_unix_ms: proof.observed_off_at_unix_ms,
                status: "off (operator assertion)".into(),
            }],
            verified_off_at_unix_ms: proof.observed_off_at_unix_ms,
            detail: serde_json::json!({
                "proof": proof,
                "lastContactUnixMs": silence.last_contact_unix_ms,
                "trust": "manual assertion",
            }),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(v: u64) -> U53 {
        U53::new(v).unwrap()
    }

    fn binding() -> MachineBinding {
        MachineBinding {
            provider: "manual".into(),
            server_id: "rack4-node7".into(),
            created_at: "2026-01-01T00:00:00Z".into(),
            require_labels: std::collections::BTreeMap::default(),
            machine_id: Some("4f0c".into()),
        }
    }

    fn proof(f: &ManualFence) -> ManualProof {
        ManualProof {
            asserted_by: "user_admin".into(),
            method: ProofMethod::Bmc,
            reference: "SEL-0042".into(),
            server_id: "rack4-node7".into(),
            machine_id: Some("4f0c".into()),
            observed_off_at_unix_ms: u(1_000_000),
            challenge: f.challenge().to_owned(),
        }
    }

    const SILENT: Silence = Silence {
        last_contact_unix_ms: U53::from_const(900_000),
        now_unix_ms: U53::from_const(1_100_000),
    };

    #[test]
    fn accepts_a_complete_proof_as_a_manual_assertion() {
        let f = ManualFence::begin(u(950_000)).unwrap();
        let ev = f.verify(&binding(), &proof(&f), SILENT).unwrap();
        assert_eq!(ev.method, BarrierMethod::ManualFence);
        assert_eq!(ev.asserted_by.as_deref(), Some("user_admin"));
        let barrier = ev.barrier(u(3), None);
        assert_eq!(barrier.provider_action_id, None);
        assert_eq!(barrier.observed_at_unix_ms, u(1_000_000));
    }

    #[test]
    fn refuses_incomplete_or_contradicted_proofs() {
        let f = ManualFence::begin(u(950_000)).unwrap();
        let check = |mutate: &dyn Fn(&mut ManualProof), silence: Silence| {
            let mut p = proof(&f);
            mutate(&mut p);
            f.verify(&binding(), &p, silence).unwrap_err().to_string()
        };
        assert!(check(&|p| p.challenge = "nope".into(), SILENT).contains("challenge"));
        assert!(check(&|p| p.server_id = "rack4-node8".into(), SILENT).contains("another machine"));
        assert!(check(&|p| p.machine_id = Some("beef".into()), SILENT).contains("machine id"));
        assert!(check(&|p| p.reference = "x".into(), SILENT).contains("reference"));
        assert!(check(&|p| p.asserted_by = " ".into(), SILENT).contains("operator"));
        // The node spoke after the claimed power-off.
        let spoke = Silence {
            last_contact_unix_ms: u(1_050_000),
            now_unix_ms: u(1_100_000),
        };
        assert!(check(&|_| {}, spoke).contains("after the claimed power-off"));
        // Not silent for long enough yet.
        let recent = Silence {
            last_contact_unix_ms: u(1_000_000),
            now_unix_ms: u(1_030_000),
        };
        assert!(check(&|p| p.observed_off_at_unix_ms = u(1_000_000), recent).contains("silent"));
        // The challenge expired.
        let late = Silence {
            last_contact_unix_ms: u(900_000),
            now_unix_ms: u(950_000 + 3_600_001),
        };
        assert!(check(&|_| {}, late).contains("expired"));
    }
}
