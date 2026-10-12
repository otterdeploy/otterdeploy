//! The journalled Engine boundary.
//!
//! Every mutation is recorded `NotSubmitted`, then fsynced `Submitted`
//! **before** the request is sent, then `Settled` only on a definitive terminal
//! response this adapter knows how to interpret. A timeout, a dropped
//! connection or an unexpected status leaves it `Submitted`: the request may
//! still be queued in dockerd or containerd and take effect later.
//! Nothing here ever clears `Submitted` from an inspect result.

use crate::docker::{DockerClient, EngineResponse, TransportError, urlencode};
use crate::handle::{HandleError, JournalHandle};
use bytes::Bytes;
use http::{Method, StatusCode};
use otterd_journal::NodeState;
use otterd_proto::ids::{
    AttemptId, BootId, ContainerRef, GrantId, Incarnation, MutationId, Sha256Hex, SlotRef,
};
use otterd_proto::journal::{EngineOutcome, MutationRecord, Record, WorkloadClass};
use otterd_proto::lifecycle::{EngineVerb, ProcessObservation};
use serde::Serialize;
use sha2::{Digest as _, Sha256};
use std::collections::BTreeMap;
use std::time::Duration;

pub const LABEL_MANAGED: &str = "dev.otterdeploy.managed";
pub const LABEL_NODE: &str = "dev.otterdeploy.node";
pub const LABEL_SLOT: &str = "dev.otterdeploy.slot";
pub const LABEL_GRANT: &str = "dev.otterdeploy.grant";
pub const LABEL_ATTEMPT: &str = "dev.otterdeploy.attempt";
pub const LABEL_CLASS: &str = "dev.otterdeploy.class";

#[derive(Debug, thiserror::Error)]
pub enum AdapterError {
    #[error("refused before submission: {0}")]
    Refused(String),
    #[error(transparent)]
    Journal(#[from] HandleError),
    #[error("container config must be a JSON object")]
    BadConfig,
    #[error("mutation id: {0}")]
    Mint(String),
}

/// One Engine operation, always on an immutable per-attempt object.
#[derive(Debug, Clone)]
pub enum EngineOp {
    Create {
        name: String,
        config: serde_json::Value,
    },
    Start {
        container: ContainerRef,
        name: String,
    },
    /// Legacy/platform adoption only; never a shortcut around a new attempt.
    Restart {
        container: ContainerRef,
        name: String,
        timeout_s: u32,
    },
    Stop {
        container: ContainerRef,
        name: String,
        timeout_s: u32,
    },
    Kill {
        container: ContainerRef,
        name: String,
    },
    Remove {
        container: ContainerRef,
        name: String,
    },
}

impl EngineOp {
    #[must_use]
    pub fn verb(&self) -> EngineVerb {
        match self {
            Self::Create { .. } => EngineVerb::Create,
            Self::Start { .. } => EngineVerb::Start,
            Self::Restart { .. } => EngineVerb::Restart,
            Self::Stop { .. } => EngineVerb::Stop,
            Self::Kill { .. } => EngineVerb::Kill,
            Self::Remove { .. } => EngineVerb::Remove,
        }
    }

    #[must_use]
    pub fn object_name(&self) -> &str {
        match self {
            Self::Create { name, .. }
            | Self::Start { name, .. }
            | Self::Restart { name, .. }
            | Self::Stop { name, .. }
            | Self::Kill { name, .. }
            | Self::Remove { name, .. } => name,
        }
    }

    #[must_use]
    pub fn container(&self) -> Option<&ContainerRef> {
        match self {
            Self::Create { .. } => None,
            Self::Start { container, .. }
            | Self::Restart { container, .. }
            | Self::Stop { container, .. }
            | Self::Kill { container, .. }
            | Self::Remove { container, .. } => Some(container),
        }
    }

    /// Extra time the Engine legitimately takes before answering.
    fn grace(&self) -> Duration {
        match self {
            Self::Stop { timeout_s, .. } | Self::Restart { timeout_s, .. } => {
                Duration::from_secs(u64::from(*timeout_s))
            }
            _ => Duration::ZERO,
        }
    }

