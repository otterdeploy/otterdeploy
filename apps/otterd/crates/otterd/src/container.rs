//! Translate a [`ServiceSpec`]'s task into a Docker create body.
//!
//! The node runs only what the spec pins: an image digest when one is set,
//! literal environment values (secret references are refused until the node's
//! secret store exists, rather than silently dropped), Docker limits, and bind
//! sources that are already staged. Docker's restart policy and labels are
//! added later by the Engine adapter.

use otterd_proto::spec::{
    EnvValue, ImageHealthcheck, ImageSpec, MountKind, PortProtocol, PublishMode, ServiceSpec,
};
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;

/// Why a spec cannot run on this node yet.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TranslateError {
    #[error("environment variable {0} references a secret; the node secret store is not available")]
    SecretUnsupported(String),
    #[error("mount {0} names a data identity but was not staged")]
    Unstaged(String),
    #[error("mount {0} has no source")]
    NoSource(String),
    #[error("image reference {0:?} is not a valid reference")]
    InvalidImage(String),
}

/// The image one attempt runs, and how to pull it when it is absent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageTarget {
    /// What the create body names: `repo@digest` when pinned, else the
    /// reference as given.
    pub run: String,
    /// `fromImage` of a pull.
    pub repository: String,
    /// `tag` of a pull: the tag, `latest` when there is none, or the digest.
    pub tag: String,
    /// The pinned content digest the pulled image must match.
    pub digest: Option<String>,
}

/// Resolve an image spec. A digest (the spec's, or one in the reference)
/// pins the content and the tag is informational; an untagged reference
/// means `latest`, never every tag.
pub fn image_target(image: &ImageSpec) -> Result<ImageTarget, TranslateError> {
    let invalid = || TranslateError::InvalidImage(image.reference.clone());
    let reference = image.reference.trim();
    let (named, inline_digest) = match reference.split_once('@') {
        Some((n, d)) => (n, Some(d)),
        None => (reference, None),
    };
    let repository = strip_tag(named);
    let tag_of = || {
        named
            .get(repository.len()..)
            .and_then(|t| t.strip_prefix(':'))
            .filter(|t| !t.is_empty())
            .unwrap_or("latest")
            .to_owned()
    };
    let digest = image.digest.as_deref().or(inline_digest).map(str::to_owned);
    let target = match &digest {
        Some(d) => ImageTarget {
            run: format!("{repository}@{d}"),
            repository: repository.to_owned(),
            tag: d.clone(),
            digest: digest.clone(),
        },
        None => ImageTarget {
            run: reference.to_owned(),
            repository: repository.to_owned(),
            tag: tag_of(),
            digest: None,
        },
    };
    let charset = |s: &str| {
        !s.is_empty()
            && !s.starts_with(['/', '.', '-', ':'])
            && !s.contains("..")
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b'/' | b':'))
    };
    let digest_ok = target.digest.as_deref().is_none_or(|d| {
        d.strip_prefix("sha256:")
            .is_some_and(|h| h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()))
    });
    if charset(&target.repository) && charset(&target.tag) && digest_ok {
        Ok(target)
    } else {
        Err(invalid())
    }
}

/// One bind as Docker will see it: the staging path for held data, else the
/// source unchanged (volumes are referenced by name).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedMount {
    pub target: String,
    pub source: String,
}

