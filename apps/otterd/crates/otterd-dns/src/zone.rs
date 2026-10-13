//! The persisted zone otterd writes and the lookup rules over it.

use std::collections::BTreeMap;
use std::net::Ipv4Addr;

use serde::{Deserialize, Serialize};

/// Answer TTL for every positive answer.
pub const ANSWER_TTL: u32 = 5;
/// Negative TTL (SOA minimum) for NXDOMAIN and NODATA.
pub const NEGATIVE_TTL: u32 = 5;

/// One name's records.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Record {
    /// A stable service address.
    Vip {
        /// The VIP.
        addr: Ipv4Addr,
    },
    /// Round-robin backend addresses with their freshness expiry (unix milliseconds).
    Rr {
        /// Backends.
        backends: Vec<RrBackend>,
    },
}

/// A dnsrr backend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RrBackend {
    /// Address.
    pub addr: Ipv4Addr,
    /// The owner freshness bound; past it the record is not served.
    pub expires_unix_ms: u64,
}

/// One environment's view.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    /// Managed zone suffixes, lowercase, dot-terminated (e.g. `prod.otd.internal.`).
    pub zones: Vec<String>,
    /// Records by lowercase, dot-terminated name.
    pub names: BTreeMap<String, Record>,
}

/// The whole persisted file: views keyed by listener address.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Zone {
    /// Monotonic serial (SOA).
    pub serial: u32,
    /// Suffixes that belong to otterd as a whole (e.g. `otd.internal.`): a name under one of them
    /// that is not in the asking view's zones is another environment's and gets NXDOMAIN, never
    /// a forward upstream.
    #[serde(default)]
    pub managed: Vec<String>,
    /// Views by the listener address queries arrive on.
    pub views: BTreeMap<Ipv4Addr, View>,
}

/// Query types the responder distinguishes.
pub const TYPE_A: u16 = 1;

/// The decision for one question.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Answer {
    /// Addresses with a TTL.
    Addrs {
        /// Records.
        addrs: Vec<Ipv4Addr>,
        /// TTL.
        ttl: u32,
    },
    /// The name exists, no records of this type (or all expired). Carries the zone for the SOA.
    NoData {
        /// Zone apex.
        zone: String,
    },
    /// The name does not exist in a managed zone.
    NxDomain {
        /// Zone apex.
        zone: String,
    },
    /// Not ours: forward upstream.
    Forward,
    /// No usable zone (no bootstrap) or no view for this listener.
    ServFail,
}

/// Normalizes a query name: lowercase, dot-terminated.
#[must_use]
pub fn normalize(name: &str) -> String {
    let mut n = name.to_ascii_lowercase();
    if !n.ends_with('.') {
        n.push('.');
    }
    n
}

fn zone_of<'a>(view: &'a View, name: &str) -> Option<&'a str> {
    view.zones
        .iter()
        .filter(|z| name == z.as_str() || name.ends_with(&format!(".{z}")))
        .max_by_key(|z| z.len())
        .map(String::as_str)
}

