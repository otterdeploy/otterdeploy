//! The platform boot manifest (`otterd/platform-boot-manifest/v1`).
//!
//! On a host that runs the control plane itself (N=1 and recovery), otterd
//! starts the platform (Postgres, Redis, the control plane and its edge) from
//! this document, without the control plane and without a registry. It is
//! signed by the install's offline recovery key, which is the install-admin
//! key for this purpose; class membership comes only from it, so labels,
//! tenant specs and control-plane APIs cannot make a workload a platform
//! member.
//!
//! [`PlatformBootManifest::preflight`] closes the dependency graph before
//! anything starts: no cycles or unknown dependencies, exactly one control
//! plane whose closure includes Postgres and Redis, exact local image ids, data
//! roots under [`PLATFORM_DATA_ROOT`] that never overlap, and connectors only
//! when explicitly signed as essential.

use crate::identity::HostBinding;
use crate::ids::{InstallId, Sha256Hex, UpdateId};
use crate::journal::UpdatePhase;
use crate::num::U53;
use crate::spec::is_image_digest;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::path::{Component, Path};

/// The manifest schema this build reads.
pub const PLATFORM_MANIFEST_SCHEMA: u16 = 1;
/// Every platform data root lives under this directory.
pub const PLATFORM_DATA_ROOT: &str = "/var/lib/otterd/platform";

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PlatformRole {
    Postgres,
    Redis,
    ControlPlane,
    Edge,
    /// A tunnel or proxy the control plane needs; only when signed as essential.
    Connector,
}

impl PlatformRole {
    pub const ALL: [Self; 5] = [
        Self::Postgres,
        Self::Redis,
        Self::ControlPlane,
        Self::Edge,
        Self::Connector,
    ];
}

/// A local image: boot never needs a registry.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlatformImage {
    /// Human reference, informational.
    pub reference: String,
    /// Exact local image id, `sha256:<64 hex>`: the only thing the member runs.
    pub id: String,
    /// `docker save` archive on the host, loaded when the id is missing.
    pub archive: String,
    pub archive_sha256: Sha256Hex,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlatformDataMount {
    pub root: String,
    pub target: String,
    #[serde(default)]
    pub read_only: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlatformPublish {
    pub host_ip: String,
    pub host_port: u16,
    pub container_port: u16,
}

/// How the supervisor decides a member is up before starting its dependents.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum PlatformReadiness {
    Tcp { port: u16 },
    Exec { argv: Vec<String> },
    Http { port: u16, path: String },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlatformMember {
    pub name: String,
    pub role: PlatformRole,
    pub image: PlatformImage,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cmd: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,
    /// Extra environment applied only while the control plane runs in recovery mode.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub recovery_env: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub data: Vec<PlatformDataMount>,
    /// Fixed address on the platform network.
    pub ip: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub publish: Vec<PlatformPublish>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub depends_on: Vec<String>,
    pub readiness: PlatformReadiness,
    /// Required for a `connector`: signed as essential to the control plane.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub essential_connector: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlatformNetwork {
    pub name: String,
    pub subnet: String,
    pub gateway: String,
}

/// Host checks before anything starts.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlatformPreflight {
    /// nftables table that must be loaded first (`family name`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub require_nft_table: Option<String>,
    /// systemd units that must not be enabled or active (legacy supervisors).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub forbid_units: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlatformBootManifest {
    pub schema: u16,
    pub install_id: InstallId,
    /// The one machine this manifest boots: a cloned disk elsewhere refuses.
    pub host: HostBinding,
    pub bootstrap_epoch: U53,
    /// Increases with every signed revision.
    pub manifest_revision: U53,
    pub authority_term: U53,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_manifest_digest: Option<Sha256Hex>,
    /// Digests of earlier manifests this one may be rolled back to.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub compatible_rollback: Vec<Sha256Hex>,
    pub network: PlatformNetwork,
    pub members: Vec<PlatformMember>,
    /// The control plane's recovery listener (loopback or management address),
    /// never a tenant route.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovery_listener: Option<String>,
    #[serde(default)]
    pub preflight: PlatformPreflight,
}