    /// The exact HTTP request this op sends (method, path, JSON body).
    fn request(&self) -> (Method, String, Option<&serde_json::Value>) {
        match self {
            Self::Create { name, config } => (
                Method::POST,
                format!("/containers/create?name={}", urlencode(name)),
                Some(config),
            ),
            Self::Start { container, .. } => {
                (Method::POST, format!("/containers/{container}/start"), None)
            }
            Self::Restart {
                container,
                timeout_s,
                ..
            } => (
                Method::POST,
                format!("/containers/{container}/restart?t={timeout_s}"),
                None,
            ),
            Self::Stop {
                container,
                timeout_s,
                ..
            } => (
                Method::POST,
                format!("/containers/{container}/stop?t={timeout_s}"),
                None,
            ),
            Self::Kill { container, .. } => {
                (Method::POST, format!("/containers/{container}/kill"), None)
            }
            Self::Remove { container, .. } => (
                Method::DELETE,
                format!("/containers/{container}?force=false&v=false"),
                None,
            ),
        }
    }
}

#[derive(Debug, Clone)]
pub struct MutationSpec {
    pub class: WorkloadClass,
    pub slot: SlotRef,
    pub grant_id: Option<GrantId>,
    pub attempt_id: AttemptId,
    pub op: EngineOp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "result", rename_all = "kebab-case")]
pub enum SubmitResult {
    #[serde(rename_all = "camelCase")]
    Settled {
        mutation_id: MutationId,
        outcome: EngineOutcome,
    },
    /// Crossed the boundary without a definitive outcome. Stays `Submitted`.
    #[serde(rename_all = "camelCase")]
    Unresolved {
        mutation_id: MutationId,
        reason: String,
    },
}

impl SubmitResult {
    #[must_use]
    pub fn mutation_id(&self) -> &MutationId {
        match self {
            Self::Settled { mutation_id, .. } | Self::Unresolved { mutation_id, .. } => mutation_id,
        }
    }
}

/// Adapter-validated interpretation of one Engine response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Classification {
    Terminal(EngineOutcome),
    Ambiguous(String),
}

/// Map a response to a terminal outcome only where the Engine's semantics are
/// known to be synchronous and final. Everything else, including every 5xx, is
/// ambiguous: dockerd may have handed the work to containerd.
#[must_use]
pub fn classify(verb: EngineVerb, resp: &EngineResponse) -> Classification {
    use Classification::{Ambiguous, Terminal};
    let refused = |r: &EngineResponse| {
        Terminal(EngineOutcome::Refused {
            status: r.status.as_u16(),
            message: r.message(),
        })
    };
    match (verb, resp.status) {
        (EngineVerb::Create, StatusCode::CREATED) => {
            #[derive(serde::Deserialize)]
            struct Created {
                #[serde(rename = "Id")]
                id: String,
            }
            match resp.json::<Created>().map(|c| ContainerRef::new(c.id)) {
                Ok(Ok(container)) => Terminal(EngineOutcome::Created { container }),
                Ok(Err(e)) => Ambiguous(format!("201 with an invalid Id: {e}")),
                Err(e) => Ambiguous(format!("201 without a decodable Id: {e}")),
            }
        }
        (
            EngineVerb::Create,
            StatusCode::BAD_REQUEST | StatusCode::NOT_FOUND | StatusCode::CONFLICT,
        )
        | (
            EngineVerb::Start | EngineVerb::Restart,
            StatusCode::BAD_REQUEST | StatusCode::CONFLICT,
        )
        | (EngineVerb::Remove, StatusCode::CONFLICT) => refused(resp),
        (EngineVerb::Start, StatusCode::NO_CONTENT) => Terminal(EngineOutcome::Started),
        (EngineVerb::Start, StatusCode::NOT_MODIFIED) => Terminal(EngineOutcome::AlreadyStarted),
        (EngineVerb::Restart, StatusCode::NO_CONTENT) => Terminal(EngineOutcome::Restarted),
        (EngineVerb::Stop | EngineVerb::Kill, StatusCode::NO_CONTENT) => {
            Terminal(EngineOutcome::Stopped)
        }
        (EngineVerb::Stop, StatusCode::NOT_MODIFIED) | (EngineVerb::Kill, StatusCode::CONFLICT) => {
            Terminal(EngineOutcome::AlreadyStopped)
        }
        (_, StatusCode::NOT_FOUND) => Terminal(EngineOutcome::Absent),
        (EngineVerb::Remove, StatusCode::NO_CONTENT) => Terminal(EngineOutcome::Removed),
        (_, status) => Ambiguous(format!("status {status}: {}", resp.message())),
    }
}

