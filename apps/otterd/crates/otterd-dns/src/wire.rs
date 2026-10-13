//! DNS wire format: just enough to parse one-question queries and build the responses the
//! responder gives (A answers, NXDOMAIN/NODATA with an SOA, SERVFAIL, FORMERR).

use std::net::Ipv4Addr;

use crate::zone::{Answer, NEGATIVE_TTL};

/// A parsed query.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Query {
    /// Transaction id.
    pub id: u16,
    /// Recursion desired, echoed back.
    pub rd: bool,
    /// Question name, dot-terminated as received (case preserved for the echo).
    pub name: String,
    /// Question type.
    pub qtype: u16,
    /// Question class.
    pub qclass: u16,
    /// Raw question section, echoed verbatim in the response.
    question: Vec<u8>,
}

/// Why a datagram is not a query this responder answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum WireError {
    /// Shorter than a header or truncated inside the question.
    #[error("truncated message")]
    Truncated,
    /// Not exactly one question, or a response bit set.
    #[error("not a one-question query")]
    Shape,
    /// Compression pointers or a label longer than 63 in the question.
    #[error("malformed question name")]
    Name,
}

/// Parses a query. Returns the id too on shape errors so FORMERR can be answered.
///
/// # Errors
/// [`WireError`].
pub fn parse(msg: &[u8]) -> Result<Query, (Option<u16>, WireError)> {
    let Some((&[i0, i1, f0, f1, q0, q1, ..], _)) = msg.split_first_chunk::<12>() else {
        return Err((None, WireError::Truncated));
    };
    let id = u16::from_be_bytes([i0, i1]);
    let flags = u16::from_be_bytes([f0, f1]);
    let qd = u16::from_be_bytes([q0, q1]);
    if flags & 0x8000 != 0 || qd != 1 || (flags >> 11) & 0xF != 0 {
        return Err((Some(id), WireError::Shape));
    }
    let mut i = 12;
    let mut name = String::new();
    loop {
        let len = usize::from(*msg.get(i).ok_or((Some(id), WireError::Truncated))?);
        i += 1;
        if len == 0 {
            break;
        }
        if len > 63 {
            return Err((Some(id), WireError::Name));
        }
        let label = msg
            .get(i..i + len)
            .ok_or((Some(id), WireError::Truncated))?;
        name.push_str(&String::from_utf8_lossy(label));
        name.push('.');
        i += len;
        if name.len() > 255 {
            return Err((Some(id), WireError::Name));
        }
    }
    if name.is_empty() {
        name.push('.');
    }
    let Some(&[t0, t1, c0, c1]) = msg.get(i..i + 4) else {
        return Err((Some(id), WireError::Truncated));
    };
    let qtype = u16::from_be_bytes([t0, t1]);
    let qclass = u16::from_be_bytes([c0, c1]);
    Ok(Query {
        id,
        rd: flags & 0x0100 != 0,
        name,
        qtype,
        qclass,
        question: msg.get(12..i + 4).unwrap_or_default().to_vec(),
    })
}

const RCODE_FORMERR: u16 = 1;
const RCODE_SERVFAIL: u16 = 2;
const RCODE_NXDOMAIN: u16 = 3;

/// Section counts: question, answer, authority.
#[derive(Clone, Copy)]
struct Counts(u16, u16, u16);

fn header(out: &mut Vec<u8>, id: u16, rd: bool, aa: bool, rcode: u16, Counts(qd, an, ns): Counts) {
    let mut flags = 0x8000 | rcode;
    if aa {
        flags |= 0x0400;
    }
    if rd {
        flags |= 0x0100;
    }
    for v in [id, flags, qd, an, ns, 0] {
        out.extend_from_slice(&v.to_be_bytes());
    }
}

fn encode_name(out: &mut Vec<u8>, name: &str) {
    for label in name
        .trim_end_matches('.')
        .split('.')
        .filter(|l| !l.is_empty())
    {
        let bytes = label.as_bytes();
        let bytes = bytes.get(..63).unwrap_or(bytes);
        out.push(u8::try_from(bytes.len()).unwrap_or(63));
        out.extend_from_slice(bytes);
    }
    out.push(0);
}

fn soa(out: &mut Vec<u8>, zone: &str, serial: u32) {
    encode_name(out, zone);
    out.extend_from_slice(&6u16.to_be_bytes()); // SOA
    out.extend_from_slice(&1u16.to_be_bytes()); // IN
    out.extend_from_slice(&NEGATIVE_TTL.to_be_bytes());
    let mut rdata = Vec::new();
    encode_name(&mut rdata, &format!("ns.{zone}"));
    encode_name(&mut rdata, &format!("hostmaster.{zone}"));
    for v in [serial, 30, 10, 300, NEGATIVE_TTL] {
        rdata.extend_from_slice(&v.to_be_bytes());
    }
    out.extend_from_slice(&u16::try_from(rdata.len()).unwrap_or(0).to_be_bytes());
    out.extend_from_slice(&rdata);
}

