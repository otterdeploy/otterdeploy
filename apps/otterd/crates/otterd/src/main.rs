//! `otterd`: the per-node daemon.
//!
//! * `otterd keygen` creates the node keys (identity, cache encryption,
//!   WireGuard; root-only) and prints their public halves.
//! * `otterd init --certificate <file> --cp-key <base64>` creates the journal from
//!   a control-plane-signed enrollment certificate. It refuses when a journal,
//!   or any otterd-managed container, already exists: a lost journal is
//!   recovery, never a fresh start.
//! * `otterd run` boots: a new process incarnation enters boot quarantine, the
//!   reconciler stops every grant of an earlier incarnation, and the
//!   progress-tied watchdog pets systemd only while the reconciler completes
//!   passes.

use clap::{Parser, Subcommand};
use otterd::TenantGate;
use otterd::keys::KeyRotator;
use otterd::lease::LeaseKeeper;
use otterd::platform::{Platform, PlatformConfig};
use otterd::session::{ControlHandler, NodeIdentitySource, SlotReporter};
use otterd::telemetry::Telemetry;
use otterd::upgrade::Upgrader;
use otterd::{LifecycleConfig, Node, Progress};
use otterd_engine::{DockerClient, EngineAdapter, JournalHandle, engine_incarnation};
use otterd_identity::{KeyStore, NodeKeyset};
use otterd_journal::{Journal, JournalError};
use otterd_proto::envelope::{PublicKey, SignContext, SignedEnvelope};
use otterd_proto::identity::EnrollCertificate;
use otterd_proto::ids::{BootId, Incarnation};
use otterd_proto::journal::Record;
use otterd_sys::notify::Notifier;
use otterd_transport::tls::{Trust, client_config};
use otterd_transport::{ConnectionManager, Outbox, TransportConfig};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::watch;

/// Exit code systemd must not restart on (`RestartPreventExitStatus=2`):
/// the journal is missing or corrupt, which is recovery, not a restart.
const EXIT_NO_INVENTORY: u8 = 2;

#[derive(Debug, Parser)]
#[command(name = "otterd", version, about = "otterdeploy per-node daemon")]
struct Cli {
    #[command(subcommand)]
    command: Cmd,
}

#[derive(Debug, clap::Args, Clone)]
struct Paths {
    #[arg(
        long,
        env = "OTTERD_JOURNAL",
        default_value = "/var/lib/otterd/journal/node.journal"
    )]
    journal: PathBuf,
    #[arg(long, env = "OTTERD_KEYS_DIR", default_value = "/etc/otterd/keys")]
    keys_dir: PathBuf,
    #[arg(
        long,
        env = "OTTERD_DOCKER_SOCKET",
        default_value = "/var/run/docker.sock"
    )]
    docker_socket: PathBuf,
    #[arg(
        long,
        env = "OTTERD_DOCKER_PID_FILE",
        default_value = "/var/run/docker.pid"
    )]
    docker_pid_file: PathBuf,
    /// Root-only directory of the platform bootstrap journal and manifests.
    #[arg(
        long,
        env = "OTTERD_BOOTSTRAP_DIR",
        default_value = "/var/lib/otterd/bootstrap"
    )]
    bootstrap_dir: PathBuf,
}

#[derive(Debug, Subcommand)]
enum Cmd {
    /// The host-pinned platform (control plane, Postgres, Redis) on this host.
    #[command(subcommand)]
    Platform(PlatformCmd),
    /// A/B binary updates.
    #[command(subcommand)]
    Update(UpdateCmd),
    /// Print a signed enrollment request for the control plane: this node's
    /// public keys, host binding and facts, and the single-use token, signed
    /// by the node identity key.
    Enroll {
        #[command(flatten)]
        paths: Paths,
        /// The single-use enrollment token from the control plane.
        #[arg(long, env = "OTTERD_ENROLL_TOKEN")]
        token: String,
        /// Requested roles (`worker`, `edge`, `build`, `registry`, `monitor`, `platform`).
        #[arg(long = "role", default_value = "worker")]
        roles: Vec<String>,
        /// Bind the request to the Hetzner Cloud server id from its metadata service.
        #[arg(long)]
        hetzner: bool,
    },
    /// Create the node keys.
    Keygen {
        #[command(flatten)]
        paths: Paths,
    },
    /// Create the journal from a control-plane-signed enrollment certificate.
    Init {
        #[command(flatten)]
        paths: Paths,
        /// Signed `EnrollCertificate` envelope (JSON).
        #[arg(long)]
        certificate: PathBuf,
        /// Control-plane signing key pinned out of band (base64).
        #[arg(long)]
        cp_key: String,
    },
    /// Run the daemon.
    Run(Box<RunArgs>),
}

