//! `otterd-net`: maintenance entry point for the node network layer.
//!
//! These subcommands are what `otterd` runs internally; they are exposed for installation,
//! inspection and recovery by an operator:
//!
//! ```text
//! otterd-net render  <policy.json>           print the nftables generation
//! otterd-net apply   <policy.json>           apply + persist it, position Docker chains
//! otterd-net install <policy.json>           write units, nftables drop-in, wrapper; apply
//! otterd-net agent   <policy.json>           run the reconciler (netlink, guard, audit)
//! otterd-net guard   <policy.json>           one bridge-guard reconcile
//! otterd-net mesh    <mesh.json>             bring a WireGuard mesh interface to its desired state
//! otterd-net withdraw <src/len> <dst/len>    delete conntrack entries for a revoked pair
//! otterd-net vip render <views.json>        print the VIP receiver table
//! otterd-net peers <underlay-ip>...         UFW mesh range + CrowdSec allowlist and audit
//! otterd-net rotation <state.json> <event>   advance a staged key rotation, print what is pending
//! otterd-net fingerprint                     digest of otterd's live tables
//! ```

use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use otterd_net::agent::{self, Agent, Options};
use otterd_net::cmd::{Runner, System};
use otterd_net::docker::Engine;
use otterd_net::firewall::{DockerChainState, DockerChains, Firewall, Layout};
use otterd_net::mesh::MeshInterface;
use otterd_net::policy::NodePolicy;

fn usage() -> ExitCode {
    eprintln!(
        "usage: otterd-net render|apply|install|agent|guard <policy.json>\n       otterd-net mesh <mesh.json> <mesh-pattern>\n       otterd-net withdraw <src/len> <dst/len>\n       otterd-net fingerprint"
    );
    ExitCode::from(2)
}

fn policy(path: &str) -> Result<NodePolicy, String> {
    agent::load_policy(std::path::Path::new(path)).map_err(|e| e.to_string())
}

fn apply(p: &NodePolicy) -> Result<(), String> {
    let fw = Firewall::new(Layout::default(), &System);
    fw.apply_policy(p).map_err(|e| e.to_string())?;
    let chains = DockerChains::new(&System);
    if chains.state().map_err(|e| e.to_string())? == DockerChainState::Present {
        let c = chains.ensure(p, true).map_err(|e| e.to_string())?;
        eprintln!("docker chains: {c:?}");
    } else {
        eprintln!("docker chains absent (Docker down or flushed); the agent positions them later");
    }
    Ok(())
}

fn run(args: &[String]) -> Result<(), String> {
    let arg = |i: usize| {
        args.get(i)
            .map(String::as_str)
            .ok_or_else(|| "missing argument".to_owned())
    };
    match arg(1)? {
        "render" => {
            print!("{}", policy(arg(2)?)?.render());
            Ok(())
        }
        "apply" => apply(&policy(arg(2)?)?),
        "install" => {
            let p = policy(arg(2)?)?;
            let fw = Firewall::new(Layout::default(), &System);
            fw.install(&p.interfaces.bridges)
                .map_err(|e| e.to_string())?;
            apply(&p)?;
            System
                .ok("systemctl", &["daemon-reload"], None)
                .map_err(|e| e.to_string())?;
            System
                .ok(
                    "systemctl",
                    &["enable", "--now", otterd_net::firewall::FIREWALL_UNIT],
                    None,
                )
                .map_err(|e| e.to_string())?;
            Ok(())
        }
        "agent" => {
            let opts = Options::new(PathBuf::from(arg(2)?));
            let stop = Arc::new(AtomicBool::new(false));
            let mut a = Agent::new(System, Engine::default(), opts);
            // Ready once the first pass applied the policy, so whoever starts
            // the unit and waits starts workloads behind it, not before it.
            if let Err(e) = a.pass(true) {
                tracing::error!(error = %e, "first network pass failed");
            }
            let _ = otterd_sys::notify::Notifier::from_env().ready();
            agent::run(a, &stop);
            Ok(())
        }
        "guard" => {
            let opts = Options::new(PathBuf::from(arg(2)?));
            let mut a = Agent::new(System, Engine::default(), opts);
            let r = a.pass(true).map_err(|e| e.to_string())?;
            eprintln!("{r:?}");
            Ok(())
        }
        "mesh" => {
            let text = std::fs::read_to_string(arg(2)?).map_err(|e| e.to_string())?;
            let m: MeshInterface = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            let pattern =
                otterd_net::policy::IfacePattern::new(arg(3)?).map_err(|e| e.to_string())?;
            m.apply(&System, &pattern).map_err(|e| e.to_string())
        }
        "withdraw" => {
            let s = arg(2)?
                .parse()
                .map_err(|e: otterd_net::addr::PrefixError| e.to_string())?;
            let d = arg(3)?
                .parse()
                .map_err(|e: otterd_net::addr::PrefixError| e.to_string())?;
            let n = otterd_net::conntrack::withdraw(&System, s, d).map_err(|e| e.to_string())?;
            println!("{n}");
            Ok(())
        }
        "vip" => vip(args),
        "peers" => peers(args),
        "rotation" => rotation(args.get(2..).unwrap_or_default()),
        "fingerprint" => {
            let fp = Firewall::new(Layout::default(), &System)
                .fingerprint()
                .map_err(|e| e.to_string())?;
            println!("{}", otterd_net::firewall::describe(&fp));
            Ok(())
        }
        other => Err(format!("unknown command {other}")),
    }
}