/// Builds the response to `q` for a non-forward [`Answer`].
#[must_use]
pub fn respond(q: &Query, answer: &Answer, serial: u32) -> Vec<u8> {
    let mut out = Vec::with_capacity(128);
    match answer {
        Answer::Addrs { addrs, ttl } => {
            let an = u16::try_from(addrs.len()).unwrap_or(u16::MAX);
            header(&mut out, q.id, q.rd, true, 0, Counts(1, an, 0));
            out.extend_from_slice(&q.question);
            for a in addrs {
                a_record(&mut out, *a, *ttl);
            }
        }
        Answer::NoData { zone } => {
            header(&mut out, q.id, q.rd, true, 0, Counts(1, 0, 1));
            out.extend_from_slice(&q.question);
            soa(&mut out, zone, serial);
        }
        Answer::NxDomain { zone } => {
            header(&mut out, q.id, q.rd, true, RCODE_NXDOMAIN, Counts(1, 0, 1));
            out.extend_from_slice(&q.question);
            soa(&mut out, zone, serial);
        }
        Answer::ServFail | Answer::Forward => {
            header(&mut out, q.id, q.rd, false, RCODE_SERVFAIL, Counts(1, 0, 0));
            out.extend_from_slice(&q.question);
        }
    }
    out
}

fn a_record(out: &mut Vec<u8>, addr: Ipv4Addr, ttl: u32) {
    out.extend_from_slice(&[0xC0, 0x0C]); // pointer to the question name
    out.extend_from_slice(&1u16.to_be_bytes());
    out.extend_from_slice(&1u16.to_be_bytes());
    out.extend_from_slice(&ttl.to_be_bytes());
    out.extend_from_slice(&4u16.to_be_bytes());
    out.extend_from_slice(&addr.octets());
}

/// FORMERR for a datagram whose id could be read.
#[must_use]
pub fn formerr(id: u16) -> Vec<u8> {
    let mut out = Vec::with_capacity(12);
    header(&mut out, id, false, false, RCODE_FORMERR, Counts(0, 0, 0));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query(name: &str, qtype: u16) -> Vec<u8> {
        let mut m = vec![0x12, 0x34, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0];
        encode_name(&mut m, name);
        m.extend_from_slice(&qtype.to_be_bytes());
        m.extend_from_slice(&1u16.to_be_bytes());
        m
    }

    #[test]
    fn parses_and_answers_an_a_query() {
        let q = parse(&query("API.prod.otd.internal.", 1)).unwrap();
        assert_eq!(
            (q.id, q.rd, q.name.as_str(), q.qtype),
            (0x1234, true, "API.prod.otd.internal.", 1)
        );
        let r = respond(
            &q,
            &Answer::Addrs {
                addrs: vec![Ipv4Addr::new(172, 31, 0, 1)],
                ttl: 5,
            },
            1,
        );
        assert_eq!(&r[0..2], &[0x12, 0x34]);
        assert_eq!(u16::from_be_bytes([r[2], r[3]]) & 0x000F, 0);
        assert_eq!(u16::from_be_bytes([r[6], r[7]]), 1, "one answer");
        assert_eq!(&r[r.len() - 4..], &[172, 31, 0, 1]);
        assert_eq!(&r[r.len() - 10..r.len() - 6], &5u32.to_be_bytes());
    }

    #[test]
    fn nxdomain_carries_an_soa_with_the_negative_ttl() {
        let q = parse(&query("nope.prod.otd.internal.", 1)).unwrap();
        let r = respond(
            &q,
            &Answer::NxDomain {
                zone: "prod.otd.internal.".into(),
            },
            9,
        );
        assert_eq!(u16::from_be_bytes([r[2], r[3]]) & 0x000F, RCODE_NXDOMAIN);
        assert_eq!(u16::from_be_bytes([r[8], r[9]]), 1, "authority SOA");
        assert_eq!(&r[r.len() - 4..], &NEGATIVE_TTL.to_be_bytes());
    }

    #[test]
    fn malformed_queries_are_refused() {
        assert_eq!(parse(&[1, 2, 3]).unwrap_err().1, WireError::Truncated);
        let mut resp = query("a.", 1);
        resp[2] |= 0x80;
        assert_eq!(parse(&resp).unwrap_err(), (Some(0x1234), WireError::Shape));
        let mut ptr = vec![
            0x12, 0x34, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0xC0, 0x0C, 0, 1, 0, 1,
        ];
        assert_eq!(parse(&ptr).unwrap_err().1, WireError::Name);
        ptr.truncate(13);
        assert_eq!(parse(&ptr).unwrap_err().1, WireError::Name);
        assert_eq!(formerr(7)[3] & 0x0F, 1);
    }
}
