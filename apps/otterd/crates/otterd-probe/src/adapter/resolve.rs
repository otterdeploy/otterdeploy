//! Name resolution for probes, with the resolver itself qualified.
//!
//! Probes resolve through a configured resolver (by default the first
//! `nameserver` of `/etc/resolv.conf`) by sending DNS queries themselves, so
//! they see the answer's response code instead of a generic lookup error:
//!
//! - NXDOMAIN is an authoritative answer about the target's name: a target
//!   failure (`target_dns_failure`).
//! - SERVFAIL or no answer may mean the target's DNS is broken, or that our
//!   own resolver is. The resolver is then asked for the root zone's NS
//!   records, which any working recursive resolver answers. If it does, the
//!   failure is the target's; if it does not, the local resolver is broken
//!   and the attempt is Unknown (`local_resolver_failure`).
//! - A resolver that refuses the connection or cannot be reached at all is
//!   local: Unknown.

use super::AttemptCtx;
use crate::outcome::{Attempt, ConfigCause, Phase, TargetCause, UnknownCause};
use hickory_proto::op::{Message, MessageType, OpCode, Query, ResponseCode};
use hickory_proto::rr::{Name, RecordType};
use std::hash::BuildHasher;
use std::io;
use std::net::{IpAddr, SocketAddr};
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tokio::net::UdpSocket;

/// Longest a single resolver query may take, and the qualification query.
const QUERY_TIMEOUT: Duration = Duration::from_secs(2);
const QUALIFY_TIMEOUT: Duration = Duration::from_secs(1);
/// Large enough for any UDP answer without EDNS.
const MAX_UDP: usize = 4_096;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolver {
    servers: Vec<SocketAddr>,
}

impl Resolver {
    pub fn new(servers: Vec<SocketAddr>) -> Self {
        Self { servers }
    }

    /// The `nameserver` lines of a resolv.conf.
    pub fn from_resolv_conf(text: &str) -> Self {
        let servers = text
            .lines()
            .filter_map(|line| {
                let mut f = line.split_ascii_whitespace();
                (f.next() == Some("nameserver"))
                    .then(|| f.next()?.parse::<IpAddr>().ok())
                    .flatten()
            })
            .map(|ip| SocketAddr::new(ip, 53))
            .collect();
        Self { servers }
    }

    /// Resolve `host` to addresses, or say why not as an attempt result.
    /// IP literals are returned as they are.
    pub async fn lookup(&self, host: &str, ctx: &AttemptCtx) -> Result<Vec<IpAddr>, Attempt> {
        if let Ok(ip) = IpAddr::from_str(host) {
            return Ok(vec![ip]);
        }
        ctx.progress.set(Phase::Resolve);
        let Some(server) = self.servers.first().copied() else {
            return Err(Attempt::ConfigurationError {
                cause: ConfigCause::Unsupported,
            });
        };
        let Ok(name) = Name::from_str(host) else {
            return Err(Attempt::ConfigurationError {
                cause: ConfigCause::InvalidTarget,
            });
        };
        let mut addrs = Vec::new();
        for rtype in [RecordType::A, RecordType::AAAA] {
            let timeout = remaining(ctx.deadline).min(QUERY_TIMEOUT);
            match query(server, &name, rtype, timeout).await {
                Ok(answer) => match answer.metadata.response_code {
                    ResponseCode::NoError => {
                        addrs.extend(answer.answers.iter().filter_map(|r| {
                            let text = r.data.to_string();
                            IpAddr::from_str(&text).ok()
                        }));
                        if !addrs.is_empty() {
                            return Ok(addrs);
                        }
                    }
                    ResponseCode::NXDomain => {
                        return Err(ctx.failure(TargetCause::TargetDnsFailure));
                    }
                    _ => return Err(self.qualify(server, ctx).await),
                },
                Err(QueryError::Timeout) => return Err(self.qualify(server, ctx).await),
                Err(QueryError::Io(_) | QueryError::Malformed) => {
                    return Err(ctx.unknown(UnknownCause::LocalResolverFailure));
                }
            }
        }
        // NOERROR with no address records of either family.
        Err(ctx.failure(TargetCause::TargetDnsFailure))
    }

    /// The target's lookup failed without an authoritative answer: decide
    /// whether that is the target's DNS or our resolver.
    async fn qualify(&self, server: SocketAddr, ctx: &AttemptCtx) -> Attempt {
        let timeout = remaining(ctx.deadline).min(QUALIFY_TIMEOUT);
        match query(server, &Name::root(), RecordType::NS, timeout).await {
            Ok(m) if m.metadata.response_code == ResponseCode::NoError && !m.answers.is_empty() => {
                ctx.failure(TargetCause::TargetDnsFailure)
            }
            _ => ctx.unknown(UnknownCause::LocalResolverFailure),
        }
    }
}

fn remaining(deadline: Instant) -> Duration {
    deadline.saturating_duration_since(Instant::now())
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum QueryError {
    #[error("no answer in time")]
    Timeout,
    #[error("socket: {0}")]
    Io(#[from] io::Error),
    #[error("malformed message")]
    Malformed,
}

/// A query id that an off-path observer cannot guess from our clock.
fn query_id() -> u16 {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let h = std::hash::RandomState::new().hash_one(n);
    u16::try_from(h & 0xffff).unwrap_or(0)
}

/// One query over UDP to `server`, waiting at most `timeout` for the answer
/// with the matching id. A refused port (ICMP port unreachable) surfaces as
/// an `Io` error with kind `ConnectionRefused`.
pub(crate) async fn query(
    server: SocketAddr,
    name: &Name,
    rtype: RecordType,
    timeout: Duration,
) -> Result<Message, QueryError> {
    let id = query_id();
    let mut msg = Message::new(id, MessageType::Query, OpCode::Query);
    msg.metadata.recursion_desired = true;
    msg.add_query(Query::query(name.clone(), rtype));
    let bytes = msg.to_vec().map_err(|_| QueryError::Malformed)?;
    let bind: SocketAddr = if server.is_ipv4() {
        ([0, 0, 0, 0], 0).into()
    } else {
        (std::net::Ipv6Addr::UNSPECIFIED, 0).into()
    };
    let socket = UdpSocket::bind(bind).await?;
    socket.connect(server).await?;
    socket.send(&bytes).await?;
    let mut buf = vec![0u8; MAX_UDP];
    let read = async {
        loop {
            let n = socket.recv(&mut buf).await?;
            if let Some(received) = buf.get(..n)
                && let Ok(answer) = Message::from_vec(received)
                && answer.metadata.id == id
            {
                return Ok::<_, QueryError>(answer);
            }
        }
    };
    tokio::time::timeout(timeout, read)
        .await
        .map_err(|_| QueryError::Timeout)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_nameservers_from_resolv_conf() {
        let r = Resolver::from_resolv_conf(
            "# generated\nnameserver 127.0.0.53\noptions edns0\nnameserver ::1\nsearch x\n",
        );
        assert_eq!(
            r.servers,
            vec![
                SocketAddr::from(([127, 0, 0, 53], 53)),
                SocketAddr::new("::1".parse().unwrap(), 53)
            ]
        );
    }

    #[test]
    fn query_ids_vary() {
        let ids: std::collections::HashSet<u16> = (0..64).map(|_| query_id()).collect();
        assert!(ids.len() > 32);
    }
}
