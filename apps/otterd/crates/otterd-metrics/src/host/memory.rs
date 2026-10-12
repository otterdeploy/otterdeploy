//! `/proc/meminfo` and the ZFS ARC size.

use crate::reading::Memory;

/// Parse `/proc/meminfo` (values in kB). `None` if a required field is missing.
pub(crate) fn parse_meminfo(text: &str, zfs_arc: Option<u64>) -> Option<Memory> {
    let mut total = None;
    let mut available = None;
    let mut free = None;
    let mut buffers = 0;
    let mut cached = 0;
    let mut reclaimable = 0;
    let mut swap_total = 0;
    let mut swap_free = 0;
    for line in text.lines() {
        let Some((key, rest)) = line.split_once(':') else {
            continue;
        };
        let Some(kb) = rest
            .split_ascii_whitespace()
            .next()
            .and_then(|v| v.parse::<u64>().ok())
        else {
            continue;
        };
        let bytes = kb.saturating_mul(1024);
        match key {
            "MemTotal" => total = Some(bytes),
            "MemAvailable" => available = Some(bytes),
            "MemFree" => free = Some(bytes),
            "Buffers" => buffers = bytes,
            "Cached" => cached = bytes,
            "SReclaimable" => reclaimable = bytes,
            "SwapTotal" => swap_total = bytes,
            "SwapFree" => swap_free = bytes,
            _ => {}
        }
    }
    let total = total?;
    // MemAvailable exists since 3.14; older kernels get a conservative estimate.
    let available = available.or_else(|| free.map(|f| f + buffers + cached))?;
    Some(Memory {
        total,
        used: total.saturating_sub(available),
        available,
        buffers,
        cached: cached.saturating_add(reclaimable),
        zfs_arc,
        swap_total,
        swap_used: swap_total.saturating_sub(swap_free),
    })
}

/// The `size` row of `/proc/spl/kstat/zfs/arcstats`.
pub(crate) fn parse_arc_size(text: &str) -> Option<u64> {
    text.lines().find_map(|line| {
        let mut f = line.split_ascii_whitespace();
        (f.next() == Some("size"))
            .then(|| f.nth(1)?.parse().ok())
            .flatten()
    })
}

/// `/proc/loadavg`.
pub(crate) fn parse_loadavg(text: &str) -> Option<[f32; 3]> {
    let mut f = text.split_ascii_whitespace().map(|v| v.parse::<f32>().ok());
    Some([f.next()??, f.next()??, f.next()??])
}

/// `/proc/uptime`, whole seconds.
pub(crate) fn parse_uptime(text: &str) -> Option<u64> {
    let secs: f64 = text.split_ascii_whitespace().next()?.parse().ok()?;
    // Uptime is non-negative and far below 2^53 seconds.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    (secs.is_finite() && secs >= 0.0).then_some(secs as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MEMINFO: &str = "MemTotal:        8000000 kB\n\
MemFree:          500000 kB\n\
MemAvailable:    6000000 kB\n\
Buffers:          100000 kB\n\
Cached:          2000000 kB\n\
SwapCached:            0 kB\n\
SReclaimable:     300000 kB\n\
SwapTotal:       1000000 kB\n\
SwapFree:         750000 kB\n";

    #[test]
    fn meminfo_used_is_total_minus_available() {
        let m = parse_meminfo(MEMINFO, None).unwrap();
        assert_eq!(m.total, 8_000_000 * 1024);
        assert_eq!(m.used, 2_000_000 * 1024);
        assert_eq!(m.cached, 2_300_000 * 1024);
        assert_eq!(m.swap_used, 250_000 * 1024);
    }

    #[test]
    fn meminfo_without_total_is_no_reading() {
        assert_eq!(parse_meminfo("MemFree: 1 kB\n", None), None);
    }

    #[test]
    fn arc_size_row() {
        let text = "13 1 0x01 123 33456 1 2\nname type data\nhits 4 100\nsize 4 2147483648\n";
        assert_eq!(parse_arc_size(text), Some(2_147_483_648));
    }

    #[test]
    fn loadavg_and_uptime() {
        assert_eq!(
            parse_loadavg("0.52 0.40 0.31 2/345 6789\n"),
            Some([0.52, 0.40, 0.31])
        );
        assert_eq!(parse_uptime("12345.67 9999.00\n"), Some(12345));
    }
}
