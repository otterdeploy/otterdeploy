//! The otterd daemon: boot quarantine, grant admission, positive stop
//! certificates, barrier retirement and a progress-tied watchdog.

pub mod container;
pub mod lifecycle;
pub mod watchdog;

pub use lifecycle::{LifecycleConfig, Node, NodeError, TenantGate};
pub use watchdog::Progress;
