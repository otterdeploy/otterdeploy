//! The wire and data contract between otterd and the otterdeploy control plane.
//!
//! Everything both sides must agree on lives here and nowhere else: frames on
//! the control and bulk channels, signed envelopes and capabilities, command
//! payloads and outcomes, the ServiceSpec and its defaults, node identity,
//! leases, discovery documents, health and metric frames, and the node journal
//! record schema. `packages/otterd-proto` mirrors the control-plane-facing parts
//! in TypeScript; both sides test against the shared fixtures in `fixtures/`.
//!
//! Design notes and the reasoning behind each message are in
//! `docs/designs/otterd-contract.md`.

pub mod bulk;
pub mod capability;
pub mod channel;
pub mod command;
pub mod discovery;
pub mod envelope;
pub mod health;
pub mod identity;
pub mod ids;
pub mod journal;
pub mod lifecycle;
pub mod metrics;
pub mod num;
pub mod spec;
pub mod version;

pub use envelope::{PublicKey, SignContext, SignedEnvelope};
pub use num::U53;
