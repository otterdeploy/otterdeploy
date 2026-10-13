//! Telemetry over the control session: host and container metrics from the
//! collector, and the results of the health checks the control plane
//! configured, sent as credit-limited `telemetry` batches.
//!
//! - Metrics: one collector round per interval. Containers are attributed to
//!   the resource, generation and attempt the journal says created them;
//!   containers otterd did not create are left out.
//! - Health: `health.configure` replaces the whole set of checks. Each is
//!   admitted to the probe executor (or refused with the reason, or a
//!   configuration error); every round becomes a probe result.
//! - A batch the transport cannot take (no session, or its queue is full) is
//!   dropped and counted; the control plane sees the gap as a missing round,
//!   never as a failure.

use crate::lifecycle::{Node, NodeError};
use otterd_journal::Submission;
use otterd_metrics::{
    Collector, ContainerCollector, ContainerRef, ContainerSubject, HostCollector, HostPaths,
    RoundTiming, SampleContext,
};
use otterd_probe::wire::{probe_result, round_spec};
use otterd_probe::{
    Check, Command as ProbeCommand, Executor, Pool, Probe, Profile, Resolver, RoundRecord,
};
use otterd_proto::U53;
use otterd_proto::command::CommandResult;
use otterd_proto::health::{HealthCheck, ObservationIdentity, ProbeResult};
use otterd_proto::ids::{BatchId, CheckId, SubjectId};
use otterd_proto::journal::EngineOutcome;
use otterd_proto::metrics::{MetricSample, SampleBatch};
use otterd_transport::{Outbox, SendError};
use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, oneshot};

#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryStats {
    pub batches_sent: u64,
    pub batches_dropped: u64,
    pub probe_results: u64,
}

#[derive(Debug)]
pub struct Telemetry {
    node: Arc<Node>,
    ctx: SampleContext,
    collector: tokio::sync::Mutex<Collector>,
    last_round: Mutex<Option<(Instant, Vec<MetricSample>)>>,
    probes: mpsc::Sender<ProbeCommand<CheckId, Probe>>,
    checks: Mutex<BTreeMap<CheckId, HealthCheck>>,
    resolver: Arc<Resolver>,
    probe_seq: AtomicU64,
    sent: AtomicU64,
    dropped: AtomicU64,
    results: AtomicU64,
}

fn ms(d: Duration) -> U53 {
    U53::new(u64::try_from(d.as_millis()).unwrap_or(u64::MAX)).unwrap_or(U53::MAX)
}

fn internal(e: impl std::fmt::Display) -> NodeError {
    NodeError::Internal(e.to_string())
}

impl Telemetry {
    /// Build the collector and start the probe executor. Returns the probe
    /// rounds' receiver for [`Telemetry::run_probes`].
    pub fn start(
        node: Arc<Node>,
        docker: otterd_engine::DockerClient,
    ) -> Result<(Arc<Self>, mpsc::Receiver<RoundRecord<CheckId>>), NodeError> {
        let state = node.state()?;
        let id = state
            .identity
            .ok_or_else(|| NodeError::Refused("no node identity".into()))?;
        let ctx = SampleContext {
            install_id: id.install_id,
            org_id: None,
            node_id: id.node_id.clone(),
            node_epoch: id.node_epoch,
            boot_id: node.engine.boot_id().clone(),
            host_subject: id.node_id.as_str().parse().map_err(internal)?,
        };
        let paths = HostPaths::new("/proc", "/sys");
        let collector = Collector::new(
            U53::ZERO,
            HostCollector::new(paths.clone()),
            Some(ContainerCollector::new(docker, paths)),
        );
        let (commands, command_rx) = mpsc::channel(64);
        let (records, record_rx) = mpsc::channel(1024);
        tokio::spawn(Executor::<CheckId, Probe>::new(Profile::MONITOR).run(records, command_rx));
        let resolver = Arc::new(Resolver::from_resolv_conf(
            &std::fs::read_to_string("/etc/resolv.conf").unwrap_or_default(),
        ));
        Ok((
            Arc::new(Self {
                node,
                ctx,
                collector: tokio::sync::Mutex::new(collector),
                last_round: Mutex::new(None),
                probes: commands,
                checks: Mutex::new(BTreeMap::new()),
                resolver,
                probe_seq: AtomicU64::new(0),
                sent: AtomicU64::new(0),
                dropped: AtomicU64::new(0),
                results: AtomicU64::new(0),
            }),
            record_rx,
        ))
    }

