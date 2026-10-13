//! `otterd-dns`: the scoped service-name responder.
//!
//! A separate process from the network reconciler: it serves a zone that otterd persists,
//! so a frozen or restarting reconciler does not take name resolution with it. VIP answers are
//! constants per service; round-robin (dnsrr) answers carry the owner-freshness expiry otterd
//! computed, and expired records are dropped (NODATA) rather than served stale.
//!
//! Each environment has its own listener address; the view is chosen by the destination address
//! the query arrived on (never by the source alone). Answers:
//!
//! | Situation | Answer |
//! |---|---|
//! | no valid zone yet (no authenticated bootstrap) | SERVFAIL |
//! | known VIP name, A | the VIP, TTL 5, even with zero backends |
//! | known dnsrr name, A | unexpired backend addresses, TTL ≤ 5; none left → NODATA |
//! | known name, other type | NODATA |
//! | unknown name inside a managed zone | NXDOMAIN, SOA negative TTL 5 |
//! | name outside the managed zones | forwarded to the host's upstream resolvers |

pub mod wire;
pub mod zone;

/// The systemd unit for the responder: its own failure domain, restarted by the watchdog,
/// never latched by a start limit.
#[must_use]
pub fn render_unit(binary: &str, zone_file: &str, listeners: &[std::net::Ipv4Addr]) -> String {
    let listen: Vec<String> = listeners.iter().map(ToString::to_string).collect();
    let listen = listen.join(",");
    format!(
        "[Unit]\n\
         Description=otterd service-name responder\n\
         After=network-online.target otterd-firewall.service\n\
         Wants=network-online.target\n\
         StartLimitIntervalSec=0\n\
         \n\
         [Service]\n\
         Type=notify\n\
         NotifyAccess=main\n\
         WatchdogSec=10\n\
         Restart=always\n\
         RestartSec=1\n\
         ExecStart={binary} {zone_file} --listen {listen}\n\
         AmbientCapabilities=CAP_NET_BIND_SERVICE\n\
         CapabilityBoundingSet=CAP_NET_BIND_SERVICE\n\
         NoNewPrivileges=yes\n\
         ProtectSystem=strict\n\
         ProtectHome=yes\n\
         PrivateTmp=yes\n\
         \n\
         [Install]\n\
         WantedBy=multi-user.target\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_binds_listeners_up_front_and_never_latches() {
        let u = render_unit(
            "/usr/lib/otterd/otterd-dns",
            "/var/lib/otterd/dns/zone.json",
            &[
                "172.30.228.1".parse().unwrap(),
                "172.30.228.2".parse().unwrap(),
            ],
        );
        assert!(u.contains(
            "ExecStart=/usr/lib/otterd/otterd-dns /var/lib/otterd/dns/zone.json --listen 172.30.228.1,172.30.228.2\n"
        ));
        for line in [
            "StartLimitIntervalSec=0",
            "Type=notify",
            "WatchdogSec=10",
            "Restart=always",
        ] {
            assert!(u.contains(line), "{line}");
        }
    }
}
