//! `otterd-recover`: the local recovery CLI. Every command prints JSON.

use clap::{Parser, Subcommand};
use otterd_anchor::s3::{S3, S3Config};
use otterd_anchor::{Anchor, RetirementMethod};
use otterd_fence::{
    FenceAdapter as _, FenceEvidence, HetznerFence, MachineBinding, ManualFence, ManualProof,
    PowerOn, Silence,
};
use otterd_proto::U53;
use otterd_proto::envelope::SignedEnvelope;
use otterd_proto::identity::HostBinding;
use otterd_proto::ids::{InstallId, NodeId};
use otterd_proto::platform::PlatformBootManifest;
use otterd_recover::{RecoverError, authority, journal, keys, now_ms};
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

#[derive(Debug, Parser)]
#[command(name = "otterd-recover", version, about = "otterd recovery CLI")]
struct Cli {
    #[command(subcommand)]
    command: Cmd,
}

#[derive(Debug, Subcommand)]
enum Cmd {
    /// Create an offline signing key (recovery root or enrollment), 0600.
    Keygen {
        #[arg(long)]
        out: PathBuf,
    },
    /// Read a node journal without its lock.
    Journal {
        #[arg(long, default_value = "/var/lib/otterd/journal/node.journal")]
        path: PathBuf,
        /// Only what blocks: unresolved submissions, unreleased grants, open holds.
        #[arg(long)]
        obligations: bool,
    },
    /// Revoke authority below a term.
    #[command(subcommand)]
    Authority(AuthorityCmd),
    /// The off-node recovery anchor.
    Anchor {
        /// Anchor location (JSON); credentials come from
        /// OTTERD_ANCHOR_ACCESS_KEY and OTTERD_ANCHOR_SECRET_KEY.
        #[arg(long)]
        config: PathBuf,
        #[command(subcommand)]
        command: AnchorCmd,
    },
    /// External fencing.
    #[command(subcommand)]
    Fence(FenceCmd),
    /// Sign or check a platform boot manifest with the recovery key.
    #[command(subcommand)]
    Manifest(ManifestCmd),
}

