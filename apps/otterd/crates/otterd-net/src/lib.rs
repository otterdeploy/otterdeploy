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
pub mod agent;
pub mod cmd;
pub mod conntrack;
pub mod docker;
pub mod firewall;
pub mod guard;
pub mod ids;
pub mod integrations;
pub mod ipam;
pub mod mesh;
#[cfg(target_os = "linux")]
pub mod netlink;
pub mod policy;
pub mod rotation;
pub mod vip;

pub use addr::Ipv4Net;
