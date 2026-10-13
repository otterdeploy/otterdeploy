//! `/proc/diskstats` for whole block devices.

/// Cumulative counters of one device: bytes read, bytes written, and
/// milliseconds with I/O in flight.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DiskCounters {
    pub(crate) device: String,
    pub(crate) read_bytes: u64,
    pub(crate) written_bytes: u64,
    pub(crate) io_ms: u64,
}

/// `/proc/diskstats` counts in 512-byte sectors regardless of the device's
/// own sector size.
const SECTOR: u64 = 512;

/// Every device line. Which of them are whole physical disks is decided by
/// the caller from sysfs ([`is_whole_disk`]).
pub(crate) fn parse_diskstats(text: &str) -> Vec<DiskCounters> {
    text.lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.split_ascii_whitespace().collect();
            let num = |i: usize| f.get(i)?.parse::<u64>().ok();
            Some(DiskCounters {
                device: (*f.get(2)?).to_string(),
                read_bytes: num(5)?.saturating_mul(SECTOR),
                written_bytes: num(9)?.saturating_mul(SECTOR),
                io_ms: num(12)?,
            })
        })
        .collect()
}

/// A fixed whole disk backed by hardware (or a virtual disk the hypervisor
/// presents): it has a `device` link under `/sys/block` and is not removable.
/// Partitions are not in `/sys/block` at all; loop, ram, zram and
/// device-mapper nodes have no `device` link; optical drives are removable.
pub(crate) fn is_whole_disk(sys_block: &std::path::Path, device: &str) -> bool {
    let dir = sys_block.join(device);
    dir.join("device").exists()
        && std::fs::read_to_string(dir.join("removable")).map_or(true, |r| r.trim() != "1")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sectors_into_bytes() {
        let text = "   8       0 sda 100 0 2048 50 200 0 4096 80 0 120 130 0 0 0 0\n\
   8       1 sda1 90 0 2000 40 190 0 4000 70 0 110 110\n";
        let d = parse_diskstats(text);
        assert_eq!(d.len(), 2);
        assert_eq!(d[0].device, "sda");
        assert_eq!(d[0].read_bytes, 2048 * 512);
        assert_eq!(d[0].written_bytes, 4096 * 512);
        assert_eq!(d[0].io_ms, 120);
    }

    #[test]
    fn whole_disk_needs_a_device_link() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("sda/device")).unwrap();
        std::fs::create_dir_all(root.path().join("loop0")).unwrap();
        std::fs::create_dir_all(root.path().join("sr0/device")).unwrap();
        std::fs::write(root.path().join("sr0/removable"), "1\n").unwrap();
        assert!(is_whole_disk(root.path(), "sda"));
        assert!(!is_whole_disk(root.path(), "loop0"));
        assert!(!is_whole_disk(root.path(), "sda1"));
        assert!(!is_whole_disk(root.path(), "sr0"));
    }
}
