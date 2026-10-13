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
use otterd::keys::KeyRotator;
use otterd::session::{ControlHandler, NodeIdentitySource, SlotReporter};
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
}

#[derive(Debug, Subcommand)]
enum Cmd {
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

/// The control-plane connection, if one is configured.
struct Control {
    outbox: Outbox,
    handler: Arc<ControlHandler>,
}

/// Start the control-plane connection, if one is configured.
fn connect(
    args: &RunArgs,
    node: &Arc<Node>,
    reporter: &SlotReporter,
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
    let handler = Arc::new(
        ControlHandler::new(Arc::clone(node), reporter.clone()).with_key_rotation(Arc::new(
            KeyRotator::new(KeyStore::new(&args.paths.keys_dir)),
        )),
    );
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
    Ok(Some(Control { outbox, handler }))
}

async fn run(args: RunArgs) -> Result<(), (u8, String)> {
    let fail = |e: String| (1, e);
    let node = Arc::new(start_node(&args).await?);
    let progress = node.progress.clone();
    let notifier = Notifier::from_env();
    tokio::spawn(otterd::watchdog::run(progress.clone(), notifier.clone()));
    let reporter = SlotReporter::default();
    let (shutdown, shutdown_rx) = watch::channel(false);
    let control = connect(&args, &node, &reporter, shutdown_rx).map_err(fail)?;
    let api_node = Arc::clone(&node);
    let api_session = control.as_ref().map(|c| Arc::clone(&c.handler));
    let api_socket = args.socket.clone();
    tokio::spawn(async move {
        if let Err(e) = otterd::api::serve(api_node, api_session, &api_socket).await {
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
                if let Some(c) = &control {
                    reporter.after_pass(&node, &c.outbox);
                }
                let _ = notifier.status(&format!("passes={} engine={}", progress.snapshot().passes,
                    node.engine_reachable.load(std::sync::atomic::Ordering::SeqCst)));
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