/// The platform's state as the node reports it (slot reports and the local
/// status socket), so a control plane that restarted in recovery mode can
/// read where a boot or an update stands.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformReport {
    /// `preflight`, `starting <member>`, `up` or `blocked`.
    pub phase: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blocked: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manifest_digest: Option<Sha256Hex>,
    /// Member name → state (`ready`, `ready (continued)`, …).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub members: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub update: Option<PlatformUpdateReport>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformUpdateReport {
    pub update_id: UpdateId,
    pub phase: UpdatePhase,
    /// Crossed the schema boundary: only forward from here.
    pub irreversible: bool,
    pub from_manifest_digest: Sha256Hex,
    pub to_manifest_digest: Sha256Hex,
}

/// Why a manifest cannot boot.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum ManifestError {
    #[error("unsupported manifest schema {0}")]
    Schema(u16),
    #[error("duplicate member {0}")]
    Duplicate(String),
    #[error("member {member} depends on unknown member {dep}")]
    UnknownDependency { member: String, dep: String },
    #[error("dependency cycle among: {0}")]
    Cycle(String),
    #[error("member {0}: a connector must be signed as essential to the control plane")]
    UnsignedConnector(String),
    #[error("exactly one control-plane member is required, found {0}")]
    ControlPlaneCount(usize),
    #[error("the control plane must depend, directly or not, on a {0:?} member")]
    ControlPlaneClosure(PlatformRole),
    #[error(
        "member {member}: data root {root} must be a normalized absolute path under {PLATFORM_DATA_ROOT}"
    )]
    DataRootOutside { member: String, root: String },
    #[error("data roots {a} and {b} overlap: one owner per platform data root")]
    DataRootOverlap { a: String, b: String },
    #[error("member {member}: image id must be sha256:<64 hex>, got {id}")]
    ImageId { member: String, id: String },
    #[error("this manifest is for another host: {0}")]
    Host(&'static str),
}

impl PlatformBootManifest {
    /// Validate the boot closure and return the members in start order.
    pub fn preflight(&self) -> Result<Vec<&PlatformMember>, ManifestError> {
        if self.schema != PLATFORM_MANIFEST_SCHEMA {
            return Err(ManifestError::Schema(self.schema));
        }
        let mut by_name = BTreeMap::new();
        for m in &self.members {
            if by_name.insert(m.name.as_str(), m).is_some() {
                return Err(ManifestError::Duplicate(m.name.clone()));
            }
        }
        for m in &self.members {
            if let Some(dep) = m
                .depends_on
                .iter()
                .find(|d| !by_name.contains_key(d.as_str()))
            {
                return Err(ManifestError::UnknownDependency {
                    member: m.name.clone(),
                    dep: dep.clone(),
                });
            }
            if m.role == PlatformRole::Connector && !m.essential_connector {
                return Err(ManifestError::UnsignedConnector(m.name.clone()));
            }
            if !is_image_digest(&m.image.id) {
                return Err(ManifestError::ImageId {
                    member: m.name.clone(),
                    id: m.image.id.clone(),
                });
            }
        }
        let order = start_order(&self.members)?;
        let cps: Vec<&PlatformMember> = self
            .members
            .iter()
            .filter(|m| m.role == PlatformRole::ControlPlane)
            .collect();
        let [cp] = cps.as_slice() else {
            return Err(ManifestError::ControlPlaneCount(cps.len()));
        };
        let closure = closure(cp, &by_name);
        for required in [PlatformRole::Postgres, PlatformRole::Redis] {
            if !closure.iter().any(|m| m.role == required) {
                return Err(ManifestError::ControlPlaneClosure(required));
            }
        }
        self.check_data_roots()?;
        Ok(order)
    }

    fn check_data_roots(&self) -> Result<(), ManifestError> {
        let mut roots: Vec<&str> = Vec::new();
        for m in &self.members {
            for d in &m.data {
                let p = Path::new(&d.root);
                let normalized = p.is_absolute()
                    && p.components()
                        .all(|c| matches!(c, Component::RootDir | Component::Normal(_)));
                if !normalized
                    || !p.starts_with(PLATFORM_DATA_ROOT)
                    || p == Path::new(PLATFORM_DATA_ROOT)
                {
                    return Err(ManifestError::DataRootOutside {
                        member: m.name.clone(),
                        root: d.root.clone(),
                    });
                }
                roots.push(&d.root);
            }
        }
        for (i, a) in roots.iter().enumerate() {
            for b in roots.iter().skip(i + 1) {
                if Path::new(a).starts_with(b) || Path::new(b).starts_with(a) {
                    return Err(ManifestError::DataRootOverlap {
                        a: (*a).to_owned(),
                        b: (*b).to_owned(),
                    });
                }
            }
        }
        Ok(())
    }