#[derive(Debug, clap::Args)]
struct RunArgs {
    #[command(flatten)]
    paths: Paths,
    #[arg(long, env = "OTTERD_SOCKET", default_value = "/run/otterd/otterd.sock")]
    socket: PathBuf,
    #[arg(long, env = "OTTERD_STAGING_ROOT", default_value = "/run/otterd/stage")]
    staging_root: PathBuf,
    /// Per-request Engine timeout. Expiry leaves a mutation Submitted, never settled.
    #[arg(long, env = "OTTERD_ENGINE_TIMEOUT_MS", default_value_t = 15_000)]
    engine_timeout_ms: u64,
    #[arg(long, env = "OTTERD_STOP_GRACE_S", default_value_t = 10)]
    stop_grace_s: u64,
    #[arg(long, env = "OTTERD_RECONCILE_MS", default_value_t = 2_000)]
    reconcile_ms: u64,
    /// Engine boot-barrier profile; empty (the default) disables it.
    #[arg(long, env = "OTTERD_BOOT_BARRIER_PROFILE", default_value = "")]
    boot_barrier_profile: String,
    /// The control plane (`wss://…/api/otterd/connect`, from the enrollment
    /// certificate). Without it the node runs disconnected: workloads keep
    /// their grants and no command can arrive.
    #[arg(long, env = "OTTERD_CONTROL_URL")]
    control_url: Option<String>,
    /// PEM file of certificate authorities for a control plane with its own CA.
    #[arg(long, env = "OTTERD_CONTROL_CA")]
    control_ca: Option<PathBuf>,
    /// Trust only `--control-ca`, not the public web PKI.
    #[arg(long, env = "OTTERD_CONTROL_CA_ONLY")]
    control_ca_only: bool,
    /// Boot the host-pinned platform from the active signed manifest before
    /// opening the tenant gate.
    #[arg(long, env = "OTTERD_PLATFORM")]
    platform: bool,
    /// Seconds between metrics rounds sent as telemetry.
    #[arg(long, env = "OTTERD_METRICS_INTERVAL_S", default_value_t = 60)]
    metrics_interval_s: u64,
    /// Where the A/B slots live.
    #[arg(long, env = "OTTERD_UPDATE_ROOT", default_value = "/usr/lib/otterd")]
    update_root: PathBuf,
    /// The pinned release keys.
    #[arg(
        long,
        env = "OTTERD_RELEASE_KEYS",
        default_value = "/etc/otterd/release-keys.json"
    )]
    release_keys: PathBuf,
    /// Where `node.upgrade` downloads release binaries from.
    #[arg(
        long,
        env = "OTTERD_RELEASE_URL",
        default_value = "https://get.otterdeploy.com/otterd"
    )]
    release_url: String,
    /// Start the platform's control plane in recovery mode.
    #[arg(long, env = "OTTERD_PLATFORM_RECOVERY")]
    platform_recovery: bool,
}

#[derive(Debug, clap::Args, Clone)]
struct UpdatePaths {
    /// Where the A/B slots live.
    #[arg(long, env = "OTTERD_UPDATE_ROOT", default_value = "/usr/lib/otterd")]
    root: PathBuf,
    /// The pinned release keys.
    #[arg(
        long,
        env = "OTTERD_RELEASE_KEYS",
        default_value = "/etc/otterd/release-keys.json"
    )]
    release_keys: PathBuf,
}

#[derive(Debug, Subcommand)]
enum UpdateCmd {
    /// First installation: put this signed release's binary in slot a.
    Install {
        #[command(flatten)]
        paths: UpdatePaths,
        #[arg(long)]
        release: PathBuf,
        #[arg(long)]
        binary: PathBuf,
    },
    /// Stage a signed release in the inactive slot; the next start tries it.
    Stage {
        #[command(flatten)]
        paths: UpdatePaths,
        #[arg(long)]
        release: PathBuf,
        #[arg(long)]
        binary: PathBuf,
    },
    /// Replace the pinned release keys with a set signed by a current key.
    RotateKeys {
        #[command(flatten)]
        paths: UpdatePaths,
        #[arg(long)]
        replacement: PathBuf,
    },
    /// The slots, the active one and any pending update.
    Status {
        #[command(flatten)]
        paths: UpdatePaths,
    },
}

