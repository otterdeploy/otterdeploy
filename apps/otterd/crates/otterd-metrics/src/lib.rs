//! Host and container metrics for otterd.
//!
//! A [`Collector`] produces one round of `otterd_proto` metric samples per
//! call: host CPU, load, memory (with cache and ZFS ARC) and swap; up to
//! [`MAX_NODE_DIMENSIONS`] filesystem, disk and interface series; and CPU,
//! memory, network and health for every running container that has a
//! control-plane subject. The caller owns cadence: the control plane asks
//! for a round on its history tick and, while someone is watching, on a
//! faster live tick.
//!
//! Design notes, ported from Beszel's node collector by design rather than code:
//! - a value that cannot be measured is `null`, never zero, and rates need
//!   two readings, so the first round has none;
//! - counters that go backwards (a reset or a restarted container) produce no
//!   rate for that round;
//! - container figures come from cgroup v2 files, with the Engine API
//!   (through `otterd_engine::DockerClient`) used only to list running
//!   containers, and that list reused for up to 10 s;
//! - the per-node dimension bound is applied at the source.

mod bound;
mod collector;
mod container;
mod host;
mod paths;
mod rate;
mod reading;
mod samples;

pub use collector::{Collector, Round};
pub use container::{ContainerCollector, DEFAULT_LIST_MAX_AGE, DockerError, RESOURCE_LABEL};
pub use host::HostCollector;
pub use otterd_proto::metrics::MAX_NODE_DIMENSIONS;
pub use paths::HostPaths;
pub use samples::{
    ContainerRef, ContainerSubject, METRIC_SCHEMA_VERSION, RoundTiming, SampleContext,
};