/// Inspect result. Discovery only: never settles a submission.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerView {
    pub id: String,
    pub name: String,
    pub process: ProcessObservation,
    pub restart_policy: String,
    pub labels: BTreeMap<String, String>,
    pub started_at: String,
    pub finished_at: String,
    /// Bind sources as Docker sees them (staging paths for held mounts).
    pub bind_sources: Vec<String>,
}

/// Docker's container-name charset; anything else becomes `-`.
#[must_use]
pub fn object_name(slot: &SlotRef, attempt: &AttemptId) -> String {
    let clean = |s: &str| -> String {
        s.chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-') {
                    c
                } else {
                    '-'
                }
            })
            .collect()
    };
    format!(
        "od-{}-{}-{}",
        clean(slot.resource_id.as_str()),
        slot.index,
        clean(attempt.as_str())
    )
}

#[derive(Debug)]
pub struct EngineAdapter {
    docker: DockerClient,
    journal: JournalHandle,
    submission_lock: tokio::sync::Mutex<()>,
    boot_id: BootId,
    incarnation: Incarnation,
    engine_incarnation: String,
}

impl EngineAdapter {
    pub fn new(
        docker: DockerClient,
        journal: JournalHandle,
        boot_id: BootId,
        incarnation: Incarnation,
        engine_incarnation: String,
    ) -> Self {
        Self {
            docker,
            journal,
            submission_lock: tokio::sync::Mutex::new(()),
            boot_id,
            incarnation,
            engine_incarnation,
        }
    }

    #[must_use]
    pub fn docker(&self) -> &DockerClient {
        &self.docker
    }

    #[must_use]
    pub fn journal(&self) -> &JournalHandle {
        &self.journal
    }

    #[must_use]
    pub fn incarnation(&self) -> &Incarnation {
        &self.incarnation
    }

    #[must_use]
    pub fn boot_id(&self) -> &BootId {
        &self.boot_id
    }

    /// The node's lifecycle/submission lock. Revocation, retirement
    /// of unsubmitted work and the NotSubmitted→Submitted step all happen under it.
    pub async fn lock(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.submission_lock.lock().await
    }