/// Build the create body. `staged` maps mount targets to staging paths.
pub fn create_body(
    spec: &ServiceSpec,
    staged: &BTreeMap<String, String>,
) -> Result<Value, TranslateError> {
    let task = &spec.task;
    let c = &task.container;
    let image = image_target(&c.image)?.run;
    let mut body = Map::new();
    body.insert("Image".into(), json!(image));
    if let Some(cmd) = &c.command {
        body.insert("Entrypoint".into(), json!(cmd));
    }
    if let Some(args) = &c.args {
        body.insert("Cmd".into(), json!(args));
    }
    let mut env = Vec::new();
    for v in &c.env {
        match &v.value {
            EnvValue::Literal { value } => env.push(format!("{}={value}", v.name)),
            EnvValue::Secret { .. } => {
                return Err(TranslateError::SecretUnsupported(v.name.clone()));
            }
        }
    }
    body.insert("Env".into(), json!(env));
    if let Some(u) = &c.user {
        body.insert("User".into(), json!(u));
    }
    if let Some(w) = &c.workdir {
        body.insert("WorkingDir".into(), json!(w));
    }
    if let Some(h) = &c.hostname {
        body.insert("Hostname".into(), json!(h));
    }
    body.insert("Labels".into(), json!(c.labels));
    body.insert("Tty".into(), json!(c.tty));
    if let Some(sig) = &c.stop_signal {
        body.insert("StopSignal".into(), json!(sig));
    }
    let stop_timeout_s = c.stop_grace_ms.get().div_ceil(1000);
    body.insert("StopTimeout".into(), json!(stop_timeout_s));
    if c.image_healthcheck == ImageHealthcheck::Disable {
        body.insert("Healthcheck".into(), json!({"Test": ["NONE"]}));
    }

    let mut host = Map::new();
    host.insert("Init".into(), json!(c.init));
    host.insert("ReadonlyRootfs".into(), json!(c.read_only_rootfs));
    if !c.cap_add.is_empty() {
        host.insert("CapAdd".into(), json!(c.cap_add));
    }
    if !c.cap_drop.is_empty() {
        host.insert("CapDrop".into(), json!(c.cap_drop));
    }
    if !c.sysctls.is_empty() {
        host.insert("Sysctls".into(), json!(c.sysctls));
    }
    let limits = &task.resources.limits;
    if let Some(n) = limits.nano_cpus {
        host.insert("NanoCpus".into(), json!(n));
    }
    if let Some(m) = limits.memory_bytes {
        host.insert("Memory".into(), json!(m));
    }
    if let Some(p) = limits.pids {
        host.insert("PidsLimit".into(), json!(p));
    }
    host.insert("Mounts".into(), json!(mounts(spec, staged)?));
    let (exposed, bindings) = ports(spec);
    body.insert("ExposedPorts".into(), Value::Object(exposed));
    host.insert("PortBindings".into(), Value::Object(bindings));
    body.insert("HostConfig".into(), Value::Object(host));
    Ok(Value::Object(body))
}

fn mounts(
    spec: &ServiceSpec,
    staged: &BTreeMap<String, String>,
) -> Result<Vec<Value>, TranslateError> {
    let mut mounts = Vec::new();
    for m in &spec.task.mounts {
        let target = m.target.clone();
        match m.kind {
            MountKind::Bind => {
                let source = if m.data_identity.is_some() {
                    staged
                        .get(&target)
                        .cloned()
                        .ok_or_else(|| TranslateError::Unstaged(target.clone()))?
                } else {
                    m.source
                        .clone()
                        .ok_or_else(|| TranslateError::NoSource(target.clone()))?
                };
                mounts.push(json!({"Type": "bind", "Source": source, "Target": target,
                    "ReadOnly": m.read_only, "BindOptions": {"Propagation": "rprivate"}}));
            }
            MountKind::Volume => {
                let source = m
                    .source
                    .clone()
                    .ok_or_else(|| TranslateError::NoSource(target.clone()))?;
                mounts.push(json!({"Type": "volume", "Source": source, "Target": target,
                    "ReadOnly": m.read_only}));
            }
            MountKind::Tmpfs => {
                let mut t = Map::new();
                t.insert("Type".into(), json!("tmpfs"));
                t.insert("Target".into(), json!(target));
                if let Some(size) = m.tmpfs_size_bytes {
                    t.insert("TmpfsOptions".into(), json!({"SizeBytes": size}));
                }
                mounts.push(Value::Object(t));
            }
        }
    }
    Ok(mounts)
}

/// `ExposedPorts` and host `PortBindings`; ingress-mode ports are exposed only.
fn ports(spec: &ServiceSpec) -> (Map<String, Value>, Map<String, Value>) {
    let mut exposed = Map::new();
    let mut bindings = Map::new();
    for p in &spec.endpoint.ports {
        let proto = match p.protocol {
            PortProtocol::Tcp => "tcp",
            PortProtocol::Udp => "udp",
        };
        let key = format!("{}/{proto}", p.target_port);
        exposed.insert(key.clone(), json!({}));
        if p.publish == PublishMode::Host
            && let Some(published) = p.published_port
        {
            bindings.insert(key, json!([{"HostPort": published.to_string()}]));
        }
    }
    (exposed, bindings)
}

