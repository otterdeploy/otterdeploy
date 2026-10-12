//! ICMP echo probes.
//!
//! Uses an unprivileged ICMP datagram socket where the host's
//! `net.ipv4.ping_group_range` admits us, otherwise a raw socket, which
//! needs `CAP_NET_RAW`. With neither, the check is a configuration error
//! (`permission_missing`), never a failed vote.

use super::{AttemptCtx, bare_host, classify_io};
use crate::outcome::{Attempt, ConfigCause, Phase, TargetCause, UnknownCause};
use socket2::{Domain, Protocol, Socket, Type};
use std::io::ErrorKind;
use std::net::{IpAddr, SocketAddr};
use tokio::net::UdpSocket;

const ECHO_REQUEST_V4: u8 = 8;
const ECHO_REPLY_V4: u8 = 0;
const UNREACHABLE_V4: u8 = 3;
const ECHO_REQUEST_V6: u8 = 128;
const ECHO_REPLY_V6: u8 = 129;
const UNREACHABLE_V6: u8 = 1;

fn open(ip: IpAddr) -> std::io::Result<(Socket, bool)> {
    let (domain, proto) = if ip.is_ipv4() {
        (Domain::IPV4, Protocol::ICMPV4)
    } else {
        (Domain::IPV6, Protocol::ICMPV6)
    };
    match Socket::new(domain, Type::DGRAM, Some(proto)) {
        Ok(s) => Ok((s, false)),
        Err(e) if e.kind() == ErrorKind::PermissionDenied => {
            Socket::new(domain, Type::RAW, Some(proto)).map(|s| (s, true))
        }
        Err(e) => Err(e),
    }
}

fn checksum(data: &[u8]) -> u16 {
    let mut sum: u32 = data
        .chunks(2)
        .map(|c| {
            let hi = c.first().copied().unwrap_or(0);
            let lo = c.get(1).copied().unwrap_or(0);
            u32::from(u16::from_be_bytes([hi, lo]))
        })
        .sum();
    while sum > 0xffff {
        sum = (sum & 0xffff) + (sum >> 16);
    }
    !u16::try_from(sum).unwrap_or(0xffff)
}

fn echo_request(v4: bool, seq: u16, token: [u8; 8]) -> Vec<u8> {
    let mut p = vec![if v4 { ECHO_REQUEST_V4 } else { ECHO_REQUEST_V6 }, 0, 0, 0];
    // identifier (the kernel replaces it on datagram sockets), sequence, token
    p.extend_from_slice(&0x6f74u16.to_be_bytes());
    p.extend_from_slice(&seq.to_be_bytes());
    p.extend_from_slice(&token);
    if v4 {
        let c = checksum(&p).to_be_bytes();
        if let Some(field) = p.get_mut(2..4) {
            field.copy_from_slice(&c);
        }
    }
    p
}

/// What a received packet says about our echo.
#[derive(Debug, PartialEq, Eq)]
enum Reply {
    Echo,
    Unreachable,
    Other,
}

fn read_reply(packet: &[u8], v4: bool, raw: bool, seq: u16, token: [u8; 8]) -> Reply {
    // Raw IPv4 sockets deliver the IP header too; IPv6 never does.
    let icmp = match packet.first() {
        Some(&b) if v4 && raw && b >> 4 == 4 => {
            let ihl = usize::from(b & 0x0f) * 4;
            packet.get(ihl..).unwrap_or(&[])
        }
        _ => packet,
    };
    let Some(&kind) = icmp.first() else {
        return Reply::Other;
    };
    let (reply, unreachable) = if v4 {
        (ECHO_REPLY_V4, UNREACHABLE_V4)
    } else {
        (ECHO_REPLY_V6, UNREACHABLE_V6)
    };
    if kind == reply
        && icmp.get(6..8) == Some(&seq.to_be_bytes()[..])
        && icmp.get(8..16) == Some(&token[..])
    {
        Reply::Echo
    } else if kind == unreachable {
        Reply::Unreachable
    } else {
        Reply::Other
    }
}

pub(crate) async fn probe(host: &str, ctx: &AttemptCtx) -> Attempt {
    let addrs = match ctx.resolver.lookup(bare_host(host), ctx).await {
        Ok(a) => a,
        Err(a) => return a,
    };
    let Some(ip) = addrs.first().copied() else {
        return ctx.failure(TargetCause::TargetDnsFailure);
    };
    let (socket, raw) = match open(ip) {
        Ok(s) => s,
        Err(e) if e.kind() == ErrorKind::PermissionDenied => {
            return Attempt::ConfigurationError {
                cause: ConfigCause::PermissionMissing,
            };
        }
        Err(_) => return ctx.unknown(UnknownCause::ExecutorFailure),
    };
    if socket.set_nonblocking(true).is_err() {
        return ctx.unknown(UnknownCause::ExecutorFailure);
    }
    let Ok(socket) = UdpSocket::from_std(std::net::UdpSocket::from(socket)) else {
        return ctx.unknown(UnknownCause::ExecutorFailure);
    };
    let started_ns = ctx.started.elapsed().subsec_nanos();
    let token: [u8; 8] = (u64::from(started_ns) ^ 0x6f74_7465_7264_0000).to_be_bytes();
    let seq = u16::try_from(started_ns & 0xffff).unwrap_or(1);
    let v4 = ip.is_ipv4();
    ctx.progress.set(Phase::Request);
    if let Err(e) = socket
        .send_to(&echo_request(v4, seq, token), SocketAddr::new(ip, 0))
        .await
    {
        return classify_io(&e, ctx);
    }
    ctx.progress.set(Phase::Response);
    let mut buf = [0u8; 1_500];
    loop {
        match socket.recv_from(&mut buf).await {
            Err(e) => return classify_io(&e, ctx),
            Ok((n, from)) if from.ip() == ip || raw => {
                match read_reply(buf.get(..n).unwrap_or(&[]), v4, raw, seq, token) {
                    Reply::Echo => return ctx.success(),
                    Reply::Unreachable => return ctx.failure(TargetCause::TargetUnreachable),
                    Reply::Other => {}
                }
            }
            Ok(_) => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v4_checksum_verifies_to_zero() {
        let p = echo_request(true, 7, *b"otterd!!");
        assert_eq!(checksum(&p), 0);
    }

    #[test]
    fn matches_only_our_reply() {
        let token = *b"12345678";
        let mut reply = echo_request(true, 9, token);
        reply[0] = ECHO_REPLY_V4;
        assert_eq!(read_reply(&reply, true, false, 9, token), Reply::Echo);
        assert_eq!(read_reply(&reply, true, false, 10, token), Reply::Other);
        // raw socket: behind a 20-byte IPv4 header
        let mut with_ip = vec![0x45; 1];
        with_ip.extend_from_slice(&[0; 19]);
        with_ip.extend_from_slice(&reply);
        assert_eq!(read_reply(&with_ip, true, true, 9, token), Reply::Echo);
        assert_eq!(
            read_reply(&[UNREACHABLE_V4, 1, 0, 0], true, false, 9, token),
            Reply::Unreachable
        );
    }
}