/// `vip render <views.json>`: print the receiver table for the given forwarding views.
fn vip(args: &[String]) -> Result<(), String> {
    let arg = |i: usize| {
        args.get(i)
            .map(String::as_str)
            .ok_or_else(|| "missing argument".to_owned())
    };

    let text = std::fs::read_to_string(arg(3)?).map_err(|e| e.to_string())?;
    let views: Vec<otterd_net::vip::VipView> =
        serde_json::from_str(&text).map_err(|e| e.to_string())?;
    match arg(2)? {
        "render" => {
            print!("{}", otterd_net::vip::render(&views));
            Ok(())
        }
        other => Err(format!("unknown vip command {other}")),
    }
}

/// `peers <underlay-ip>...`: UFW mesh range, CrowdSec allowlist, bouncer and decision audit.
fn peers(args: &[String]) -> Result<(), String> {
    let ips: std::collections::BTreeSet<std::net::IpAddr> = args
        .get(2..)
        .unwrap_or_default()
        .iter()
        .map(|a| {
            a.parse()
                .map_err(|e: std::net::AddrParseError| e.to_string())
        })
        .collect::<Result<_, _>>()?;
    let ufw = otterd_net::integrations::ensure_ufw(&System).map_err(|e| e.to_string())?;
    let cs =
        otterd_net::integrations::reconcile_crowdsec(&System, &ips).map_err(|e| e.to_string())?;
    println!("ufw: {ufw:?}\ncrowdsec: {cs:?}");
    match cs.blocking_reason() {
        Some(why) => Err(format!("mesh.peer.blocked: {why}")),
        None => Ok(()),
    }
}

/// `rotation <state.json> start <a|b> <node>...` or `rotation <state.json> <event> <args>`:
/// advances the journalled rotation by one observed fact and prints the phase and what is pending.
/// Readiness (port open, loose rp_filter, pattern) is checked by the caller before `start`.
fn rotation(args: &[String]) -> Result<(), String> {
    use otterd_net::ids::NodeId;
    use otterd_net::ipam::MeshGeneration;
    use otterd_net::rotation::{NodeReadiness, Rotation};
    let path = args.first().ok_or("missing state file")?;
    let word = |i: usize| {
        args.get(i)
            .map(String::as_str)
            .ok_or_else(|| "missing argument".to_owned())
    };
    let node = |i: usize| word(i).and_then(|w| NodeId::new(w).map_err(|e| e.to_string()));
    let r: Rotation = if word(1)? == "start" {
        let from = match word(2)? {
            "a" => MeshGeneration::A,
            "b" => MeshGeneration::B,
            g => return Err(format!("unknown generation {g}")),
        };
        let ready = NodeReadiness {
            port_open: true,
            rp_filter_loose: true,
            pattern_covers_both: true,
        };
        let nodes = args
            .get(3..)
            .unwrap_or_default()
            .iter()
            .map(|n| {
                NodeId::new(n.as_str())
                    .map(|id| (id, ready))
                    .map_err(|e| e.to_string())
            })
            .collect::<Result<Vec<_>, _>>()?;
        Rotation::start(from, nodes).map_err(|e| e.to_string())?
    } else {
        let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let mut r: Rotation = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        match word(1)? {
            "staged" => r.staged(&node(2)?),
            "verified" => r.verified(&node(2)?, &node(3)?),
            "switched" => r.switched(&node(2)?),
            "drain" => r.drain_sample(
                &node(2)?,
                word(3)?
                    .parse()
                    .map_err(|e: std::num::ParseIntError| e.to_string())?,
            ),
            "removed" => r.removed_old(&node(2)?),
            "abort" => {
                if !r.abort(word(2)?) {
                    return Err("routes already moved: switch back instead of aborting".into());
                }
            }
            "unstaged" => r.unstaged(&node(2)?),
            e => return Err(format!("unknown event {e}")),
        }
        r
    };
    let text = serde_json::to_string(&r).map_err(|e| e.to_string())?;
    otterd_net::firewall::write_atomic(std::path::Path::new(path), &text)
        .map_err(|e| e.to_string())?;
    let out = serde_json::json!({ "phase": r.phase(), "pending": r.pending() });
    println!("{out}");
    Ok(())
}

fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into()),
        )
        .init();
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        return usage();
    }
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("otterd-net: {e}");
            ExitCode::FAILURE
        }
    }
}
