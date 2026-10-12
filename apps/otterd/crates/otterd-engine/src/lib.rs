//! Docker Engine adapter with journalled `NotSubmitted → Submitted → Settled`
//! mutations.
//!
//! The rule this crate exists to enforce: a request that crossed the Engine
//! boundary without a definitive answer is `Submitted` and stays so. Inspect,
//! cgroup observation, timeouts and daemon restarts are evidence for cleanup,
//! never a terminal outcome.

mod adapter;
mod docker;
mod handle;

pub use adapter::{
    AdapterError, Classification, ContainerView, EngineAdapter, EngineOp, LABEL_ATTEMPT,
    LABEL_CLASS, LABEL_GRANT, LABEL_MANAGED, LABEL_NODE, LABEL_SLOT, MutationSpec, SubmitResult,
    classify, engine_incarnation, object_name, payload_hash, view_from_inspect,
};
pub use docker::{
    DockerClient, EngineResponse, MAX_RESPONSE_BYTES, TransportError, VersionInfo, urlencode,
};
pub use handle::{HandleError, JournalHandle};
