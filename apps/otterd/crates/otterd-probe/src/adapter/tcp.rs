//! TCP connect probes, and the connect step every other TCP probe shares.

use super::{AttemptCtx, bare_host, classify_io};
use crate::outcome::{Attempt, ConfigCause, Phase};
use std::net::SocketAddr;
use tokio::net::TcpStream;

/// Resolve `host` and connect to its first address.
pub(crate) async fn connect(host: &str, port: u16, ctx: &AttemptCtx) -> Result<TcpStream, Attempt> {
    if port == 0 || host.is_empty() {
        return Err(Attempt::ConfigurationError {
            cause: ConfigCause::InvalidTarget,
        });
    }
    let addrs = ctx.resolver.lookup(bare_host(host), ctx).await?;
    let Some(ip) = addrs.first().copied() else {
        return Err(ctx.failure(crate::outcome::TargetCause::TargetDnsFailure));
    };
    ctx.progress.set(Phase::Connect);
    let stream = TcpStream::connect(SocketAddr::new(ip, port))
        .await
        .map_err(|e| classify_io(&e, ctx))?;
    // Small request/response exchanges: do not wait to coalesce writes.
    let _ = stream.set_nodelay(true);
    Ok(stream)
}

pub(crate) async fn probe(host: &str, port: u16, ctx: &AttemptCtx) -> Attempt {
    match connect(host, port, ctx).await {
        Ok(_stream) => ctx.success(),
        Err(attempt) => attempt,
    }
}
