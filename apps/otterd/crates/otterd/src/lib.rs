//! The otterd daemon: boot quarantine, grant admission, positive stop
//! certificates, barrier retirement, capability-checked command dispatch, a
//! progress-tied watchdog and a root-only local control socket.

pub mod api;
pub mod container;
pub mod dispatch;
pub mod lifecycle;
pub mod watchdog;

pub use dispatch::{Answer, Dispatcher, Session};
pub use lifecycle::{LifecycleConfig, Node, NodeError, TenantGate};
pub use watchdog::Progress;
