//! Host firewall coexistence: UFW and CrowdSec.
//!
//! * **UFW** never decides exposure (Docker DNAT precedes UFW's INPUT). otterd only needs the
//!   mesh's UDP port range open, or a quiet or freshly booted side never completes a handshake.
//! * **CrowdSec** decisions against a peer's underlay address drop its WireGuard packets at the
//!   bouncer's INPUT hook, and an earlier accept elsewhere cannot override a later base-chain
//!   drop. Every enrolled peer's underlay address goes on the `otterd-peers` allowlist **before**
//!   the peer becomes cross-node eligible (the address is then exempt on every port). The
//!   audit fails if a decision for a peer exists anyway (`--bypass-allowlist`), and preflight
//!   checks the bouncer is actually running and registered: a package install can leave it
//!   enabled but dead, protecting nothing.

use std::collections::BTreeSet;
use std::net::IpAddr;
use std::time::Duration;

use crate::cmd::{CmdError, Runner};
use crate::mesh::PORT_RANGE;

/// Name of otterd's CrowdSec allowlist.
pub const ALLOWLIST: &str = "otterd-peers";

/// UFW state relevant to the mesh.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ufw {
    /// Not installed or inactive: nothing to do.
    Inactive,
    /// Active and the mesh range is allowed.
    Allowed,
    /// Active and the rule was just added.
    Added,
}

/// Makes sure an active UFW admits the mesh UDP range. Idempotent.
///
/// # Errors
/// A `ufw` command failed while UFW is active.
pub fn ensure_ufw<R: Runner>(runner: &R) -> Result<Ufw, CmdError> {
    let status = match runner.run("ufw", &["status"], None, Duration::from_secs(10)) {
        Ok(o) if o.success() => o.stdout,
        Ok(_) | Err(CmdError::Spawn { .. }) => return Ok(Ufw::Inactive),
        Err(e) => return Err(e),
    };
    if !status.contains("Status: active") {
        return Ok(Ufw::Inactive);
    }
    let range = format!("{}:{}/udp", PORT_RANGE.0, PORT_RANGE.1);
    if status
        .lines()
        .any(|l| l.starts_with(&range) && l.contains("ALLOW"))
    {
        return Ok(Ufw::Allowed);
    }
    runner.ok("ufw", &["allow", &range, "comment", "otterd mesh"], None)?;
    Ok(Ufw::Added)
}

/// CrowdSec findings.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CrowdSec {
    /// `cscli` is present.
    pub installed: bool,
    /// A firewall bouncer unit is active.
    pub bouncer_active: bool,
    /// At least one bouncer is registered with the local API and has pulled decisions.
    pub bouncer_registered: bool,
    /// Peer addresses added to the allowlist in this pass.
    pub allowlisted: BTreeSet<IpAddr>,
    /// Peer addresses with an active decision anyway: raise `mesh.peer.blocked`.
    pub blocked_peers: BTreeSet<IpAddr>,
    /// Peer addresses that had a decision which allowlisting just removed: the mesh to them was
    /// partitioned until now, which is worth an event even though it is resolved.
    pub cleared_peers: BTreeSet<IpAddr>,
}

impl CrowdSec {
    /// Preflight verdict: CrowdSec absent, or present with an enforcing bouncer and no peer
    /// blocked. Anything else blocks cross-node eligibility with a named reason.
    #[must_use]
    pub fn blocking_reason(&self) -> Option<String> {
        if !self.installed {
            return None;
        }
        if !self.bouncer_active || !self.bouncer_registered {
            return Some(
                "CrowdSec is installed but its firewall bouncer is not running and registered, so it enforces nothing. \
                 Register it (cscli bouncers add) and start it, or remove CrowdSec."
                    .to_owned(),
            );
        }
        (!self.blocked_peers.is_empty()).then(|| {
            let list: Vec<String> = self.blocked_peers.iter().map(ToString::to_string).collect();
            format!("CrowdSec has decisions against mesh peers {}; delete them (cscli decisions delete --ip …)", list.join(", "))
        })
    }
}

