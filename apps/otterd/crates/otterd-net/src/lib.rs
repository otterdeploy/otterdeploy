//! The otterd node network layer.
//!
//! Everything a node needs so that workloads on different nodes reach each
//! other by policy and nothing else: the fleet address plan, the WireGuard
//! mesh, the packet-path policy rendered as nftables, firewall persistence and
//! the stable service addresses (VIPs) with their resolver.
//!
//! The pure parts (planning, rendering, state machines) are platform
//! independent and unit tested; the parts that touch the kernel live behind
//! small traits so they can be exercised on real hosts.

pub mod addr;
pub mod cmd;
pub mod firewall;
pub mod ids;
pub mod integrations;
pub mod ipam;
pub mod mesh;
pub mod policy;
pub mod rotation;

pub use addr::Ipv4Net;