/// `repo:tag` → `repo` (a digest pins the content; the tag is informational).
fn strip_tag(reference: &str) -> &str {
    let after_slash = reference.rfind('/').map_or(0, |i| i + 1);
    match reference.get(after_slash..).and_then(|tail| tail.find(':')) {
        Some(i) => reference.get(..after_slash + i).unwrap_or(reference),
        None => reference,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use otterd_proto::spec::ServiceSpecInput;

    fn spec(v: serde_json::Value) -> ServiceSpec {
        serde_json::from_value::<ServiceSpecInput>(v)
            .unwrap()
            .normalize()
    }

    #[test]
    fn pins_the_digest_and_maps_limits_mounts_and_ports() {
        let s = spec(json!({
            "resourceId": "res_pg",
            "task": {
                "container": {"image": {"reference": "registry:5000/library/postgres:17",
                    "digest": format!("sha256:{}", "a".repeat(64))},
                    "env": [{"name": "A", "value": {"kind": "literal", "value": "1"}}],
                    "imageHealthcheck": "disable", "stopGraceMs": 30000},
                "mounts": [
                    {"kind": "bind", "source": "/srv/pg", "target": "/data", "dataIdentity": "vol:1"},
                    {"kind": "volume", "source": "cache", "target": "/cache", "readOnly": true},
                    {"kind": "tmpfs", "target": "/tmp", "tmpfsSizeBytes": 1024}
                ],
                "resources": {"limits": {"memoryBytes": 1_073_741_824_u64, "pids": 512}}
            },
            "endpoint": {"ports": [{"targetPort": 5432, "publishedPort": 15432, "publish": "host"}]}
        }));
        let staged = BTreeMap::from([("/data".to_owned(), "/run/otterd/stage/hold_1".to_owned())]);
        let b = create_body(&s, &staged).unwrap();
        assert_eq!(
            b["Image"],
            format!("registry:5000/library/postgres@sha256:{}", "a".repeat(64))
        );
        assert_eq!(b["Env"], json!(["A=1"]));
        assert_eq!(b["Healthcheck"]["Test"], json!(["NONE"]));
        assert_eq!(b["StopTimeout"], 30);
        assert_eq!(b["HostConfig"]["Memory"], 1_073_741_824_u64);
        assert_eq!(
            b["HostConfig"]["Mounts"][0]["Source"], "/run/otterd/stage/hold_1",
            "Docker never sees the tenant path"
        );
        assert_eq!(b["HostConfig"]["Mounts"][1]["Type"], "volume");
        assert_eq!(
            b["HostConfig"]["PortBindings"]["5432/tcp"][0]["HostPort"],
            "15432"
        );
        // A held bind that was not staged is refused, never passed through.
        assert_eq!(
            create_body(&s, &BTreeMap::new()),
            Err(TranslateError::Unstaged("/data".into()))
        );
    }

    #[test]
    fn refuses_secret_env_until_the_store_exists() {
        let s = spec(
            json!({"resourceId": "r", "task": {"container": {"image": {"reference": "x"},
            "env": [{"name": "PW", "value": {"kind": "secret", "secretRef": "s1"}}]}}}),
        );
        assert_eq!(
            create_body(&s, &BTreeMap::new()),
            Err(TranslateError::SecretUnsupported("PW".into()))
        );
    }

    #[test]
    fn image_targets_pull_one_tag_or_the_pinned_digest() {
        let d = format!("sha256:{}", "a".repeat(64));
        let t = |reference: &str, digest: Option<&str>| {
            image_target(&ImageSpec {
                reference: reference.into(),
                digest: digest.map(str::to_owned),
            })
        };
        let tagged = t("registry:5000/acme/web:1", None).unwrap();
        assert_eq!(
            (
                tagged.run.as_str(),
                tagged.repository.as_str(),
                tagged.tag.as_str()
            ),
            ("registry:5000/acme/web:1", "registry:5000/acme/web", "1")
        );
        assert_eq!(tagged.digest, None);
        // Untagged means latest, never every tag of the repository.
        assert_eq!(t("busybox", None).unwrap().tag, "latest");
        assert_eq!(t("registry:5000/acme/web", None).unwrap().tag, "latest");
        // A digest pins the content; the tag is informational.
        let pinned = t("busybox:1.37", Some(&d)).unwrap();
        assert_eq!(pinned.run, format!("busybox@{d}"));
        assert_eq!(
            (pinned.repository.as_str(), pinned.tag.as_str()),
            ("busybox", d.as_str())
        );
        assert_eq!(pinned.digest.as_deref(), Some(d.as_str()));
        let inline = t(&format!("busybox@{d}"), None).unwrap();
        assert_eq!(inline, pinned);
        for bad in ["", "a b", "../x", "x?y", ":1"] {
            assert!(t(bad, None).is_err(), "{bad}");
        }
        assert!(t("busybox", Some("sha256:XYZ")).is_err());
    }

    #[test]
    fn strips_tags_not_registry_ports() {
        assert_eq!(strip_tag("postgres:17"), "postgres");
        assert_eq!(
            strip_tag("registry:5000/acme/web:1"),
            "registry:5000/acme/web"
        );
        assert_eq!(
            strip_tag("registry:5000/acme/web"),
            "registry:5000/acme/web"
        );
    }
}