fn values(v: &serde_json::Value, key: &str, out: &mut BTreeSet<String>) {
    match v {
        serde_json::Value::Object(m) => {
            for (k, x) in m {
                if k == key
                    && let Some(s) = x.as_str()
                {
                    out.insert(s.to_owned());
                }
                values(x, key, out);
            }
        }
        serde_json::Value::Array(a) => a.iter().for_each(|x| values(x, key, out)),
        _ => {}
    }
}

fn json<R: Runner>(runner: &R, args: &[&str]) -> Result<serde_json::Value, CmdError> {
    let out = runner.ok("cscli", args, None)?;
    Ok(serde_json::from_str(out.stdout.trim()).unwrap_or(serde_json::Value::Null))
}

/// Allowlists every peer underlay address, removes addresses of peers that left, checks the
/// bouncer and looks for decisions against peers. A host without CrowdSec returns
/// `installed: false` and changes nothing.
///
/// # Errors
/// A `cscli` command failed on a host where CrowdSec is installed.
pub fn reconcile_crowdsec<R: Runner>(
    runner: &R,
    peers: &BTreeSet<IpAddr>,
) -> Result<CrowdSec, CmdError> {
    let mut r = CrowdSec::default();
    match runner.run("cscli", &["version"], None, Duration::from_secs(10)) {
        Ok(o) if o.success() => r.installed = true,
        _ => return Ok(r),
    }
    r.bouncer_active = [
        "crowdsec-firewall-bouncer.service",
        "crowdsec-firewall-bouncer-nftables.service",
    ]
    .iter()
    .any(|u| {
        runner
            .run(
                "systemctl",
                &["is-active", "--quiet", u],
                None,
                Duration::from_secs(5),
            )
            .is_ok_and(|o| o.success())
    });
    let bouncers = json(runner, &["bouncers", "list", "-o", "json"])?;
    let mut pulls = BTreeSet::new();
    values(&bouncers, "last_pull", &mut pulls);
    r.bouncer_registered = pulls
        .iter()
        .any(|p| !p.is_empty() && !p.starts_with("0001-"));

    let decided_before = decided(runner)?;
    let inspect = runner.run(
        "cscli",
        &["allowlists", "inspect", ALLOWLIST, "-o", "json"],
        None,
        Duration::from_secs(10),
    )?;
    let mut have = BTreeSet::new();
    if inspect.success() {
        let v: serde_json::Value =
            serde_json::from_str(inspect.stdout.trim()).unwrap_or(serde_json::Value::Null);
        values(&v, "value", &mut have);
    } else {
        runner.ok(
            "cscli",
            &[
                "allowlists",
                "create",
                ALLOWLIST,
                "-d",
                "otterd mesh peers (WireGuard underlay)",
            ],
            None,
        )?;
    }
    let want: BTreeSet<String> = peers.iter().map(ToString::to_string).collect();
    let add: Vec<&str> = want.difference(&have).map(String::as_str).collect();
    if !add.is_empty() {
        let mut args = vec!["allowlists", "add", ALLOWLIST];
        args.extend(&add);
        runner.ok("cscli", &args, None)?;
        r.allowlisted = add.iter().filter_map(|a| a.parse().ok()).collect();
    }
    let stale: Vec<&str> = have.difference(&want).map(String::as_str).collect();
    if !stale.is_empty() {
        let mut args = vec!["allowlists", "remove", ALLOWLIST];
        args.extend(&stale);
        runner.ok("cscli", &args, None)?;
    }
    let decided_after = decided(runner)?;
    r.blocked_peers = peers
        .iter()
        .filter(|p| decided_after.contains(&p.to_string()))
        .copied()
        .collect();
    r.cleared_peers = peers
        .iter()
        .filter(|p| {
            decided_before.contains(&p.to_string()) && !decided_after.contains(&p.to_string())
        })
        .copied()
        .collect();
    Ok(r)
}