    /// The manifest boots only the machine it names.
    pub fn check_host(&self, probed: &HostBinding) -> Result<(), ManifestError> {
        if self.host.machine_id != probed.machine_id {
            return Err(ManifestError::Host("machine id differs"));
        }
        if self.host.product_uuid.is_some() && self.host.product_uuid != probed.product_uuid {
            return Err(ManifestError::Host("DMI product uuid differs"));
        }
        if let Some(want) = &self.host.provider
            && probed
                .provider
                .as_ref()
                .is_none_or(|p| p.server_id != want.server_id)
        {
            return Err(ManifestError::Host("provider server id differs"));
        }
        Ok(())
    }
}

/// Kahn's algorithm, ties broken by declaration order.
fn start_order(members: &[PlatformMember]) -> Result<Vec<&PlatformMember>, ManifestError> {
    let index: BTreeMap<&str, usize> = members
        .iter()
        .enumerate()
        .map(|(i, m)| (m.name.as_str(), i))
        .collect();
    let mut indegree: Vec<usize> = members.iter().map(|m| m.depends_on.len()).collect();
    let mut dependents: Vec<Vec<usize>> = vec![Vec::new(); members.len()];
    for (i, m) in members.iter().enumerate() {
        for d in &m.depends_on {
            if let Some(&j) = index.get(d.as_str())
                && let Some(list) = dependents.get_mut(j)
            {
                list.push(i);
            }
        }
    }
    let mut ready: VecDeque<usize> = (0..members.len())
        .filter(|&i| indegree.get(i) == Some(&0))
        .collect();
    let mut out = Vec::with_capacity(members.len());
    while let Some(i) = ready.pop_front() {
        if let Some(m) = members.get(i) {
            out.push(m);
        }
        for &k in dependents.get(i).map_or(&[][..], Vec::as_slice) {
            if let Some(d) = indegree.get_mut(k) {
                *d = d.saturating_sub(1);
                if *d == 0 {
                    ready.push_back(k);
                }
            }
        }
    }
    if out.len() == members.len() {
        Ok(out)
    } else {
        let stuck: BTreeSet<&str> = members
            .iter()
            .enumerate()
            .filter(|(i, _)| indegree.get(*i).is_some_and(|d| *d > 0))
            .map(|(_, m)| m.name.as_str())
            .collect();
        Err(ManifestError::Cycle(
            stuck.into_iter().collect::<Vec<_>>().join(", "),
        ))
    }
}

