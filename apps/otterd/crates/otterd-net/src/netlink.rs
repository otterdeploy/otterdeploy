//! Link-change notifications from the kernel (rtnetlink `RTMGRP_LINK`).
//!
//! New veths are seen even while Docker is down, so guarding never depends on Docker events.
//! The monitor only signals "links changed"; the reconciler re-reads state itself, so a lost or
//! coalesced message can never leave a stale view (the socket's overflow is treated the same).

use std::io;
use std::os::fd::OwnedFd;
use std::time::Duration;

use rustix::event::{PollFd, PollFlags, Timespec, poll};
use rustix::io::Errno;
use rustix::net::netlink::SocketAddrNetlink;
use rustix::net::{AddressFamily, RecvFlags, SocketFlags, SocketType, bind, recv, socket_with};

const RTMGRP_LINK: u32 = 1;
const RTM_NEWLINK: u16 = 16;
const RTM_DELLINK: u16 = 17;

/// A bound rtnetlink socket subscribed to link events.
#[derive(Debug)]
pub struct LinkMonitor {
    fd: OwnedFd,
}

/// What one wait returned.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkEvent {
    /// At least one link was added, removed or changed (or messages were lost).
    Changed,
    /// Nothing within the wait bound.
    Idle,
}

impl LinkMonitor {
    /// Opens and binds the socket (`NETLINK_ROUTE` is the `None` protocol).
    ///
    /// # Errors
    /// The socket cannot be created or bound (no permission).
    pub fn open() -> io::Result<Self> {
        let fd = socket_with(
            AddressFamily::NETLINK,
            SocketType::RAW,
            SocketFlags::CLOEXEC,
            None,
        )?;
        bind(&fd, &SocketAddrNetlink::new(0, RTMGRP_LINK))?;
        Ok(Self { fd })
    }

    /// Waits up to `bound` for link messages.
    ///
    /// # Errors
    /// An unexpected socket error. Buffer overflow (`ENOBUFS`) is reported as `Changed`.
    pub fn wait(&self, bound: Duration) -> io::Result<LinkEvent> {
        let mut fds = [PollFd::new(&self.fd, PollFlags::IN)];
        let timeout = Timespec {
            tv_sec: i64::try_from(bound.as_secs()).unwrap_or(i64::MAX),
            tv_nsec: i64::from(bound.subsec_nanos()),
        };
        match poll(&mut fds, Some(&timeout)) {
            Ok(0) | Err(Errno::INTR) => return Ok(LinkEvent::Idle),
            Ok(_) => {}
            Err(e) => return Err(e.into()),
        }
        let mut buf = vec![0u8; 64 * 1024];
        let mut changed = false;
        loop {
            match recv(&self.fd, &mut buf, RecvFlags::DONTWAIT) {
                Ok((len, _)) => changed |= has_link_message(buf.get(..len).unwrap_or_default()),
                Err(Errno::AGAIN) => break,
                Err(Errno::NOBUFS) => changed = true,
                Err(Errno::INTR) => {}
                Err(e) => return Err(e.into()),
            }
        }
        Ok(if changed {
            LinkEvent::Changed
        } else {
            LinkEvent::Idle
        })
    }
}

/// Whether a netlink datagram holds a link add/remove/change message.
fn has_link_message(mut data: &[u8]) -> bool {
    // nlmsghdr: u32 len, u16 type, u16 flags, u32 seq, u32 pid (native endian).
    while let Some((&[l0, l1, l2, l3, t0, t1], _)) = data.split_first_chunk::<6>() {
        let len = usize::try_from(u32::from_ne_bytes([l0, l1, l2, l3])).unwrap_or(usize::MAX);
        let kind = u16::from_ne_bytes([t0, t1]);
        if kind == RTM_NEWLINK || kind == RTM_DELLINK {
            return true;
        }
        let step = len.saturating_add(3) & !3;
        if len < 16 {
            break;
        }
        match data.get(step..) {
            Some(rest) => data = rest,
            None => break,
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(kind: u16) -> Vec<u8> {
        let mut m = Vec::new();
        m.extend_from_slice(&20u32.to_ne_bytes());
        m.extend_from_slice(&kind.to_ne_bytes());
        m.extend_from_slice(&[0u8; 14]);
        m
    }

    #[test]
    fn finds_link_messages_among_others() {
        let mut d = msg(24); // RTM_NEWROUTE
        d.extend(msg(RTM_NEWLINK));
        assert!(has_link_message(&d));
        assert!(!has_link_message(&msg(24)));
        assert!(!has_link_message(&[1, 2, 3]));
    }
}