/// Addresses with an active CrowdSec decision.
fn decided<R: Runner>(runner: &R) -> Result<BTreeSet<String>, CmdError> {
    let decisions = json(runner, &["decisions", "list", "-o", "json"])?;
    let mut out = BTreeSet::new();
    values(&decisions, "value", &mut out);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cmd::fake::Fake;

    #[test]
    fn ufw_inactive_or_missing_is_left_alone() {
        let fake = Fake::new().on("ufw status", 0, "Status: inactive\n");
        assert_eq!(ensure_ufw(&fake).unwrap(), Ufw::Inactive);
    }

    #[test]
    fn active_ufw_gets_the_mesh_range_once() {
        let fake = Fake::new().on(
            "ufw status",
            0,
            "Status: active\n\nTo Action From\n22/tcp ALLOW Anywhere\n",
        );
        assert_eq!(ensure_ufw(&fake).unwrap(), Ufw::Added);
        assert!(
            fake.lines()
                .iter()
                .any(|l| l == "ufw allow 51820:51899/udp comment otterd mesh")
        );
        let fake = Fake::new().on(
            "ufw status",
            0,
            "Status: active\n51820:51899/udp            ALLOW       Anywhere\n",
        );
        assert_eq!(ensure_ufw(&fake).unwrap(), Ufw::Allowed);
    }

    #[test]
    fn crowdsec_absent_changes_nothing() {
        let fake = Fake::new().on("cscli version", 127, "");
        let r = reconcile_crowdsec(&fake, &BTreeSet::new()).unwrap();
        assert!(!r.installed && r.blocking_reason().is_none());
        assert_eq!(fake.lines().len(), 1);
    }

    #[test]
    fn peers_are_allowlisted_stale_removed_and_blocked_peers_reported() {
        let fake = Fake::new()
            .on(
                "cscli bouncers list",
                0,
                r#"[{"name":"fw","last_pull":"2026-10-12T10:00:00Z","valid":true}]"#,
            )
            .on(
                "cscli allowlists inspect",
                0,
                r#"{"name":"otterd-peers","items":[{"value":"10.0.0.9"},{"value":"10.0.0.2"}]}"#,
            )
            .on(
                "cscli decisions list",
                0,
                r#"[{"decisions":[{"value":"10.0.0.3","type":"ban"}]}]"#,
            )
            .on(
                "systemctl is-active --quiet crowdsec-firewall-bouncer.service",
                0,
                "",
            );
        let peers: BTreeSet<IpAddr> = ["10.0.0.2", "10.0.0.3"]
            .iter()
            .map(|s| s.parse().unwrap())
            .collect();
        let r = reconcile_crowdsec(&fake, &peers).unwrap();
        let l = fake.lines();
        assert!(
            l.iter()
                .any(|x| x == "cscli allowlists add otterd-peers 10.0.0.3")
        );
        assert!(
            l.iter()
                .any(|x| x == "cscli allowlists remove otterd-peers 10.0.0.9")
        );
        assert_eq!(r.blocked_peers, ["10.0.0.3".parse().unwrap()].into());
        assert!(
            r.cleared_peers.is_empty(),
            "the fake keeps the decision after allowlisting"
        );
        assert!(r.blocking_reason().unwrap().contains("10.0.0.3"));
    }

    #[test]
    fn dead_bouncer_blocks_eligibility() {
        let fake = Fake::new()
            .on("cscli bouncers list", 0, "[]")
            .on("systemctl is-active", 3, "");
        let r = reconcile_crowdsec(&fake, &BTreeSet::new()).unwrap();
        assert!(
            r.blocking_reason()
                .unwrap()
                .contains("not running and registered")
        );
    }
}