    #[must_use]
    pub fn stats(&self) -> TelemetryStats {
        TelemetryStats {
            batches_sent: self.sent.load(Ordering::SeqCst),
            batches_dropped: self.dropped.load(Ordering::SeqCst),
            probe_results: self.results.load(Ordering::SeqCst),
        }
    }

    /// Container id → the subject the journal says created it.
    fn subjects(&self) -> HashMap<String, ContainerSubject> {
        let Ok(state) = self.node.state() else {
            return HashMap::new();
        };
        let mut out = HashMap::new();
        for m in state.mutations.values() {
            let Submission::Settled {
                outcome: EngineOutcome::Created { container },
            } = &m.submission
            else {
                continue;
            };
            let Ok(subject_id) = m.record.slot.resource_id.as_str().parse::<SubjectId>() else {
                continue;
            };
            let generation = m
                .record
                .grant_id
                .as_ref()
                .and_then(|g| state.grants.get(g))
                .map(|g| g.grant.generation);
            out.insert(
                container.to_string(),
                ContainerSubject {
                    subject_id,
                    org_id: None,
                    generation,
                    attempt_id: Some(m.record.attempt_id.clone()),
                },
            );
        }
        out
    }

    /// One metrics round (or the last one, if younger than `cache`).
    pub async fn sample(&self, interval: Duration, cache: Duration) -> Vec<MetricSample> {
        if let Ok(g) = self.last_round.lock()
            && let Some((at, samples)) = g.as_ref()
            && at.elapsed() <= cache
        {
            return samples.clone();
        }
        let subjects = self.subjects();
        let timing = RoundTiming {
            observed_at: otterd_journal::now_unix_ms(),
            clock_uncertainty: U53::ZERO,
            interval: ms(interval),
            ttl: ms(interval * 3),
        };
        let round = self
            .collector
            .lock()
            .await
            .collect(&self.ctx, timing, |c: &ContainerRef<'_>| {
                subjects.get(c.id).cloned()
            })
            .await;
        if let Ok(mut g) = self.last_round.lock() {
            *g = Some((Instant::now(), round.samples.clone()));
        }
        round.samples
    }

    fn batch(&self, metrics: Vec<MetricSample>, probes: Vec<ProbeResult>) -> Option<SampleBatch> {
        Some(SampleBatch {
            batch_id: BatchId::mint().ok()?,
            node_id: self.ctx.node_id.clone(),
            node_epoch: self.ctx.node_epoch,
            boot_id: self.ctx.boot_id.clone(),
            live: true,
            probes,
            metrics,
            markers: vec![],
            signals: vec![],
        })
    }

    fn send(&self, outbox: &Outbox, batch: SampleBatch) {
        match outbox.send_telemetry(batch) {
            Ok(()) => {
                self.sent.fetch_add(1, Ordering::SeqCst);
            }
            Err(SendError::NotConnected | SendError::TelemetryFull) => {
                self.dropped.fetch_add(1, Ordering::SeqCst);
            }
        }
    }

    /// Send a metrics round every `interval`.
    pub async fn run_metrics(self: Arc<Self>, outbox: Outbox, interval: Duration) {
        let mut tick = tokio::time::interval(interval);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tick.tick().await;
            let samples = self.sample(interval, Duration::ZERO).await;
            if let Some(b) = self.batch(samples, vec![]) {
                self.send(&outbox, b);
            }
        }
    }

    /// Turn probe rounds into results and send them, at most every second.
    pub async fn run_probes(
        self: Arc<Self>,
        outbox: Outbox,
        mut records: mpsc::Receiver<RoundRecord<CheckId>>,
    ) {
        let mut pending: Vec<ProbeResult> = Vec::new();
        let mut flush = tokio::time::interval(Duration::from_secs(1));
        loop {
            tokio::select! {
                rec = records.recv() => {
                    let Some(rec) = rec else { return };
                    if let Some(r) = self.result(&rec) {
                        pending.push(r);
                        self.results.fetch_add(1, Ordering::SeqCst);
                    }
                    if pending.len() >= 100
                        && let Some(b) = self.batch(vec![], std::mem::take(&mut pending)) {
                        self.send(&outbox, b);
                    }
                }
                _ = flush.tick() => {
                    if !pending.is_empty()
                        && let Some(b) = self.batch(vec![], std::mem::take(&mut pending)) {
                        self.send(&outbox, b);
                    }
                }
            }
        }
    }

    fn result(&self, rec: &RoundRecord<CheckId>) -> Option<ProbeResult> {
        let check = self.checks.lock().ok()?.get(&rec.key)?.clone();
        let spec = round_spec(&check).ok()?;
        let seq = self.probe_seq.fetch_add(1, Ordering::SeqCst);
        Some(probe_result(
            rec,
            ObservationIdentity {
                install_id: check.install_id.clone(),
                org_id: check.org_id.clone(),
                check_id: check.id.clone(),
                check_revision: check.revision,
                subject_id: check.subject_id.clone(),
                generation: check.generation,
                attempt_id: check.attempt_id.clone(),
                vantage: check.vantage,
                observer_node_id: self.ctx.node_id.clone(),
                node_epoch: self.ctx.node_epoch,
                boot_id: self.ctx.boot_id.clone(),
                sample_seq: U53::new(seq).unwrap_or(U53::MAX),
            },
            &spec,
            check.outcome_policy_revision,
            Duration::ZERO,
        ))
    }

    /// `health.configure`: replace the whole set of checks.
    pub async fn configure(&self, checks: &[HealthCheck]) -> Result<CommandResult, NodeError> {
        let old: Vec<CheckId> = self
            .checks
            .lock()
            .map_err(internal)?
            .keys()
            .cloned()
            .collect();
        for key in old {
            let (reply, rx) = oneshot::channel();
            self.probes
                .send(ProbeCommand::Remove { key, reply })
                .await
                .map_err(internal)?;
            let _ = rx.await;
        }
        self.checks.lock().map_err(internal)?.clear();
        let mut admitted = Vec::new();
        let mut refused = Vec::new();
        for check in checks {
            let spec = match otterd_probe::spec::from_contract(
                &check.probe,
                &otterd_probe::spec::NoReferences,
                None,
            ) {
                Ok(s) => s,
                Err(cause) => {
                    refused.push(
                        serde_json::json!({"checkId": check.id, "reason": format!("{cause:?}")}),
                    );
                    continue;
                }
            };
            let round = match round_spec(check) {
                Ok(r) => r,
                Err(e) => {
                    refused.push(serde_json::json!({"checkId": check.id, "reason": e.to_string()}));
                    continue;
                }
            };
            let degraded = check.degraded_after_ms.get();
            let (reply, rx) = oneshot::channel();
            self.probes
                .send(ProbeCommand::Admit {
                    key: check.id.clone(),
                    pool: Pool::User,
                    check: Check {
                        prober: Arc::new(Probe {
                            spec,
                            resolver: Arc::clone(&self.resolver),
                        }),
                        round,
                        degraded_after: (degraded > 0).then(|| Duration::from_millis(degraded)),
                    },
                    reply,
                })
                .await
                .map_err(internal)?;
            match rx.await.map_err(internal)? {
                Ok(_) => {
                    self.checks
                        .lock()
                        .map_err(internal)?
                        .insert(check.id.clone(), check.clone());
                    admitted.push(check.id.clone());
                }
                Err(rejection) => {
                    refused.push(serde_json::json!({"checkId": check.id, "rejection": rejection}));
                }
            }
        }
        Ok(CommandResult::Document {
            schema: "otterd/health-configured/v1".into(),
            body: serde_json::json!({"admitted": admitted, "refused": refused}),
        })
    }
}
