//! Run the collector on its own and print each round as JSON lines of
//! `otterd_proto` metric samples.
//!
//! ```text
//! collect [--interval-ms 30000] [--rounds N] [--docker /var/run/docker.sock | --no-docker] [--summary]
//! ```
//!
//! Every running container is reported under a subject named after its
//! container id. `--summary` prints only counts per round, for long runs
//! where the collector's own footprint is what is being looked at. The wall
//! clock is not disciplined here, so samples claim no clock uncertainty.

use otterd_metrics::{
    Collector, ContainerCollector, ContainerRef, ContainerSubject, DockerClient, HostCollector,
    HostPaths, RoundTiming, SampleContext,
};
use otterd_proto::ids::{BootId, InstallId, NodeId, SubjectId};
use otterd_proto::num::U53;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

struct Args {
    interval: Duration,
    rounds: Option<u64>,
    docker: Option<String>,
    summary: bool,
}

fn parse_args() -> Result<Args, String> {
    let mut args = Args {
        interval: Duration::from_secs(30),
        rounds: None,
        docker: Some("/var/run/docker.sock".into()),
        summary: false,
    };
    let mut it = std::env::args().skip(1);
    while let Some(flag) = it.next() {
        let mut value = || it.next().ok_or(format!("{flag} needs a value"));
        match flag.as_str() {
            "--interval-ms" => {
                let ms: u64 = value()?.parse().map_err(|e| format!("{e}"))?;
                args.interval = Duration::from_millis(ms);
            }
            "--rounds" => args.rounds = Some(value()?.parse().map_err(|e| format!("{e}"))?),
            "--docker" => args.docker = Some(value()?),
            "--no-docker" => args.docker = None,
            "--summary" => args.summary = true,
            other => return Err(format!("unknown flag {other}")),
        }
    }
    Ok(args)
}

fn ms(d: Duration) -> U53 {
    U53::new(u64::try_from(d.as_millis()).unwrap_or(u64::MAX)).unwrap_or(U53::MAX)
}

fn now_ms() -> U53 {
    ms(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default())
}

fn context(paths: &HostPaths) -> Result<SampleContext, String> {
    let id = |e: otterd_proto::ids::IdError| e.to_string();
    let boot = otterd_metrics::kernel_boot_id(paths).map_err(|e| e.to_string())?;
    Ok(SampleContext {
        install_id: InstallId::new("local").map_err(id)?,
        org_id: None,
        node_id: NodeId::new("local").map_err(id)?,
        node_epoch: U53::ONE,
        boot_id: BootId::new(boot).map_err(id)?,
        host_subject: SubjectId::new("local").map_err(id)?,
    })
}

fn by_container_id(c: &ContainerRef<'_>) -> Option<ContainerSubject> {
    Some(ContainerSubject {
        subject_id: SubjectId::new(c.id).ok()?,
        org_id: None,
        generation: None,
        attempt_id: None,
    })
}

fn main() -> Result<(), String> {
    let args = parse_args()?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;
    runtime.block_on(async move {
        let paths = HostPaths::default();
        let ctx = context(&paths)?;
        let containers = args.docker.map(|socket| {
            ContainerCollector::new(
                DockerClient::new(socket, Duration::from_secs(5)),
                paths.clone(),
            )
        });
        let mut collector = Collector::new(U53::ZERO, HostCollector::new(paths), containers);
        let mut tick = tokio::time::interval(args.interval);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut done = 0u64;
        loop {
            tick.tick().await;
            let timing = RoundTiming {
                observed_at: now_ms(),
                clock_uncertainty: U53::ZERO,
                interval: ms(args.interval),
                ttl: ms(args.interval * 3),
            };
            let round = collector.collect(&ctx, timing, by_container_id).await;
            if args.summary {
                let containers = round
                    .samples
                    .iter()
                    .filter(|s| s.identity.dimension_set == "container")
                    .count();
                println!(
                    "{{\"seq\":{},\"samples\":{},\"containers\":{},\"dropped\":{},\"unavailable\":{}}}",
                    collector.next_seq().get().saturating_sub(1),
                    round.samples.len(),
                    containers,
                    round.dimensions_dropped,
                    round.containers_unavailable.is_some()
                );
            } else {
                for sample in &round.samples {
                    println!(
                        "{}",
                        serde_json::to_string(sample).map_err(|e| e.to_string())?
                    );
                }
            }
            done += 1;
            if args.rounds.is_some_and(|n| done >= n) {
                return Ok(());
            }
        }
    })
}
