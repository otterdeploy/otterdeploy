//! The otterd probe executor.
//!
//! - [`admission`]: worst-case weighted admission with a reserved control
//!   pool and a phased calendar, so admitted checks cannot overrun the
//!   executor even when every target times out.
//! - [`outcome`]: what an attempt and a round mean. Target failures are
//!   votes; an executor that could not take or qualify a measurement
//!   reports Unknown, and a check that cannot run as configured reports a
//!   configuration error. Neither is ever counted as the target failing.
//! - [`wire`]: the boundary to `otterd_proto::health`.

pub mod admission;
pub mod outcome;
pub mod wire;

pub use admission::{Admission, Admitted, Pool, Profile, RoundSpec};
pub use outcome::{Attempt, HealthState, RoundOutcome, fold};
