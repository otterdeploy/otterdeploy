//! `/proc/net/dev` for the host's own interfaces.

/// Interfaces that are per-container plumbing or loopback. Container traffic
/// is reported per container, so counting its veth and bridge again would
/// double it and spend the dimension budget on churn.
const SKIP_PREFIXES: &[&str] = &[
    "veth", "docker", "br-", "virbr", "cni", "flannel", "cali", "vxlan", "tunl",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct InterfaceCounters {
    pub(crate) name: String,
    pub(crate) rx_bytes: u64,
    pub(crate) tx_bytes: u64,
    pub(crate) rx_errors: u64,
    pub(crate) tx_errors: u64,
}

/// Every interface line of `/proc/net/dev`, including skipped ones.
pub(crate) fn parse_net_dev(text: &str) -> Vec<InterfaceCounters> {
    text.lines()
        .filter_map(|line| {
            let (name, rest) = line.split_once(':')?;
            let f: Vec<u64> = rest
                .split_ascii_whitespace()
                .map(str::parse)
                .collect::<Result<_, _>>()
                .ok()?;
            Some(InterfaceCounters {
                name: name.trim().to_string(),
                rx_bytes: *f.first()?,
                rx_errors: *f.get(2)?,
                tx_bytes: *f.get(8)?,
                tx_errors: *f.get(10)?,
            })
        })
        .collect()
}

/// Whether an interface is the host's own (physical, bond, VLAN, mesh tunnel)
/// rather than loopback or container plumbing.
pub(crate) fn is_host_interface(name: &str) -> bool {
    name != "lo" && !SKIP_PREFIXES.iter().any(|p| name.starts_with(p))
}

/// Sum of a network namespace's traffic, without loopback: a container's view.
pub(crate) fn namespace_totals(text: &str) -> (u64, u64) {
    parse_net_dev(text)
        .iter()
        .filter(|i| i.name != "lo")
        .fold((0, 0), |(rx, tx), i| {
            (rx.saturating_add(i.rx_bytes), tx.saturating_add(i.tx_bytes))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    const NET_DEV: &str = "Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo:  1000      10    0    0    0     0          0         0     1000      10    0    0    0     0       0          0
  eth0: 500000   400    2    0    0     0          0         0   300000     300    1    0    0     0       0          0
veth1a2b:  700     7    0    0    0     0          0         0      900       9    0    0    0     0       0          0
   wg0:  1200     12    0    0    0     0          0         0     2400      24    0    0    0     0       0          0
";

    #[test]
    fn parses_counters() {
        let ifs = parse_net_dev(NET_DEV);
        assert_eq!(ifs.len(), 4);
        let eth0 = &ifs[1];
        assert_eq!(
            (eth0.rx_bytes, eth0.tx_bytes, eth0.rx_errors, eth0.tx_errors),
            (500_000, 300_000, 2, 1)
        );
    }

    #[test]
    fn keeps_physical_and_mesh_interfaces_only() {
        let kept: Vec<String> = parse_net_dev(NET_DEV)
            .into_iter()
            .filter(|i| is_host_interface(&i.name))
            .map(|i| i.name)
            .collect();
        assert_eq!(kept, ["eth0", "wg0"]);
    }

    #[test]
    fn namespace_totals_skip_loopback() {
        assert_eq!(namespace_totals(NET_DEV), (501_900, 303_300));
    }
}