/// Looks up one question. `zone` is `None` before the first valid zone is loaded.
#[must_use]
pub fn answer(
    zone: Option<&Zone>,
    listener: Ipv4Addr,
    qname: &str,
    qtype: u16,
    now_unix_ms: u64,
) -> Answer {
    let Some(zone) = zone else {
        return Answer::ServFail;
    };
    let Some(view) = zone.views.get(&listener) else {
        return Answer::ServFail;
    };
    let name = normalize(qname);
    let Some(apex) = zone_of(view, &name) else {
        return match zone
            .managed
            .iter()
            .find(|m| name == m.as_str() || name.ends_with(&format!(".{m}")))
        {
            Some(m) => Answer::NxDomain { zone: m.clone() },
            None => Answer::Forward,
        };
    };
    let Some(record) = view.names.get(&name) else {
        return Answer::NxDomain {
            zone: apex.to_owned(),
        };
    };
    if qtype != TYPE_A {
        return Answer::NoData {
            zone: apex.to_owned(),
        };
    }
    match record {
        Record::Vip { addr } => Answer::Addrs {
            addrs: vec![*addr],
            ttl: ANSWER_TTL,
        },
        Record::Rr { backends } => {
            let live: Vec<&RrBackend> = backends
                .iter()
                .filter(|b| b.expires_unix_ms > now_unix_ms)
                .collect();
            if live.is_empty() {
                return Answer::NoData {
                    zone: apex.to_owned(),
                };
            }
            let min_left_s = live
                .iter()
                .map(|b| (b.expires_unix_ms - now_unix_ms) / 1000)
                .min()
                .unwrap_or(0);
            let ttl = u32::try_from(min_left_s)
                .unwrap_or(ANSWER_TTL)
                .min(ANSWER_TTL);
            Answer::Addrs {
                addrs: live.iter().map(|b| b.addr).collect(),
                ttl,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const L: Ipv4Addr = Ipv4Addr::new(172, 30, 228, 1);
    const OTHER: Ipv4Addr = Ipv4Addr::new(172, 30, 228, 2);

    fn zone() -> Zone {
        let mut names = BTreeMap::new();
        names.insert(
            "api.prod.otd.internal.".into(),
            Record::Vip {
                addr: Ipv4Addr::new(172, 31, 0, 1),
            },
        );
        names.insert(
            "db.prod.otd.internal.".into(),
            Record::Rr {
                backends: vec![
                    RrBackend {
                        addr: Ipv4Addr::new(172, 24, 0, 2),
                        expires_unix_ms: 10_000,
                    },
                    RrBackend {
                        addr: Ipv4Addr::new(172, 24, 0, 3),
                        expires_unix_ms: 3_500,
                    },
                ],
            },
        );
        let mut views = BTreeMap::new();
        views.insert(
            L,
            View {
                zones: vec!["prod.otd.internal.".into()],
                names,
            },
        );
        views.insert(
            OTHER,
            View {
                zones: vec!["staging.otd.internal.".into()],
                names: BTreeMap::new(),
            },
        );
        Zone {
            serial: 7,
            managed: vec!["otd.internal.".into()],
            views,
        }
    }

    #[test]
    fn servfail_before_bootstrap_or_without_a_view() {
        assert_eq!(
            answer(None, L, "api.prod.otd.internal", TYPE_A, 0),
            Answer::ServFail
        );
        assert_eq!(
            answer(Some(&zone()), Ipv4Addr::new(1, 1, 1, 1), "x.", TYPE_A, 0),
            Answer::ServFail
        );
    }

    #[test]
    fn vip_is_constant_and_case_insensitive() {
        let a = answer(Some(&zone()), L, "API.Prod.otd.internal", TYPE_A, 0);
        assert_eq!(
            a,
            Answer::Addrs {
                addrs: vec![Ipv4Addr::new(172, 31, 0, 1)],
                ttl: 5
            }
        );
        assert_eq!(
            answer(Some(&zone()), L, "api.prod.otd.internal.", 28, 0),
            Answer::NoData {
                zone: "prod.otd.internal.".into()
            }
        );
    }

    #[test]
    fn rr_drops_expired_records_and_caps_ttl_by_freshness() {
        let z = zone();
        assert_eq!(
            answer(Some(&z), L, "db.prod.otd.internal.", TYPE_A, 1_000),
            Answer::Addrs {
                addrs: vec![Ipv4Addr::new(172, 24, 0, 2), Ipv4Addr::new(172, 24, 0, 3)],
                ttl: 2
            }
        );
        assert_eq!(
            answer(Some(&z), L, "db.prod.otd.internal.", TYPE_A, 4_000),
            Answer::Addrs {
                addrs: vec![Ipv4Addr::new(172, 24, 0, 2)],
                ttl: 5
            }
        );
        assert_eq!(
            answer(Some(&z), L, "db.prod.otd.internal.", TYPE_A, 10_000),
            Answer::NoData {
                zone: "prod.otd.internal.".into()
            }
        );
    }

    #[test]
    fn views_are_split_by_listener() {
        let z = zone();
        assert_eq!(
            answer(Some(&z), L, "nope.prod.otd.internal.", TYPE_A, 0),
            Answer::NxDomain {
                zone: "prod.otd.internal.".into()
            }
        );
        assert_eq!(
            answer(Some(&z), OTHER, "api.prod.otd.internal.", TYPE_A, 0),
            Answer::NxDomain {
                zone: "otd.internal.".into()
            },
            "another environment's names do not exist here and never leave the node"
        );
        assert_eq!(
            answer(Some(&z), L, "example.com", TYPE_A, 0),
            Answer::Forward
        );
    }
}
