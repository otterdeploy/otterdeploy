//! `otterd-dns`: serves the zone otterd persists, on every environment's listener address.
//!
//! ```text
//! otterd-dns [zone.json] [--listen <ip>[,<ip>...]] [--resolv <resolv.conf>]
//! ```
//!
//! `--listen` binds the environments' listener addresses before any zone exists, so clients get
//! SERVFAIL (not a timeout) until the first authenticated zone arrives.
//!
//! Runs as `otterd-dns.service` (`Type=notify`, `WatchdogSec=`), independent of the reconciler.
//! The zone is re-read when its file changes; until a valid zone exists every query gets
//! SERVFAIL. Names outside the managed zones are forwarded to the host's upstream resolver.

use std::collections::BTreeSet;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use otterd_dns::wire;
use otterd_dns::zone::{self, Answer, Zone};

type Shared = Arc<RwLock<Option<Zone>>>;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

fn upstream(resolv: &PathBuf) -> Option<SocketAddr> {
    let text = std::fs::read_to_string(resolv).ok()?;
    text.lines()
        .filter_map(|l| l.trim().strip_prefix("nameserver"))
        .filter_map(|a| a.trim().parse::<std::net::IpAddr>().ok())
        .map(|ip| SocketAddr::new(ip, 53))
        .next()
}

fn forward(msg: &[u8], to: Option<SocketAddr>) -> Option<Vec<u8>> {
    let to = to?;
    let bind: SocketAddr = if to.is_ipv4() {
        "0.0.0.0:0".parse().ok()?
    } else {
        "[::]:0".parse().ok()?
    };
    let s = UdpSocket::bind(bind).ok()?;
    s.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
    s.send_to(msg, to).ok()?;
    let mut buf = vec![0u8; 4096];
    let (n, _) = s.recv_from(&mut buf).ok()?;
    buf.truncate(n);
    Some(buf)
}

fn handle(
    msg: &[u8],
    listener: Ipv4Addr,
    zone: &Shared,
    up: Option<SocketAddr>,
) -> Option<Vec<u8>> {
    let q = match wire::parse(msg) {
        Ok(q) => q,
        Err((Some(id), _)) => return Some(wire::formerr(id)),
        Err((None, _)) => return None,
    };
    let guard = zone.read().ok()?;
    let a = zone::answer(guard.as_ref(), listener, &q.name, q.qtype, now_ms());
    let serial = guard.as_ref().map_or(0, |z| z.serial);
    drop(guard);
    match a {
        Answer::Forward => {
            Some(forward(msg, up).unwrap_or_else(|| wire::respond(&q, &Answer::ServFail, serial)))
        }
        other => Some(wire::respond(&q, &other, serial)),
    }
}

fn serve_udp(sock: &UdpSocket, listener: Ipv4Addr, zone: &Shared, up: Option<SocketAddr>) {
    let mut buf = vec![0u8; 4096];
    loop {
        let Ok((n, peer)) = sock.recv_from(&mut buf) else {
            continue;
        };
        if let Some(r) = handle(buf.get(..n).unwrap_or_default(), listener, zone, up) {
            let _ = sock.send_to(&r, peer);
        }
    }
}

fn serve_tcp_conn(mut c: TcpStream, listener: Ipv4Addr, zone: &Shared, up: Option<SocketAddr>) {
    let _ = c.set_read_timeout(Some(Duration::from_secs(10)));
    loop {
        let mut len = [0u8; 2];
        if c.read_exact(&mut len).is_err() {
            return;
        }
        let mut msg = vec![0u8; usize::from(u16::from_be_bytes(len))];
        if c.read_exact(&mut msg).is_err() {
            return;
        }
        let Some(r) = handle(&msg, listener, zone, up) else {
            return;
        };
        let Ok(l) = u16::try_from(r.len()) else {
            return;
        };
        if c.write_all(&l.to_be_bytes())
            .and_then(|()| c.write_all(&r))
            .is_err()
        {
            return;
        }
    }
}

fn bind(addr: Ipv4Addr, zone: &Shared, up: Option<SocketAddr>) -> std::io::Result<()> {
    let sa = SocketAddr::from((addr, 53));
    let udp = UdpSocket::bind(sa)?;
    let tcp = TcpListener::bind(sa)?;
    let z = Arc::clone(zone);
    std::thread::spawn(move || serve_udp(&udp, addr, &z, up));
    let z = Arc::clone(zone);
    std::thread::spawn(move || {
        for c in tcp.incoming().flatten() {
            let z = Arc::clone(&z);
            std::thread::spawn(move || serve_tcp_conn(c, addr, &z, up));
        }
    });
    Ok(())
}

fn main() {
    let mut zone_path = PathBuf::from("/var/lib/otterd/dns/zone.json");
    let mut resolv = PathBuf::from("/etc/resolv.conf");
    let mut listen: Vec<Ipv4Addr> = Vec::new();
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--listen" => listen.extend(
                args.next()
                    .unwrap_or_default()
                    .split(',')
                    .filter_map(|x| x.trim().parse::<Ipv4Addr>().ok()),
            ),
            "--resolv" => resolv = PathBuf::from(args.next().unwrap_or_default()),
            _ => zone_path = PathBuf::from(a),
        }
    }
    let up = upstream(&resolv);
    let zone: Shared = Arc::new(RwLock::new(None));
    let mut bound: BTreeSet<Ipv4Addr> = BTreeSet::new();
    let mut seen: Option<SystemTime> = None;
    let mut ready = false;
    let notifier = otterd_sys::notify::Notifier::from_env();
    loop {
        let mtime = std::fs::metadata(&zone_path)
            .and_then(|m| m.modified())
            .ok();
        if mtime != seen {
            seen = mtime;
            match std::fs::read_to_string(&zone_path)
                .map_err(|e| e.to_string())
                .and_then(|t| serde_json::from_str::<Zone>(&t).map_err(|e| e.to_string()))
            {
                Ok(z) => {
                    if let Ok(mut w) = zone.write() {
                        *w = Some(z);
                    }
                }
                // Keep the last good zone; a half-written or invalid file never clears it.
                Err(e) => eprintln!("otterd-dns: zone {}: {e}", zone_path.display()),
            }
        }
        let mut wanted: Vec<Ipv4Addr> = zone
            .read()
            .map(|z| {
                z.as_ref()
                    .map(|z| z.views.keys().copied().collect())
                    .unwrap_or_default()
            })
            .unwrap_or_default();
        wanted.extend(listen.iter().copied());
        for addr in wanted {
            if !bound.contains(&addr) {
                match bind(addr, &zone, up) {
                    Ok(()) => {
                        bound.insert(addr);
                    }
                    Err(e) => eprintln!("otterd-dns: listen {addr}:53: {e} (retrying)"),
                }
            }
        }
        if !ready {
            let _ = notifier.ready();
            ready = true;
        }
        let _ = notifier.watchdog();
        std::thread::sleep(Duration::from_secs(1));
    }
}