    /// Under the submission lock: let `guard` approve the current state, then
    /// journal `Intent` and `Submitted` (fsynced), then send. Returns
    /// `Unresolved` if the outcome is not definitive; the mutation then stays
    /// `Submitted` until a terminal answer or a validated barrier retires it.
    pub async fn submit(
        &self,
        spec: MutationSpec,
        guard: impl FnOnce(&NodeState) -> Result<(), String>,
    ) -> Result<SubmitResult, AdapterError> {
        let (method, path, body) = spec.op.request();
        let body: Option<Bytes> = match (spec.op.verb(), body) {
            (EngineVerb::Create, Some(cfg)) => Some(Bytes::from(
                serde_json::to_vec(&self.enforce_create_policy(&spec, cfg.clone())?)
                    .map_err(|_| AdapterError::BadConfig)?,
            )),
            (_, Some(b)) => Some(Bytes::from(
                serde_json::to_vec(b).map_err(|_| AdapterError::BadConfig)?,
            )),
            (_, None) => None,
        };
        let payload_hash = payload_hash(&method, &path, body.as_deref());
        let mutation_id = MutationId::mint().map_err(|e| AdapterError::Mint(e.to_string()))?;
        {
            let _lock = self.submission_lock.lock().await;
            self.journal.read(guard)?.map_err(AdapterError::Refused)?;
            self.journal
                .append(Record::MutationIntent {
                    mutation: MutationRecord {
                        mutation_id: mutation_id.clone(),
                        class: spec.class,
                        slot: spec.slot.clone(),
                        grant_id: spec.grant_id.clone(),
                        attempt_id: spec.attempt_id.clone(),
                        verb: spec.op.verb(),
                        object_name: spec.op.object_name().to_owned(),
                        container: spec.op.container().cloned(),
                        payload_hash,
                    },
                })
                .await?;
            self.journal
                .append(Record::MutationSubmitted {
                    mutation_id: mutation_id.clone(),
                    boot_id: self.boot_id.clone(),
                    incarnation: self.incarnation.clone(),
                    engine_incarnation: self.engine_incarnation.clone(),
                })
                .await?;
        }
        tracing::info!(mutation = %mutation_id, verb = ?spec.op.verb(), object = spec.op.object_name(), "submitted");
        let docker = self
            .docker
            .with_timeout(self.docker.timeout() + spec.op.grace());
        let classification = match docker.send(method, &path, body).await {
            Ok(r) => classify(spec.op.verb(), &r),
            Err(e) => Classification::Ambiguous(format!("transport: {e}")),
        };
        match classification {
            Classification::Terminal(outcome) => {
                self.journal
                    .append(Record::MutationSettled {
                        mutation_id: mutation_id.clone(),
                        outcome: outcome.clone(),
                    })
                    .await?;
                tracing::info!(mutation = %mutation_id, ?outcome, "settled");
                Ok(SubmitResult::Settled {
                    mutation_id,
                    outcome,
                })
            }
            Classification::Ambiguous(reason) => {
                tracing::warn!(mutation = %mutation_id, %reason, "submission unresolved; stays Submitted");
                Ok(SubmitResult::Unresolved {
                    mutation_id,
                    reason,
                })
            }
        }
    }

    /// otterd is the only supervisor: Docker restart policy is always `no`,
    /// never auto-remove, and identity labels are added (labels aid inventory;
    /// they are never authority).
    fn enforce_create_policy(
        &self,
        spec: &MutationSpec,
        mut cfg: serde_json::Value,
    ) -> Result<serde_json::Value, AdapterError> {
        let node = self
            .journal
            .read(|s| s.identity.as_ref().map(|i| i.node_id.to_string()))?;
        let obj = cfg.as_object_mut().ok_or(AdapterError::BadConfig)?;
        let host = obj
            .entry("HostConfig")
            .or_insert_with(|| serde_json::json!({}))
            .as_object_mut()
            .ok_or(AdapterError::BadConfig)?;
        host.insert("RestartPolicy".into(), serde_json::json!({"Name": "no"}));
        host.insert("AutoRemove".into(), serde_json::Value::Bool(false));
        let labels = obj
            .entry("Labels")
            .or_insert_with(|| serde_json::json!({}))
            .as_object_mut()
            .ok_or(AdapterError::BadConfig)?;
        labels.insert(LABEL_MANAGED.into(), "1".into());
        labels.insert(LABEL_SLOT.into(), spec.slot.to_string().into());
        labels.insert(LABEL_ATTEMPT.into(), spec.attempt_id.to_string().into());
        let class = serde_json::to_value(spec.class).map_err(|_| AdapterError::BadConfig)?;
        labels.insert(LABEL_CLASS.into(), class);
        if let Some(g) = &spec.grant_id {
            labels.insert(LABEL_GRANT.into(), g.to_string().into());
        }
        if let Some(node) = node {
            labels.insert(LABEL_NODE.into(), node.into());
        }
        Ok(cfg)
    }

