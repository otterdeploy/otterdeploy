//! The otterd daemon: boot quarantine, grant admission, positive stop
//! certificates, barrier retirement, capability-checked command dispatch, a
//! progress-tied watchdog, a root-only local control socket, and the daemon's
//! side of the control-plane session.

pub mod api;
pub mod container;
pub mod dispatch;
pub mod keys;
pub mod lifecycle;
pub mod platform;
pub mod session;
pub mod upgrade;
pub mod watchdog;

pub use dispatch::{Answer, Dispatcher, Session};
pub use lifecycle::{LifecycleConfig, Node, NodeError, TenantGate};
pub use watchdog::Progress;
