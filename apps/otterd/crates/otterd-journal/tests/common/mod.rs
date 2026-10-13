//! Builders shared by the journal tests.
#![allow(
    dead_code,
    unreachable_pub,
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::missing_panics_doc
)]

use ed25519_dalek::SigningKey;
use otterd_journal::NodeState;
use otterd_proto::U53;
use otterd_proto::envelope::{PublicKey, SignContext, SignedEnvelope};
use otterd_proto::identity::{HostBinding, TrustedKey};
use otterd_proto::ids::{ContainerRef, GrantId, Sha256Hex, SlotRef};
use otterd_proto::journal::{EngineOutcome, MutationRecord, Record, WorkloadClass};
use otterd_proto::lifecycle::{
    ContainerObservation, EngineVerb, ProcessObservation, SlotGrant, StopCertificate,
};
use otterd_proto::spec::{DisconnectAction, RestartPolicy};

pub fn id<T: std::str::FromStr>(s: &str) -> T
where
    T::Err: std::fmt::Debug,
{
    s.parse().unwrap()
}

pub fn u(v: u64) -> U53 {
    U53::new(v).unwrap()
}

pub fn digest() -> Sha256Hex {
    Sha256Hex::digest(b"x")
}

pub fn node_key() -> SigningKey {
    SigningKey::from_bytes(&[2; 32])
}

pub fn public(seed: u8) -> PublicKey {
    PublicKey::from_verifying_key(&SigningKey::from_bytes(&[seed; 32]).verifying_key())
}

pub const INCARNATION: &str = "inc_00000000000000000000000000000001";

pub fn identity(epoch: u64) -> Record {
    Record::Identity {
        install_id: id("inst"),
        node_id: id("node-a"),
        node_epoch: u(epoch),
        key_epoch: u(1),
        identity_key_id: public(2).key_id(),
        cp_keys: vec![TrustedKey {
            key: public(1),
            epoch: u(1),
            not_after_unix_ms: None,
        }],
        recovery_key: public(3),
        host: HostBinding {
            machine_id: "m".into(),
            product_uuid: None,
            provider: None,
        },
    }
}

pub fn started(incarnation: &str) -> Record {
    Record::ProcessStarted {
        incarnation: id(incarnation),
        boot_id: id("boot-1"),
    }
}

pub fn slot(index: u32) -> SlotRef {
    SlotRef::new(id("db"), index)
}

pub fn grant(
    grant_id: &str,
    slot_index: u32,
    generation: u64,
    epoch: u64,
    exclusive: bool,
) -> Record {
    Record::GrantAccepted {
        grant: SlotGrant {
            grant_id: id(grant_id),
            slot: slot(slot_index),
            generation: u(generation),
            authority_term: u(1),
            node_epoch: u(epoch),
            incarnation: id(INCARNATION),
            exclusive,
            disconnect_action: DisconnectAction::Stop,
            restart: RestartPolicy::default(),
            data_claims: vec![],
            probe_only: false,
            adopts_attempt: None,
            adopts_container: None,
            network: None,
        },
        spec_digest: digest(),
        op_id: id(&format!("op-{grant_id}")),
    }
}

pub fn attempt(grant_id: &str, attempt: &str, ordinal: u32) -> Record {
    Record::AttemptBegun {
        grant_id: id(grant_id),
        attempt_id: id(attempt),
        ordinal,
        reason: otterd_proto::journal::AttemptReason::Initial,
    }
}

pub fn intent(
    mutation: &str,
    grant_id: &str,
    slot_index: u32,
    attempt: &str,
    verb: EngineVerb,
) -> Record {
    Record::MutationIntent {
        mutation: MutationRecord {
            mutation_id: id(mutation),
            class: WorkloadClass::Tenant,
            slot: slot(slot_index),
            grant_id: Some(id(grant_id)),
            attempt_id: id(attempt),
            verb,
            object_name: format!("od-{attempt}"),
            container: None,
            payload_hash: digest(),
        },
    }
}

pub fn submitted(mutation: &str) -> Record {
    Record::MutationSubmitted {
        mutation_id: id(mutation),
        boot_id: id("boot-1"),
        incarnation: id(INCARNATION),
        engine_incarnation: "29.9.0/pid:1".into(),
    }
}

pub fn settled(mutation: &str, outcome: EngineOutcome) -> Record {
    Record::MutationSettled {
        mutation_id: id(mutation),
        outcome,
    }
}

pub fn revoked(grant_id: &str) -> Record {
    Record::GrantRevoked {
        grant_id: id(grant_id),
        reason: "stop".into(),
    }
}

/// A certificate exactly matching what the journal knows about `grant`.
pub fn certificate(state: &NodeState, grant_id: &str) -> Record {
    let gid: GrantId = id(grant_id);
    let g = &state.grants[&gid];
    let containers: Vec<ContainerObservation> = state
        .containers_of_grant(&gid)
        .map(|c: &ContainerRef| ContainerObservation {
            retained: false,
            container: c.clone(),
            process: ProcessObservation::Exited { exit_code: 0 },
        })
        .collect();
    let cert = StopCertificate {
        install_id: id("inst"),
        node_id: id("node-a"),
        node_epoch: g.grant.node_epoch,
        slot: g.grant.slot.clone(),
        grant_id: gid.clone(),
        op_id: id("op-stop"),
        attempt_ids: g.attempts.clone(),
        containers,
        cgroups_empty: true,
        mutation_inventory_digest: state.mutation_inventory_digest(&gid),
        mutation_count: u32::try_from(state.mutations_of_grant(&gid).count()).unwrap(),
        boot_id: id("boot-1"),
        issued_at_unix_ms: u(1),
    };
    Record::StopCertified {
        grant_id: gid,
        certificate: SignedEnvelope::sign(&node_key(), SignContext::StopCertificate, &cert)
            .unwrap(),
    }
}