    /// Inspect one container. `Ok(None)` is a 404: absent *now*, which says
    /// nothing about a create that may still be queued. An error means the
    /// Engine could not answer (inspect hangs while containerd is blocked).
    pub async fn inspect(&self, name_or_id: &str) -> Result<Option<ContainerView>, TransportError> {
        let r = self
            .docker
            .get(&format!("/containers/{}/json", urlencode(name_or_id)))
            .await?;
        if r.status == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !r.status.is_success() {
            return Err(TransportError::Http(format!(
                "inspect {name_or_id}: {} {}",
                r.status,
                r.message()
            )));
        }
        let v: serde_json::Value = r.json().map_err(|e| TransportError::Http(e.to_string()))?;
        Ok(Some(view_from_inspect(&v)))
    }

    /// Every container carrying otterd's managed label (inventory, not authority).
    pub async fn list_managed(&self) -> Result<Vec<ContainerView>, TransportError> {
        let filters = format!(r#"{{"label":["{LABEL_MANAGED}=1"]}}"#);
        let r = self
            .docker
            .get(&format!(
                "/containers/json?all=1&filters={}",
                urlencode(&filters)
            ))
            .await?;
        if !r.status.is_success() {
            return Err(TransportError::Http(format!(
                "list: {} {}",
                r.status,
                r.message()
            )));
        }
        let rows: Vec<serde_json::Value> =
            r.json().map_err(|e| TransportError::Http(e.to_string()))?;
        let mut out = Vec::with_capacity(rows.len());
        for id in rows
            .iter()
            .filter_map(|row| row.get("Id").and_then(|v| v.as_str()))
        {
            if let Some(view) = self.inspect(id).await? {
                out.push(view);
            }
        }
        Ok(out)
    }
}

/// Decode the parts of `GET /containers/{id}/json` otterd relies on.
#[must_use]
pub fn view_from_inspect(v: &serde_json::Value) -> ContainerView {
    let s = |p: &str| {
        v.pointer(p)
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    let status = s("/State/Status");
    let pid = v
        .pointer("/State/Pid")
        .and_then(serde_json::Value::as_u64)
        .and_then(|p| u32::try_from(p).ok());
    let process = match (status.as_str(), pid) {
        ("running" | "paused" | "restarting", Some(pid)) => ProcessObservation::Running { pid },
        ("created", _) => ProcessObservation::Created,
        ("exited" | "dead", _) => ProcessObservation::Exited {
            exit_code: v
                .pointer("/State/ExitCode")
                .and_then(serde_json::Value::as_i64)
                .unwrap_or(-1),
        },
        (other, _) => ProcessObservation::Unknown {
            reason: format!("state {other:?}"),
        },
    };
    let labels = v
        .pointer("/Config/Labels")
        .and_then(serde_json::Value::as_object)
        .map(|m| {
            m.iter()
                .map(|(k, v)| (k.clone(), v.as_str().unwrap_or_default().to_owned()))
                .collect()
        })
        .unwrap_or_default();
    let bind_sources = v
        .pointer("/Mounts")
        .and_then(serde_json::Value::as_array)
        .map(|mounts| {
            mounts
                .iter()
                .filter(|m| m.get("Type").and_then(serde_json::Value::as_str) == Some("bind"))
                .filter_map(|m| m.get("Source").and_then(serde_json::Value::as_str))
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    ContainerView {
        id: s("/Id"),
        name: s("/Name").trim_start_matches('/').to_owned(),
        process,
        restart_policy: s("/HostConfig/RestartPolicy/Name"),
        labels,
        started_at: s("/State/StartedAt"),
        finished_at: s("/State/FinishedAt"),
        bind_sources,
    }
}

/// SHA-256 over `METHOD path\n` and the exact body bytes sent.
#[must_use]
pub fn payload_hash(method: &Method, path: &str, body: Option<&[u8]>) -> Sha256Hex {
    let mut h = Sha256::new();
    h.update(method.as_str().as_bytes());
    h.update(b" ");
    h.update(path.as_bytes());
    h.update(b"\n");
    if let Some(b) = body {
        h.update(b);
    }
    Sha256Hex::new(hex::encode(h.finalize())).unwrap_or_else(|_| Sha256Hex::digest(b""))
}

/// `<docker version>/pid:<dockerd pid>`: evidence of which Engine process got
/// the request (never authority).
#[must_use]
pub fn engine_incarnation(version: &str, pid_file: &std::path::Path) -> String {
    let pid =
        std::fs::read_to_string(pid_file).map_or_else(|_| "?".into(), |p| p.trim().to_owned());
    format!("{version}/pid:{pid}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resp(code: u16, body: &str) -> EngineResponse {
        EngineResponse {
            status: StatusCode::from_u16(code).unwrap(),
            body: Bytes::from(body.to_owned()),
        }
    }

    #[test]
    fn only_known_synchronous_answers_settle() {
        let c = |v, code, body| classify(v, &resp(code, body));
        assert!(matches!(
            c(EngineVerb::Create, 201, r#"{"Id":"abc","Warnings":[]}"#),
            Classification::Terminal(EngineOutcome::Created { .. })
        ));
        assert_eq!(
            c(EngineVerb::Start, 204, ""),
            Classification::Terminal(EngineOutcome::Started)
        );
        assert_eq!(
            c(EngineVerb::Start, 304, ""),
            Classification::Terminal(EngineOutcome::AlreadyStarted)
        );
        assert_eq!(
            c(EngineVerb::Restart, 204, ""),
            Classification::Terminal(EngineOutcome::Restarted)
        );
        assert_eq!(
            c(EngineVerb::Stop, 404, ""),
            Classification::Terminal(EngineOutcome::Absent)
        );
        assert_eq!(
            c(EngineVerb::Kill, 409, ""),
            Classification::Terminal(EngineOutcome::AlreadyStopped)
        );
        assert_eq!(
            c(EngineVerb::Remove, 204, ""),
            Classification::Terminal(EngineOutcome::Removed)
        );
        for (verb, code) in [
            (EngineVerb::Start, 500),
            (EngineVerb::Create, 503),
            (EngineVerb::Stop, 500),
            (EngineVerb::Restart, 500),
            (EngineVerb::Remove, 500),
        ] {
            assert!(matches!(
                c(verb, code, r#"{"message":"context deadline exceeded"}"#),
                Classification::Ambiguous(_)
            ));
        }
        assert!(matches!(
            c(EngineVerb::Create, 201, "not json"),
            Classification::Ambiguous(_)
        ));
        assert!(matches!(
            c(
                EngineVerb::Create,
                409,
                r#"{"message":"Conflict. The container name is already in use"}"#
            ),
            Classification::Terminal(EngineOutcome::Refused { status: 409, .. })
        ));
    }

    #[test]
    fn inspect_maps_states_and_binds() {
        let v = serde_json::json!({
            "Id": "x", "Name": "/od-a",
            "State": {"Status": "running", "Pid": 7},
            "HostConfig": {"RestartPolicy": {"Name": "no"}},
            "Config": {"Labels": {"a": "b"}},
            "Mounts": [{"Type": "bind", "Source": "/run/otterd/stage/h1"}, {"Type": "volume", "Source": "/v"}]
        });
        let view = view_from_inspect(&v);
        assert_eq!(view.process, ProcessObservation::Running { pid: 7 });
        assert_eq!(view.name, "od-a");
        assert_eq!(view.restart_policy, "no");
        assert_eq!(view.bind_sources, vec!["/run/otterd/stage/h1".to_owned()]);
        let gone = serde_json::json!({"State": {"Status": "running"}});
        assert!(matches!(
            view_from_inspect(&gone).process,
            ProcessObservation::Unknown { .. }
        ));
    }

    #[test]
    fn object_names_are_docker_safe_and_hash_binds_bytes() {
        let slot = SlotRef::new("res:pg/main".parse().unwrap(), 2);
        let attempt: AttemptId = "att_abc".parse().unwrap();
        assert_eq!(object_name(&slot, &attempt), "od-res-pg-main-2-att_abc");
        let a = payload_hash(&Method::POST, "/x", Some(b"{\"a\":1}"));
        let b = payload_hash(&Method::POST, "/x", Some(b"{\"a\": 1}"));
        assert_ne!(a, b);
    }
}
