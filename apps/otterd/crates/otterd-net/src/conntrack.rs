//! Conntrack withdrawal on revocation: a revoked pair loses its rules and its established
//! conntrack entries together.
//!
//! The policy has no blanket established accept, so a revoked pair already stops carrying
//! packets; deleting the entries removes the dead state at once instead of at its timeout, and
//! retransmissions do not re-create it (dropped packets never confirm an entry).

use std::collections::BTreeSet;
use std::net::Ipv4Addr;
use std::time::Duration;

use crate::addr::Ipv4Net;
use crate::cmd::{CmdError, Runner};
use crate::policy::NodePolicy;

/// Directed pairs present in `old` and absent from `new`, host-principal pairs included.
#[must_use]
pub fn revoked(old: &NodePolicy, new: &NodePolicy) -> BTreeSet<(Ipv4Net, Ipv4Net)> {
    let expand = |p: &NodePolicy| -> BTreeSet<(Ipv4Net, Ipv4Net)> {
        p.pairs
            .iter()
            .copied()
            .chain(p.host_reach.iter().map(|d| (p.host_mesh, *d)))
            .collect()
    };
    expand(old).difference(&expand(new)).copied().collect()
}

fn mask(len: u8) -> Ipv4Addr {
    Ipv4Addr::from(if len == 0 {
        0
    } else {
        u32::MAX << (32 - u32::from(len))
    })
}

/// Deletes conntrack entries whose original direction is `src` → `dst`. Returns how many the
/// kernel reported deleted.
///
/// # Errors
/// `conntrack` could not run. "0 entries deleted" (exit 1) is success.
pub fn withdraw<R: Runner>(runner: &R, src: Ipv4Net, dst: Ipv4Net) -> Result<u64, CmdError> {
    let (sa, sm, da, dm) = (
        src.addr().to_string(),
        mask(src.prefix_len()).to_string(),
        dst.addr().to_string(),
        mask(dst.prefix_len()).to_string(),
    );
    let out = runner.run(
        "conntrack",
        &[
            "-D",
            "-f",
            "ipv4",
            "-s",
            &sa,
            "--mask-src",
            &sm,
            "-d",
            &da,
            "--mask-dst",
            &dm,
        ],
        None,
        Duration::from_secs(10),
    )?;
    let text = format!("{}{}", out.stdout, out.stderr);
    let count = text
        .split_whitespace()
        .zip(text.split_whitespace().skip(1))
        .find_map(|(n, w)| (w == "flow").then(|| n.parse().ok()).flatten())
        .unwrap_or(0);
    if out.success() || count == 0 && out.code == Some(1) {
        Ok(count)
    } else {
        Err(CmdError::Failed {
            program: "conntrack".into(),
            args: format!("-D -s {src} -d {dst}"),
            code: out.code,
            stderr: out.stderr,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cmd::Output;
    use crate::cmd::fake::Fake;
    use crate::policy::Interfaces;

    fn p(pairs: &[(&str, &str)], reach: &[&str]) -> NodePolicy {
        NodePolicy {
            interfaces: Interfaces::default(),
            workload: "172.24.0.0/13".parse().unwrap(),
            host_mesh: "172.30.224.0/23".parse().unwrap(),
            vip: "172.31.0.0/16".parse().unwrap(),
            pairs: pairs
                .iter()
                .map(|(a, b)| (a.parse().unwrap(), b.parse().unwrap()))
                .collect(),
            host_reach: reach.iter().map(|r| r.parse().unwrap()).collect(),
            published: std::collections::BTreeSet::new(),
            edge_ports: std::collections::BTreeSet::new(),
            local_scopes: vec![],
            dns: vec![],
            no_snat_extra: vec![],
            edge_bridges: vec![],
            vip_backends: vec![],
        }
    }

    #[test]
    fn revoked_is_the_directed_difference() {
        let old = p(
            &[
                ("172.24.0.0/27", "172.24.32.0/27"),
                ("172.24.32.0/27", "172.24.0.0/27"),
            ],
            &["172.24.0.0/27"],
        );
        let new = p(&[("172.24.32.0/27", "172.24.0.0/27")], &[]);
        let r = revoked(&old, &new);
        assert_eq!(r.len(), 2);
        assert!(r.contains(&(
            "172.24.0.0/27".parse().unwrap(),
            "172.24.32.0/27".parse().unwrap()
        )));
        assert!(r.contains(&(
            "172.30.224.0/23".parse().unwrap(),
            "172.24.0.0/27".parse().unwrap()
        )));
    }

    #[test]
    fn withdraw_uses_masks_and_accepts_zero_deleted() {
        let fake = Fake::new().on("conntrack -D", 1, "");
        let n = withdraw(
            &fake,
            "172.24.0.0/27".parse().unwrap(),
            "172.24.32.0/27".parse().unwrap(),
        )
        .unwrap();
        assert_eq!(n, 0);
        assert!(fake.lines()[0].contains(
            "-s 172.24.0.0 --mask-src 255.255.255.224 -d 172.24.32.0 --mask-dst 255.255.255.224"
        ));
        let _ = Output::default();
    }
}
