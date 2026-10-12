//! otterd's durable node journal: the node's only trusted ownership inventory.
//!
//! It records, in order and fsynced before the side effect each one authorizes
//! (record schema: [`otterd_proto::journal`]):
//!
//! * node identity, epoch and keys (re-enrollment raises the epoch, superseding
//!   every grant of the old one);
//! * every process start, which re-enters boot quarantine;
//! * operation claims (`opId + payloadHash`) and their outcomes;
//! * grants, their attempts and their durable revocation;
//! * every Engine mutation as `NotSubmitted → Submitted → Settled | Retired`;
//!   `Submitted` is written *before* the request is sent and
//!   leaves that state only through a definitive Engine response or a validated
//!   external barrier;
//! * positive stop certificates;
//! * retained mount holds;
//! * the platform boot manifest and update phases;
//! * durable high-water marks.
//!
//! Losing the journal is recovery, not a restart: there is no reconstruction of
//! start authority from Docker labels.

mod compact;
mod log;
mod state;

pub use compact::{CompactionPolicy, CompactionReport};
pub use log::{Journal, JournalError, OpenReport, now_unix_ms};
pub use state::{
    ActiveManifest, AttemptState, Blocker, GrantState, HighWaterKey, HoldPhase, HoldState,
    IdentityState, MutationState, NodeState, OpState, Revocation, Submission, SubmittedInfo,
    TransitionError, UpdateState,
};