/// Everything `root` depends on, transitively.
fn closure<'a>(
    root: &PlatformMember,
    by_name: &BTreeMap<&str, &'a PlatformMember>,
) -> Vec<&'a PlatformMember> {
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    let mut queue: VecDeque<&str> = root.depends_on.iter().map(String::as_str).collect();
    while let Some(n) = queue.pop_front() {
        if !seen.insert(n) {
            continue;
        }
        if let Some(m) = by_name.get(n) {
            out.push(*m);
            queue.extend(m.depends_on.iter().map(String::as_str));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(crate) fn sample() -> PlatformBootManifest {
        serde_json::from_value(serde_json::json!({
            "schema": 1,
            "installId": "inst_1",
            "host": {"machineId": "m-1", "provider": {"provider": "hetzner", "serverId": "4711"}},
            "bootstrapEpoch": 1, "manifestRevision": 3, "authorityTerm": 2,
            "network": {"name": "otterd-platform", "subnet": "10.250.0.0/24", "gateway": "10.250.0.1"},
            "members": [
                {"name": "cp", "role": "control-plane", "ip": "10.250.0.4",
                 "image": {"reference": "otterdeploy/server:1", "id": format!("sha256:{}", "c".repeat(64)),
                    "archive": "/var/lib/otterd/platform-images/server.tar", "archiveSha256": "d".repeat(64)},
                 "dependsOn": ["pg", "redis"], "readiness": {"kind": "http", "port": 3000, "path": "/health"},
                 "recoveryEnv": {"OTTERDEPLOY_RECOVERY": "1"}},
                {"name": "pg", "role": "postgres", "ip": "10.250.0.2",
                 "image": {"reference": "postgres:17", "id": format!("sha256:{}", "a".repeat(64)),
                    "archive": "/var/lib/otterd/platform-images/pg.tar", "archiveSha256": "e".repeat(64)},
                 "data": [{"root": "/var/lib/otterd/platform/pg", "target": "/var/lib/postgresql/data"}],
                 "readiness": {"kind": "exec", "argv": ["pg_isready"]}},
                {"name": "redis", "role": "redis", "ip": "10.250.0.3",
                 "image": {"reference": "redis:7", "id": format!("sha256:{}", "b".repeat(64)),
                    "archive": "/var/lib/otterd/platform-images/redis.tar", "archiveSha256": "f".repeat(64)},
                 "readiness": {"kind": "tcp", "port": 6379}}
            ]
        }))
        .unwrap()
    }

    #[test]
    fn orders_dependencies_first() {
        let m = sample();
        let order: Vec<&str> = m
            .preflight()
            .unwrap()
            .iter()
            .map(|m| m.name.as_str())
            .collect();
        assert_eq!(order, vec!["pg", "redis", "cp"]);
    }

    #[test]
    fn refuses_what_could_not_boot_safely() {
        let check = |f: fn(&mut PlatformBootManifest)| {
            let mut m = sample();
            f(&mut m);
            m.preflight().map(|_| ()).unwrap_err()
        };
        assert!(matches!(
            check(|m| m.members[1].depends_on = vec!["cp".into()]),
            ManifestError::Cycle(_)
        ));
        assert!(matches!(
            check(|m| m.members[0].depends_on.push("ghost".into())),
            ManifestError::UnknownDependency { .. }
        ));
        assert!(matches!(
            check(|m| m.members[0].depends_on = vec!["pg".into()]),
            ManifestError::ControlPlaneClosure(PlatformRole::Redis)
        ));
        assert!(matches!(
            check(|m| m.members[2].role = PlatformRole::ControlPlane),
            ManifestError::ControlPlaneCount(2)
        ));
        assert!(matches!(
            check(|m| m.members[2].role = PlatformRole::Connector),
            ManifestError::UnsignedConnector(_)
        ));
        assert!(matches!(
            check(|m| m.members[1].image.id = "postgres:17".into()),
            ManifestError::ImageId { .. }
        ));
        assert!(matches!(
            check(|m| m.members[1].data[0].root = "/srv/pg".into()),
            ManifestError::DataRootOutside { .. }
        ));
        assert!(matches!(
            check(|m| m.members[1].data[0].root = "/var/lib/otterd/platform/../x".into()),
            ManifestError::DataRootOutside { .. }
        ));
        assert!(matches!(
            check(|m| m.members[2].data = vec![PlatformDataMount {
                root: "/var/lib/otterd/platform/pg/sub".into(),
                target: "/x".into(),
                read_only: false
            }]),
            ManifestError::DataRootOverlap { .. }
        ));
        assert!(matches!(check(|m| m.schema = 2), ManifestError::Schema(2)));
        let mut ok = sample();
        ok.members[2].role = PlatformRole::Connector;
        ok.members[2].essential_connector = true;
        ok.members.push(PlatformMember {
            role: PlatformRole::Redis,
            name: "redis2".into(),
            ..ok.members[2].clone()
        });
        ok.members[0].depends_on.push("redis2".into());
        assert!(ok.preflight().is_ok());
    }

    #[test]
    fn boots_only_the_named_host() {
        let m = sample();
        let mut host = m.host.clone();
        assert!(m.check_host(&host).is_ok());
        host.machine_id = "m-2".into();
        assert_eq!(
            m.check_host(&host),
            Err(ManifestError::Host("machine id differs"))
        );
        let mut moved = m.host.clone();
        moved.provider = None;
        assert!(
            m.check_host(&moved).is_err(),
            "a provider binding must be matched"
        );
    }
}
