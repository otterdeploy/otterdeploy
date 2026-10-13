//! Bridge-guard reconciliation: which host veth belongs to which container interface.
//!
//! A container's host-side veth is found from inside its network namespace (`ip -o link` shows
//! `eth0@ifN`, where N is the host veth's ifindex). Reading `/sys/class/net/*/iflink` under
//! `nsenter -n` shows the host namespace and gives wrong answers.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use crate::cmd::{CmdError, Runner};
use crate::docker::ContainerIface;
use crate::policy::{IfacePattern, Mac, VethGuard};

/// Host interfaces by ifindex, with the bridge each is enslaved to.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HostLinks {
    by_index: BTreeMap<u32, (String, Option<String>)>,
}

impl HostLinks {
    /// Reads `/sys/class/net` (host namespace).
    ///
    /// # Errors
    /// The directory cannot be read.
    pub fn read(sys_class_net: &Path) -> std::io::Result<Self> {
        let mut by_index = BTreeMap::new();
        for entry in fs::read_dir(sys_class_net)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let Ok(idx) = fs::read_to_string(entry.path().join("ifindex")) else {
                continue;
            };
            let Ok(idx) = idx.trim().parse::<u32>() else {
                continue;
            };
            let master = fs::read_link(entry.path().join("master"))
                .ok()
                .and_then(|p| p.file_name().map(|f| f.to_string_lossy().into_owned()));
            by_index.insert(idx, (name, master));
        }
        Ok(Self { by_index })
    }

    /// From explicit entries (tests).
    #[must_use]
    pub fn from_entries(entries: impl IntoIterator<Item = (u32, String, Option<String>)>) -> Self {
        Self {
            by_index: entries.into_iter().map(|(i, n, m)| (i, (n, m))).collect(),
        }
    }

    /// Name and master bridge of an ifindex.
    #[must_use]
    pub fn get(&self, index: u32) -> Option<(&str, Option<&str>)> {
        self.by_index
            .get(&index)
            .map(|(n, m)| (n.as_str(), m.as_deref()))
    }
}

/// Peer ifindex per MAC, parsed from `ip -o link` run inside a container's namespace.
#[must_use]
pub fn parse_netns_links(text: &str) -> BTreeMap<Mac, u32> {
    let mut out = BTreeMap::new();
    for line in text.lines() {
        let mut fields = line.split_whitespace();
        let Some(name) = fields.nth(1) else { continue };
        let Some((_, peer)) = name.trim_end_matches(':').split_once("@if") else {
            continue;
        };
        let Ok(peer) = peer.parse::<u32>() else {
            continue;
        };
        let words: Vec<&str> = line.split_whitespace().collect();
        let Some(mac) = words.windows(2).find_map(|w| match w {
            ["link/ether", mac] => mac.parse::<Mac>().ok(),
            _ => None,
        }) else {
            continue;
        };
        out.insert(mac, peer);
    }
    out
}

/// Builds the guard entries for every container interface that sits on a managed bridge.
/// Interfaces whose veth cannot be resolved are skipped: they stay under the default drop, and
/// one unreadable container never fails the pass.
pub fn resolve_veths<R: Runner>(
    runner: &R,
    ifaces: &[ContainerIface],
    host: &HostLinks,
    bridges: &IfacePattern,
) -> Vec<VethGuard> {
    let mut by_pid: BTreeMap<u32, Vec<&ContainerIface>> = BTreeMap::new();
    for i in ifaces {
        by_pid.entry(i.pid).or_default().push(i);
    }
    let mut out = Vec::new();
    for (pid, list) in by_pid {
        let ns = format!("--net=/proc/{pid}/ns/net");
        let links = match netns_links(runner, &ns) {
            Ok(l) => l,
            Err(e) => {
                tracing::debug!(pid, error = %e, "container namespace unreadable; its interfaces stay guarded by the default drop");
                continue;
            }
        };
        for i in list {
            let Some(peer) = links.get(&i.mac) else {
                continue;
            };
            let Some((veth, Some(master))) = host.get(*peer) else {
                continue;
            };
            if !bridges.matches(master) {
                continue;
            }
            out.push(VethGuard {
                veth: veth.to_owned(),
                mac: i.mac,
                ip: i.ip,
                label: i.name.clone(),
            });
        }
    }
    out.sort();
    out
}

fn netns_links<R: Runner>(runner: &R, ns: &str) -> Result<BTreeMap<Mac, u32>, CmdError> {
    let out = runner.ok("nsenter", &[ns, "ip", "-o", "link", "show"], None)?;
    Ok(parse_netns_links(&out.stdout))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cmd::fake::Fake;
    use std::net::Ipv4Addr;

    const NS: &str = "1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000\\    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00\n\
27: eth0@if28: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1400 qdisc noqueue state UP mode DEFAULT group default \\    link/ether 02:42:ac:18:00:02 brd ff:ff:ff:ff:ff:ff link-netnsid 0\n\
29: eth1@if30: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP mode DEFAULT group default \\    link/ether 02:42:ac:11:00:05 brd ff:ff:ff:ff:ff:ff link-netnsid 0\n";

    #[test]
    fn netns_listing_maps_mac_to_peer_index() {
        let m = parse_netns_links(NS);
        assert_eq!(m.len(), 2);
        assert_eq!(m[&"02:42:ac:18:00:02".parse().unwrap()], 28);
    }

    #[test]
    fn only_interfaces_on_managed_bridges_are_guarded() {
        let fake = Fake::new().on("nsenter --net=/proc/42/ns/net", 0, NS);
        let host = HostLinks::from_entries([
            (28, "veth9a".to_owned(), Some("otb-a".to_owned())),
            (30, "veth9b".to_owned(), Some("docker0".to_owned())),
        ]);
        let ifaces = vec![
            ContainerIface {
                name: "web".into(),
                pid: 42,
                network: "a".into(),
                mac: "02:42:ac:18:00:02".parse().unwrap(),
                ip: Ipv4Addr::new(172, 24, 0, 2),
            },
            ContainerIface {
                name: "web".into(),
                pid: 42,
                network: "bridge".into(),
                mac: "02:42:ac:11:00:05".parse().unwrap(),
                ip: Ipv4Addr::new(172, 17, 0, 5),
            },
        ];
        let g = resolve_veths(&fake, &ifaces, &host, &IfacePattern::new("otb-*").unwrap());
        assert_eq!(g.len(), 1);
        assert_eq!(
            (g[0].veth.as_str(), g[0].ip),
            ("veth9a", Ipv4Addr::new(172, 24, 0, 2))
        );
    }
}