#[derive(Debug, Subcommand)]
enum ManifestCmd {
    /// Validate the boot closure, then sign.
    Sign {
        #[arg(long)]
        key: PathBuf,
        /// Unsigned `PlatformBootManifest` (JSON).
        #[arg(long)]
        input: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
    /// Verify a signed manifest and print its digest and start order.
    Verify {
        /// Recovery public key (base64).
        #[arg(long)]
        public: String,
        #[arg(long)]
        input: PathBuf,
    },
}

#[derive(Debug, Subcommand)]
enum AuthorityCmd {
    /// Sign a revocation with the recovery key.
    Sign {
        #[arg(long)]
        key: PathBuf,
        #[arg(long)]
        install: String,
        #[arg(long)]
        below_term: u64,
        /// Nodes it applies to; none means every node of the install.
        #[arg(long = "node")]
        nodes: Vec<String>,
        #[arg(long)]
        reason: String,
        #[arg(long)]
        out: PathBuf,
    },
    /// Apply a signed revocation: through the daemon's socket, or with the
    /// daemon stopped, straight into its journal.
    Apply {
        #[arg(long)]
        revocation: PathBuf,
        #[arg(long, conflicts_with = "journal")]
        socket: Option<PathBuf>,
        #[arg(long)]
        journal: Option<PathBuf>,
    },
}

#[derive(Debug, Subcommand)]
enum AnchorCmd {
    /// Probe the store's conditional-write semantics (writes under `probe/`).
    Probe,
    /// The verified head and term.
    Status,
    /// Every enrollment record, committed or pending.
    Inventory,
    /// Create the anchor (recovery key).
    Init {
        #[arg(long)]
        recovery_key: PathBuf,
        #[arg(long)]
        machine_id: String,
        #[arg(long, default_value_t = 1)]
        bootstrap_epoch: u64,
    },
    /// Advance the term, bind the new platform host and freeze enrollment.
    BeginRecovery {
        #[arg(long)]
        recovery_key: PathBuf,
        #[arg(long)]
        machine_id: String,
    },
    /// Record that a node holds no old-term authority any more.
    Retire {
        #[arg(long)]
        recovery_key: PathBuf,
        #[arg(long)]
        node: String,
        /// provider-power-off, manual-fence, responsive-certificate, decommissioned.
        #[arg(long)]
        method: String,
        #[arg(long)]
        reference: String,
    },
    /// Nodes still without a retirement for the current term.
    Outstanding,
    /// Finish recovery once every node is retired.
    Complete {
        #[arg(long)]
        recovery_key: PathBuf,
    },
}

#[derive(Debug, Subcommand)]
enum FenceCmd {
    /// Hetzner Cloud (token from HCLOUD_TOKEN).
    Hetzner {
        /// Machine binding (JSON) recorded at enrollment.
        #[arg(long)]
        binding: PathBuf,
        #[command(subcommand)]
        action: HetznerAction,
    },
    /// Begin a manual fence: prints the state with the challenge to quote.
    ManualBegin {
        #[arg(long)]
        out: PathBuf,
    },
    /// Check an operator's proof against a begun manual fence.
    ManualVerify {
        #[arg(long)]
        state: PathBuf,
        #[arg(long)]
        binding: PathBuf,
        #[arg(long)]
        proof: PathBuf,
        /// Last authenticated contact from the node, Unix ms.
        #[arg(long)]
        last_contact_ms: u64,
    },
    /// Turn fence evidence into the barrier evidence `node.retireByBarrier` takes.
    Barrier {
        #[arg(long)]
        evidence: PathBuf,
        #[arg(long)]
        node_epoch: u64,
    },
}

#[derive(Debug, Subcommand)]
enum HetznerAction {
    Check,
    /// Hard power-off, verified off.
    Fence,
    /// Power on into the rescue system (`--rescue-ssh-key`) or normally.
    PowerOn {
        #[arg(long)]
        rescue_ssh_key: Option<String>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AnchorFile {
    endpoint: String,
    region: String,
    bucket: String,
    prefix: String,
    #[serde(default)]
    path_style: bool,
    #[serde(default)]
    unquoted_if_match: bool,
    install_id: InstallId,
    recovery_key: String,
    enrollment_key: String,
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, RecoverError> {
    let bytes = std::fs::read(path).map_err(|e| RecoverError::Io {
        path: path.into(),
        source: e,
    })?;
    Ok(serde_json::from_slice(&bytes)?)
}

fn write_json(path: &Path, v: &impl serde::Serialize) -> Result<(), RecoverError> {
    std::fs::write(path, serde_json::to_vec_pretty(v)?).map_err(|e| RecoverError::Io {
        path: path.into(),
        source: e,
    })
}

fn env(name: &str) -> Result<String, RecoverError> {
    std::env::var(name).map_err(|_| RecoverError::Refused(format!("{name} is not set")))
}

fn u53(v: u64) -> Result<U53, RecoverError> {
    U53::new(v).ok_or_else(|| RecoverError::Refused(format!("{v} is out of range")))
}

fn parse<T: std::str::FromStr>(what: &str, s: &str) -> Result<T, RecoverError> {
    s.parse()
        .map_err(|_| RecoverError::Refused(format!("{what} {s:?} is not valid")))
}

fn host(machine_id: String) -> HostBinding {
    HostBinding {
        machine_id,
        product_uuid: None,
        provider: None,
    }
}

fn open_anchor(config: &Path) -> Result<Anchor, RecoverError> {
    let f: AnchorFile = read_json(config)?;
    let s3 = S3::new(S3Config {
        endpoint: f.endpoint,
        region: f.region,
        bucket: f.bucket,
        access_key: env("OTTERD_ANCHOR_ACCESS_KEY")?,
        secret_key: env("OTTERD_ANCHOR_SECRET_KEY")?,
        path_style: f.path_style,
        unquoted_if_match: f.unquoted_if_match,
    })?;
    Ok(Anchor::new(
        s3,
        f.install_id,
        &f.prefix,
        keys::public(&f.recovery_key)?,
        keys::public(&f.enrollment_key)?,
    ))
}

fn retirement_method(s: &str) -> Result<RetirementMethod, RecoverError> {
    Ok(serde_json::from_value(Value::String(s.to_owned()))?)
}

async fn anchor(config: &Path, cmd: AnchorCmd) -> Result<Value, RecoverError> {
    let a = open_anchor(config)?;
    Ok(match cmd {
        AnchorCmd::Probe => serde_json::to_value(otterd_anchor::probe(a.s3(), a.prefix()).await?)?,
        AnchorCmd::Status => {
            let h = a.head().await?;
            json!({"head": h.head, "term": h.term, "etag": h.etag})
        }
        AnchorCmd::Inventory => serde_json::to_value(a.inventory().await?)?,
        AnchorCmd::Init {
            recovery_key,
            machine_id,
            bootstrap_epoch,
        } => {
            let h = a
                .init(
                    &keys::read(&recovery_key)?,
                    host(machine_id),
                    u53(bootstrap_epoch)?,
                )
                .await?;
            json!({"term": h.term})
        }
        AnchorCmd::BeginRecovery {
            recovery_key,
            machine_id,
        } => serde_json::to_value(
            a.begin_recovery(&keys::read(&recovery_key)?, host(machine_id))
                .await?,
        )?,
        AnchorCmd::Retire {
            recovery_key,
            node,
            method,
            reference,
        } => {
            let node: NodeId = parse("node", &node)?;
            a.record_retirement(
                &keys::read(&recovery_key)?,
                &node,
                retirement_method(&method)?,
                &reference,
            )
            .await?;
            json!({"retired": node})
        }
        AnchorCmd::Outstanding => {
            let (term, missing, retired) = a.outstanding().await?;
            json!({"term": term, "outstanding": missing, "retired": retired})
        }
        AnchorCmd::Complete { recovery_key } => {
            serde_json::to_value(a.complete_recovery(&keys::read(&recovery_key)?).await?)?
        }
    })
}

async fn fence(cmd: FenceCmd) -> Result<Value, RecoverError> {
    Ok(match cmd {
        FenceCmd::Hetzner { binding, action } => {
            let b: MachineBinding = read_json(&binding)?;
            let f = HetznerFence::new(env("HCLOUD_TOKEN")?)?;
            match action {
                HetznerAction::Check => {
                    f.check_binding(&b).await?;
                    json!({"binding": "matches"})
                }
                HetznerAction::Fence => serde_json::to_value(f.fence(&b).await?)?,
                HetznerAction::PowerOn { rescue_ssh_key } => {
                    let mode = rescue_ssh_key
                        .map_or(PowerOn::Normal, |ssh_key_id| PowerOn::Rescue { ssh_key_id });
                    serde_json::to_value(f.power_on(&b, mode).await?)?
                }
            }
        }
        FenceCmd::ManualBegin { out } => {
            let m = ManualFence::begin(now_ms())?;
            write_json(&out, &m)?;
            json!({"challenge": m.challenge(), "state": out})
        }
        FenceCmd::ManualVerify {
            state,
            binding,
            proof,
            last_contact_ms,
        } => {
            let m: ManualFence = read_json(&state)?;
            let b: MachineBinding = read_json(&binding)?;
            let p: ManualProof = read_json(&proof)?;
            serde_json::to_value(m.verify(
                &b,
                &p,
                Silence {
                    last_contact_unix_ms: u53(last_contact_ms)?,
                    now_unix_ms: now_ms(),
                },
            )?)?
        }
        FenceCmd::Barrier {
            evidence,
            node_epoch,
        } => {
            let e: FenceEvidence = read_json(&evidence)?;
            serde_json::to_value(e.barrier(u53(node_epoch)?, None))?
        }
    })
}

fn manifest(cmd: ManifestCmd) -> Result<Value, RecoverError> {
    let order = |m: &PlatformBootManifest| -> Result<Vec<String>, RecoverError> {
        Ok(m.preflight()
            .map_err(|e| RecoverError::Refused(e.to_string()))?
            .into_iter()
            .map(|m| m.name.clone())
            .collect())
    };
    match cmd {
        ManifestCmd::Sign { key, input, out } => {
            let m: PlatformBootManifest = read_json(&input)?;
            let order = order(&m)?;
            let env = SignedEnvelope::sign(
                &keys::read(&key)?,
                otterd_proto::SignContext::PlatformBootManifest,
                &m,
            )?;
            write_json(&out, &env)?;
            Ok(json!({"manifest": out, "digest": env.payload_digest()?, "order": order}))
        }
        ManifestCmd::Verify { public, input } => {
            let env: SignedEnvelope = read_json(&input)?;
            let m: PlatformBootManifest = env.verify(
                &[keys::public(&public)?],
                otterd_proto::SignContext::PlatformBootManifest,
            )?;
            Ok(json!({"digest": env.payload_digest()?, "order": order(&m)?}))
        }
    }
}

fn authority_cmd(cmd: AuthorityCmd) -> Result<Value, RecoverError> {
    match cmd {
        AuthorityCmd::Sign {
            key,
            install,
            below_term,
            nodes,
            reason,
            out,
        } => {
            let nodes = nodes
                .iter()
                .map(|n| parse("node", n))
                .collect::<Result<Vec<NodeId>, _>>()?;
            let env = authority::sign(
                &keys::read(&key)?,
                parse("install", &install)?,
                u53(below_term)?,
                nodes,
                &reason,
            )?;
            write_json(&out, &env)?;
            Ok(json!({"revocation": out, "digest": env.payload_digest()?}))
        }
        AuthorityCmd::Apply {
            revocation,
            socket,
            journal,
        } => {
            let env: SignedEnvelope = read_json(&revocation)?;
            match (socket, journal) {
                (Some(s), None) => authority::apply_via_socket(&s, &env),
                (None, Some(j)) => {
                    Ok(json!({"revokedBelowTerm": authority::apply_offline(&j, &env)?}))
                }
                _ => Err(RecoverError::Refused(
                    "give --socket (daemon running) or --journal (daemon stopped)".into(),
                )),
            }
        }
    }
}

async fn run(cli: Cli) -> Result<Value, RecoverError> {
    match cli.command {
        Cmd::Keygen { out } => {
            let public = keys::generate(&out)?;
            Ok(json!({"key": out, "public": public, "keyId": public.key_id()}))
        }
        Cmd::Journal { path, obligations } => {
            if obligations {
                journal::obligations(&path)
            } else {
                journal::show(&path)
            }
        }
        Cmd::Authority(cmd) => authority_cmd(cmd),
        Cmd::Anchor { config, command } => anchor(&config, command).await,
        Cmd::Fence(cmd) => fence(cmd).await,
        Cmd::Manifest(cmd) => manifest(cmd),
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    match run(Cli::parse()).await {
        Ok(v) => {
            println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default());
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("otterd-recover: {e}");
            ExitCode::FAILURE
        }
    }
}