#[derive(Debug, Subcommand)]
enum PlatformCmd {
    /// Activate the first signed platform manifest on this host (daemon stopped).
    Install {
        #[command(flatten)]
        paths: Paths,
        /// Signed `PlatformBootManifest` envelope (JSON).
        #[arg(long)]
        manifest: PathBuf,
    },
    /// Update the platform to a newer signed manifest (daemon stopped).
    Update {
        #[command(flatten)]
        paths: Paths,
        #[arg(long)]
        manifest: PathBuf,
    },
    /// Roll back an update interrupted before the schema boundary (daemon stopped).
    Rollback {
        #[command(flatten)]
        paths: Paths,
    },
    /// Continue an interrupted update forward at the next boot.
    Resume {
        #[command(flatten)]
        paths: Paths,
    },
}

async fn enroll(paths: &Paths, token: &str, roles: &[String], hetzner: bool) -> Result<(), String> {
    let keys = KeyStore::new(&paths.keys_dir)
        .current()
        .map_err(|e| e.to_string())?;
    let roles = roles
        .iter()
        .map(|r| {
            serde_json::from_value(serde_json::Value::String(r.clone()))
                .map_err(|_| format!("unknown role {r}"))
        })
        .collect::<Result<Vec<otterd_proto::identity::NodeRole>, String>>()?;
    let provider = otterd_sys::host::HetznerMetadata;
    let host = otterd_sys::host::host_binding(
        hetzner.then_some(&provider as &dyn otterd_sys::host::ProviderIdentity),
    )
    .map_err(|e| e.to_string())?;
    if hetzner && host.provider.is_none() {
        return Err("the Hetzner metadata service did not name this server".into());
    }
    let mut facts = otterd_sys::host::host_facts().map_err(|e| e.to_string())?;
    let mut docker = DockerClient::new(&paths.docker_socket, Duration::from_secs(5));
    facts.docker_version = docker.negotiate().await.ok().map(|v| v.version);
    let request = otterd_identity::rotation::enroll_request(
        &keys,
        token,
        host,
        facts,
        roles,
        env!("CARGO_PKG_VERSION"),
    )
    .map_err(|e| e.to_string())?;
    println!(
        "{}",
        serde_json::to_string_pretty(&request).map_err(|e| e.to_string())?
    );
    Ok(())
}

fn keygen(paths: &Paths) -> Result<(), String> {
    let keys = KeyStore::new(&paths.keys_dir)
        .create()
        .map_err(|e| e.to_string())?;
    let public = keys.public();
    println!(
        "{}",
        serde_json::json!({"keys": public, "identityKeyId": public.identity.key_id()})
    );
    Ok(())
}

async fn managed_containers_exist(paths: &Paths) -> Result<bool, String> {
    let mut docker = DockerClient::new(&paths.docker_socket, Duration::from_secs(10));
    docker
        .negotiate()
        .await
        .map_err(|e| format!("cannot check managed containers: {e}"))?;
    let filters = otterd_engine::urlencode(&format!(
        r#"{{"label":["{}=1"]}}"#,
        otterd_engine::LABEL_MANAGED
    ));
    let r = docker
        .get(&format!("/containers/json?all=1&filters={filters}"))
        .await
        .map_err(|e| e.to_string())?;
    let rows: Vec<serde_json::Value> = r.json().map_err(|e| e.to_string())?;
    Ok(!rows.is_empty())
}

async fn init(paths: &Paths, certificate: &Path, cp_key: &str) -> Result<(), String> {
    if paths.journal.exists() {
        return Err(format!(
            "{} exists: a journal is authority and is never re-created",
            paths.journal.display()
        ));
    }
    if managed_containers_exist(paths).await? {
        return Err("otterd-managed containers exist without a journal: this is journal loss, use the recovery procedure".into());
    }
    let keys = KeyStore::new(&paths.keys_dir)
        .current()
        .map_err(|e| e.to_string())?;
    let pinned: PublicKey =
        serde_json::from_value(serde_json::json!(cp_key)).map_err(|e| format!("--cp-key: {e}"))?;
    let env: SignedEnvelope =
        serde_json::from_slice(&std::fs::read(certificate).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let cert: EnrollCertificate = env
        .verify(&[pinned], SignContext::Enroll)
        .map_err(|e| e.to_string())?;
    if cert.identity_key_id != keys.identity_public().key_id() {
        return Err("the certificate binds another identity key".into());
    }
    if cert.key_epoch != keys.epoch() {
        return Err(format!(
            "the certificate is for key epoch {}, the key store holds {}",
            cert.key_epoch,
            keys.epoch()
        ));
    }
    let control_url = cert.control_url.clone();
    let mut journal =
        Journal::create(&paths.journal, env!("CARGO_PKG_VERSION")).map_err(|e| e.to_string())?;
    journal
        .append(Record::Identity {
            install_id: cert.install_id,
            node_id: cert.node_id,
            node_epoch: cert.node_epoch,
            key_epoch: cert.key_epoch,
            identity_key_id: cert.identity_key_id,
            cp_keys: cert.cp_keys,
            recovery_key: cert.recovery_key,
            host: cert.host,
        })
        .map_err(|e| e.to_string())?;
    println!(
        "{}",
        serde_json::json!({"journal": paths.journal, "controlUrl": control_url})
    );
    Ok(())
}

/// Open the journal and the key epoch it records. A missing or corrupt
/// journal, or keys that disagree with it, is recovery: exit
/// [`EXIT_NO_INVENTORY`] so systemd does not restart into the same state.
fn open_journal_and_keys(paths: &Paths) -> Result<(Journal, NodeKeyset), (u8, String)> {
    let journal = match Journal::open(&paths.journal) {
        Ok((j, report)) => {
            tracing::info!(
                entries = report.entries,
                torn_tail = report.truncated_torn_tail_bytes,
                "journal opened"
            );
            j
        }
        Err(e @ (JournalError::Missing { .. } | JournalError::Corrupt { .. })) => {
            return Err((
                EXIT_NO_INVENTORY,
                format!("{e}; refusing every start (recovery required)"),
            ));
        }
        Err(e) => return Err((1, e.to_string())),
    };
    // The journal decides the key epoch; a rotation that was journalled but
    // not yet activated is completed here, any other disagreement is recovery.
    let key_epoch = journal
        .state()
        .identity
        .as_ref()
        .map(|i| i.key_epoch)
        .ok_or_else(|| {
            (
                EXIT_NO_INVENTORY,
                "the journal has no identity; refusing every start (recovery required)".into(),
            )
        })?;
    let keys = KeyStore::new(&paths.keys_dir)
        .reconcile(key_epoch)
        .map_err(|e| (EXIT_NO_INVENTORY, e.to_string()))?;
    Ok((journal, keys))
}

/// Open the journal and keys, record a new incarnation (boot quarantine), and
/// attach the Engine without waiting on it.
async fn start_node(args: &RunArgs) -> Result<Node, (u8, String)> {
    let fail = |e: String| (1, e);
    let paths = &args.paths;
    let (mut journal, keys) = open_journal_and_keys(paths)?;
    let incarnation = Incarnation::mint().map_err(|e| fail(e.to_string()))?;
    let boot: BootId = otterd_sys::host::kernel_boot_id()
        .map_err(|e| fail(e.to_string()))?
        .parse()
        .map_err(|e: otterd_proto::ids::IdError| fail(e.to_string()))?;
    journal
        .append(Record::ProcessStarted {
            incarnation: incarnation.clone(),
            boot_id: boot.clone(),
        })
        .map_err(|e| fail(e.to_string()))?;
    tracing::info!(%incarnation, %boot, "process started: boot quarantine");
    let mut docker = DockerClient::new(
        &paths.docker_socket,
        Duration::from_millis(args.engine_timeout_ms),
    );
    // Never wait on the Engine before serving: inspect and /version can hang.
    let engine_version =
        match tokio::time::timeout(Duration::from_secs(5), docker.negotiate()).await {
            Ok(Ok(v)) => v.version,
            _ => "unknown".into(),
        };
    let engine = EngineAdapter::new(
        docker,
        JournalHandle::new(journal),
        boot,
        incarnation.clone(),
        engine_incarnation(&engine_version, &paths.docker_pid_file),
    );
    Ok(Node::new(
        LifecycleConfig {
            staging_root: args.staging_root.clone(),
            stop_grace: Duration::from_secs(args.stop_grace_s),
            boot_barrier_profile: args.boot_barrier_profile.clone(),
        },
        engine,
        keys.identity().clone(),
        incarnation,
        Progress::default(),
    ))
}

/// The platform supervisor on the bootstrap journal, with its own Engine
/// adapter and the node's recovery key.
async fn open_platform(
    paths: &Paths,
    recovery_key: PublicKey,
    boot: BootId,
    incarnation: Incarnation,
    create: bool,
) -> Result<Platform, String> {
    let path = paths.bootstrap_dir.join("boot.journal");
    let journal = if path.exists() {
        Journal::open(&path).map_err(|e| e.to_string())?.0
    } else if create {
        std::fs::create_dir_all(&paths.bootstrap_dir).map_err(|e| e.to_string())?;
        Journal::create(&path, env!("CARGO_PKG_VERSION")).map_err(|e| e.to_string())?
    } else {
        return Err(format!(
            "{} is missing: no platform installed",
            path.display()
        ));
    };
    let mut docker = DockerClient::new(&paths.docker_socket, Duration::from_secs(120));
    docker.negotiate().await.map_err(|e| e.to_string())?;
    Ok(Platform::new(
        PlatformConfig {
            dir: paths.bootstrap_dir.clone(),
            boot_barrier_profile: String::new(),
            ready_timeout: Duration::from_secs(180),
        },
        EngineAdapter::new(
            docker,
            JournalHandle::new(journal),
            boot,
            incarnation,
            "platform".into(),
        ),
        recovery_key,
    ))
}

async fn platform_install(paths: &Paths, manifest: &Path) -> Result<(), String> {
    let (state, _) = Journal::read_snapshot(&paths.journal).map_err(|e| e.to_string())?;
    let id = state
        .identity
        .ok_or("the node journal has no identity; enroll first")?;
    let boot: BootId = otterd_sys::host::kernel_boot_id()
        .map_err(|e| e.to_string())?
        .parse()
        .map_err(|e: otterd_proto::ids::IdError| e.to_string())?;
    let incarnation = Incarnation::mint().map_err(|e| e.to_string())?;
    let p = open_platform(paths, id.recovery_key, boot, incarnation, true).await?;
    let env: SignedEnvelope =
        serde_json::from_slice(&std::fs::read(manifest).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let host = otterd_sys::host::host_binding(None).map_err(|e| e.to_string())?;
    let digest = p.install(&env, &host).await.map_err(|e| e.to_string())?;
    println!("{}", serde_json::json!({"activeManifest": digest}));
    Ok(())
}

fn read_envelope(path: &Path) -> Result<SignedEnvelope, String> {
    serde_json::from_slice(&std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?)
        .map_err(|e| format!("{}: {e}", path.display()))
}

fn verified_release(
    paths: &UpdatePaths,
    release: &Path,
) -> Result<otterd_proto::release::ReleaseManifest, String> {
    let keys = otterd_update::keys::load(&paths.release_keys).map_err(|e| e.to_string())?;
    otterd_update::keys::verify_release(
        &keys,
        &read_envelope(release)?,
        otterd_journal::now_unix_ms(),
    )
    .map_err(|e| e.to_string())
}

fn update_cmd(cmd: UpdateCmd) -> Result<(), String> {
    let out = match cmd {
        UpdateCmd::Install {
            paths,
            release,
            binary,
        } => {
            let r = verified_release(&paths, &release)?;
            let bytes = std::fs::read(&binary).map_err(|e| e.to_string())?;
            let a = r
                .artifact(std::env::consts::ARCH)
                .ok_or("the release has no binary for this architecture")?;
            if otterd_proto::ids::Sha256Hex::digest(&bytes) != a.sha256 {
                return Err("the binary does not match the signed release".into());
            }
            otterd_update::Layout::new(&paths.root)
                .install(
                    &bytes,
                    otterd_update::SlotInfo {
                        version: r.version.clone(),
                        sha256: a.sha256.clone(),
                        protocol: r.protocol,
                        journal_format: r.journal_format,
                    },
                )
                .map_err(|e| e.to_string())?;
            serde_json::json!({"installed": r.version})
        }
        UpdateCmd::Stage {
            paths,
            release,
            binary,
        } => {
            let r = verified_release(&paths, &release)?;
            let bytes = std::fs::read(&binary).map_err(|e| e.to_string())?;
            let slot = otterd_update::Layout::new(&paths.root)
                .stage(
                    &r,
                    std::env::consts::ARCH,
                    &bytes,
                    otterd_proto::version::JOURNAL_FORMAT,
                )
                .map_err(|e| e.to_string())?;
            serde_json::json!({"staged": r.version, "slot": slot, "next": "restart otterd to try it"})
        }
        UpdateCmd::RotateKeys { paths, replacement } => {
            let current =
                otterd_update::keys::load(&paths.release_keys).map_err(|e| e.to_string())?;
            let next = otterd_update::keys::rotate(
                &current,
                &read_envelope(&replacement)?,
                otterd_journal::now_unix_ms(),
            )
            .map_err(|e| e.to_string())?;
            otterd_update::keys::store(&paths.release_keys, &next).map_err(|e| e.to_string())?;
            serde_json::json!({"releaseKeySerial": next.serial})
        }
        UpdateCmd::Status { paths } => serde_json::to_value(
            otterd_update::Layout::new(&paths.root)
                .state()
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?,
    };
    println!("{out}");
    Ok(())
}

/// The A/B upgrader, when this node was installed with `otterd update install`.
fn upgrader(args: &RunArgs) -> Result<Option<Arc<Upgrader>>, String> {
    let layout = otterd_update::Layout::new(&args.update_root);
    if layout.state().is_err() {
        return Ok(None);
    }
    Upgrader::new(layout, args.release_keys.clone(), &args.release_url).map(|u| Some(Arc::new(u)))
}

/// A pending A/B update commits once this binary completed a healthy pass.
fn commit_update_if_pending(root: &Path) {
    let layout = otterd_update::Layout::new(root);
    if layout.state().is_err() {
        return;
    }
    match std::env::current_exe()
        .map_err(|e| e.to_string())
        .and_then(|exe| layout.commit(&exe).map_err(|e| e.to_string()))
    {
        Ok(Some(v)) => tracing::info!(version = %v, "update committed: this release is now active"),
        Ok(None) => {}
        Err(e) => tracing::error!(error = %e, "could not commit the pending update"),
    }
}

async fn open_platform_offline(paths: &Paths) -> Result<Platform, String> {
    let (state, _) = Journal::read_snapshot(&paths.journal).map_err(|e| e.to_string())?;
    let id = state.identity.ok_or("the node journal has no identity")?;
    let boot: BootId = otterd_sys::host::kernel_boot_id()
        .map_err(|e| e.to_string())?
        .parse()
        .map_err(|e: otterd_proto::ids::IdError| e.to_string())?;
    let incarnation = Incarnation::mint().map_err(|e| e.to_string())?;
    open_platform(paths, id.recovery_key, boot, incarnation, false).await
}

/// `platform update` (with a manifest) or `platform rollback` (without).
async fn platform_offline(paths: &Paths, manifest: Option<&Path>) -> Result<(), String> {
    let p = open_platform_offline(paths).await?;
    let id = match manifest {
        Some(m) => {
            let (state, _) = Journal::read_snapshot(&paths.journal).map_err(|e| e.to_string())?;
            let host = otterd_sys::host::host_binding(None).map_err(|e| e.to_string())?;
            p.update(&read_envelope(m)?, &host, state.revoked_below_term())
                .await
                .map_err(|e| e.to_string())?
        }
        None => p.rollback().await.map_err(|e| e.to_string())?,
    };
    println!(
        "{}",
        serde_json::json!({"update": id, "status": p.status()})
    );
    Ok(())
}

async fn platform_resume(paths: &Paths) -> Result<(), String> {
    let p = open_platform_offline(paths).await?;
    let id = p.request_resume().map_err(|e| e.to_string())?;
    println!("{}", serde_json::json!({"resumeRequested": id}));
    Ok(())
}

/// Boot the platform in the background, retrying while blocked; the tenant
/// gate opens only once it is up.
fn supervise_platform(node: Arc<Node>, platform: Arc<Platform>, recovery: bool) {
    tokio::spawn(async move {
        let host = match otterd_sys::host::host_binding(None) {
            Ok(h) => h,
            Err(e) => {
                tracing::error!(error = %e, "cannot read the host binding; the platform stays down");
                return;
            }
        };
        loop {
            let revoked = node
                .engine
                .journal()
                .snapshot()
                // Unreadable journal: treat everything as revoked, never boot on a guess.
                .map_or(otterd_proto::U53::MAX, |s| s.revoked_below_term());
            match platform.boot(&host, revoked, recovery).await {
                Ok(()) => {
                    if let Ok(mut g) = node.gate.lock() {
                        *g = TenantGate {
                            open: true,
                            reason: "platform up".into(),
                        };
                    }
                    tracing::info!("platform up; tenant gate open");
                    return;
                }
                Err(e) => {
                    tracing::error!(error = %e, "platform boot blocked; retrying");
                    tokio::time::sleep(Duration::from_secs(10)).await;
                }
            }
        }
    });
}

/// The control-plane connection, if one is configured.
struct Control {
    outbox: Outbox,
    handler: Arc<ControlHandler>,
}

/// Start the control-plane connection, if one is configured.
async fn connect(
    args: &RunArgs,
    node: &Arc<Node>,
    reporter: &SlotReporter,
    upgrader: Option<Arc<Upgrader>>,
    platform: Option<Arc<Platform>>,
    shutdown: watch::Receiver<bool>,
) -> Result<Option<Control>, String> {
    let Some(url) = &args.control_url else {
        tracing::warn!("no control URL: running disconnected; no command can arrive");
        return Ok(None);
    };
    let trust = match (&args.control_ca, args.control_ca_only) {
        (Some(p), true) => Trust::Only(p.clone()),
        (Some(p), false) => Trust::PublicRootsAnd(p.clone()),
        (None, true) => return Err("--control-ca-only needs --control-ca".into()),
        (None, false) => Trust::PublicRoots,
    };
    let tls = client_config(&trust).map_err(|e| e.to_string())?;
    let mut handler = ControlHandler::new(Arc::clone(node), reporter.clone()).with_key_rotation(
        Arc::new(KeyRotator::new(KeyStore::new(&args.paths.keys_dir))),
    );
    if let Some(u) = upgrader {
        handler = handler.with_upgrader(u);
    }
    if let Some(p) = platform {
        handler = handler.with_platform(p);
    }
    let lease = Arc::new(LeaseKeeper::new());
    handler = handler.with_lease(Arc::clone(&lease));
    let mut docker = DockerClient::new(&args.paths.docker_socket, Duration::from_secs(10));
    let telemetry = match docker.negotiate().await {
        Ok(_) => match Telemetry::start(Arc::clone(node), docker) {
            Ok(t) => Some(t),
            Err(e) => {
                tracing::error!(error = %e, "telemetry not started");
                None
            }
        },
        Err(e) => {
            tracing::warn!(error = %e, "Engine unreachable: telemetry not started");
            None
        }
    };
    if let Some((t, _)) = &telemetry {
        handler = handler.with_telemetry(Arc::clone(t));
    }
    let handler = Arc::new(handler);
    let manager = Arc::new(ConnectionManager::new(
        TransportConfig::new(url.clone(), tls),
        Arc::clone(&handler),
        Arc::new(NodeIdentitySource::new(
            Arc::clone(node),
            env!("CARGO_PKG_VERSION"),
        )),
    ));
    let outbox = manager.outbox();
    handler.attach(outbox.clone());
    tokio::spawn(async move { manager.run(shutdown).await });
    if let Some((t, records)) = telemetry {
        tokio::spawn(Arc::clone(&t).run_metrics(
            outbox.clone(),
            Duration::from_secs(args.metrics_interval_s.max(5)),
        ));
        tokio::spawn(t.run_probes(outbox.clone(), records));
    }
    let lease_node = Arc::clone(node);
    let lease_outbox = outbox.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(otterd::lease::renew_interval());
        loop {
            tick.tick().await;
            match lease.request(&lease_node) {
                Ok(frame) => {
                    let _ = lease_outbox.send(frame);
                }
                Err(e) => tracing::warn!(error = %e, "cannot build a lease request"),
            }
            lease.enforce(&lease_node).await;
        }
    });
    Ok(Some(Control { outbox, handler }))
}

/// With `--platform`: close the tenant gate and boot the platform in the
/// background.
async fn start_platform(
    args: &RunArgs,
    node: &Arc<Node>,
) -> Result<Option<Arc<Platform>>, (u8, String)> {
    let fail = |e: String| (1, e);
    Ok(if args.platform {
        if let Ok(mut g) = node.gate.lock() {
            *g = TenantGate {
                open: false,
                reason: "platform booting".into(),
            };
        }
        let state = node
            .engine
            .journal()
            .snapshot()
            .map_err(|e| fail(e.to_string()))?;
        let recovery_key = state
            .identity
            .map(|i| i.recovery_key)
            .ok_or_else(|| fail("no node identity".into()))?;
        let platform = open_platform(
            &args.paths,
            recovery_key,
            node.engine.boot_id().clone(),
            node.incarnation.clone(),
            false,
        )
        .await
        .map_err(fail)?;
        let platform = Arc::new(platform);
        supervise_platform(
            Arc::clone(node),
            Arc::clone(&platform),
            args.platform_recovery,
        );
        Some(platform)
    } else {
        None
    })
}

async fn run(args: RunArgs) -> Result<(), (u8, String)> {
    let fail = |e: String| (1, e);
    let node = Arc::new(start_node(&args).await?);
    let progress = node.progress.clone();
    let notifier = Notifier::from_env();
    tokio::spawn(otterd::watchdog::run(progress.clone(), notifier.clone()));
    let platform = start_platform(&args, &node).await?;
    let reporter = SlotReporter::default();
    let (shutdown, shutdown_rx) = watch::channel(false);
    let upgrader = upgrader(&args).map_err(fail)?;
    let control = connect(
        &args,
        &node,
        &reporter,
        upgrader.clone(),
        platform.clone(),
        shutdown_rx,
    )
    .await
    .map_err(fail)?;
    let api_node = Arc::clone(&node);
    let api_session = control.as_ref().map(|c| Arc::clone(&c.handler));
    let api_socket = args.socket.clone();
    let api_platform = platform.clone();
    tokio::spawn(async move {
        if let Err(e) = otterd::api::serve(api_node, api_session, api_platform, &api_socket).await {
            tracing::error!(error = %e, "control socket stopped");
        }
    });
    if let Err(e) = notifier.ready() {
        tracing::warn!(error = %e, "sd_notify READY failed");
    }
    let mut tick = tokio::time::interval(Duration::from_millis(args.reconcile_ms));
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .map_err(|e| fail(e.to_string()))?;
    loop {
        tokio::select! {
            _ = tick.tick() => {
                if let Err(e) = node.reconcile().await {
                    tracing::warn!(error = %e, "reconcile pass finished with errors");
                }
                progress.pass_completed();
                if progress.snapshot().passes == 1 {
                    commit_update_if_pending(&args.update_root);
                }
                if let Some(c) = &control {
                    reporter.after_pass(&node, platform.as_deref(), &c.outbox);
                }
                let _ = notifier.status(&format!("passes={} engine={}", progress.snapshot().passes,
                    node.engine_reachable.load(std::sync::atomic::Ordering::SeqCst)));
            }
            () = async {
                match &upgrader {
                    Some(u) => u.restart_requested().await,
                    None => std::future::pending().await,
                }
            } => {
                let _ = shutdown.send(true);
                let _ = notifier.stopping();
                tracing::warn!("restarting into the staged release");
                // Let the upgrade's answer reach the control plane first.
                tokio::time::sleep(Duration::from_secs(1)).await;
                return Ok(());
            }
            _ = term.recv() => {
                let _ = shutdown.send(true);
                let _ = notifier.stopping();
                tracing::info!("stopping; workloads keep running under their grants");
                return Ok(());
            }
        }
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .json()
        .init();
    let cli = Cli::parse();
    let result = match cli.command {
        Cmd::Keygen { paths } => keygen(&paths).map_err(|e| (1, e)),
        Cmd::Init {
            paths,
            certificate,
            cp_key,
        } => init(&paths, &certificate, &cp_key)
            .await
            .map_err(|e| (1, e)),
        Cmd::Run(args) => run(*args).await,
        Cmd::Update(cmd) => update_cmd(cmd).map_err(|e| (1, e)),
        Cmd::Enroll {
            paths,
            token,
            roles,
            hetzner,
        } => enroll(&paths, &token, &roles, hetzner)
            .await
            .map_err(|e| (1, e)),
        Cmd::Platform(PlatformCmd::Update { paths, manifest }) => {
            platform_offline(&paths, Some(&manifest))
                .await
                .map_err(|e| (1, e))
        }
        Cmd::Platform(PlatformCmd::Rollback { paths }) => {
            platform_offline(&paths, None).await.map_err(|e| (1, e))
        }
        Cmd::Platform(PlatformCmd::Resume { paths }) => {
            platform_resume(&paths).await.map_err(|e| (1, e))
        }
        Cmd::Platform(PlatformCmd::Install { paths, manifest }) => {
            platform_install(&paths, &manifest)
                .await
                .map_err(|e| (1, e))
        }
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err((code, message)) => {
            tracing::error!(reason = %message, "otterd exiting");
            eprintln!("otterd: {message}");
            ExitCode::from(code)
        }
    }
}
