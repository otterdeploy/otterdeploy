//! Mounted local filesystems from `mountinfo`, sized with `statvfs`.

use std::path::Path;

/// Filesystem types backed by local block storage (or a ZFS pool). Network,
/// virtual and overlay filesystems are not host disks, and `statvfs` on a
/// hung network mount could block the collection round.
const LOCAL_TYPES: &[&str] = &[
    "ext2", "ext3", "ext4", "xfs", "btrfs", "zfs", "f2fs", "vfat", "exfat", "ntfs3", "jfs",
    "bcachefs",
];

/// Mount points whose filesystems are the product's own plumbing, not the
/// operator's disks (Docker's per-container bind mounts land under these).
const SKIP_PREFIXES: &[&str] = &["/var/lib/docker/", "/run/", "/snap/", "/proc/", "/sys/"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Mount {
    pub(crate) device: String,
    pub(crate) point: String,
    pub(crate) fs_type: String,
}

/// Local filesystems in `mountinfo`, one per device (the shortest mount
/// point wins, so bind mounts of the same filesystem are not counted twice),
/// sorted by mount point with `/` first.
pub(crate) fn parse_mountinfo(text: &str) -> Vec<Mount> {
    let mut by_device: std::collections::BTreeMap<String, Mount> =
        std::collections::BTreeMap::default();
    for line in text.lines() {
        let Some((left, right)) = line.split_once(" - ") else {
            continue;
        };
        let left: Vec<&str> = left.split(' ').collect();
        let (Some(device), Some(mount_point)) = (left.get(2), left.get(4)) else {
            continue;
        };
        let Some(fs_type) = right.split(' ').next() else {
            continue;
        };
        let mount_point = unescape(mount_point);
        if !LOCAL_TYPES.contains(&fs_type)
            || SKIP_PREFIXES
                .iter()
                .any(|p| mount_point.starts_with(p) || mount_point == p.trim_end_matches('/'))
        {
            continue;
        }
        let candidate = Mount {
            device: (*device).to_string(),
            point: mount_point,
            fs_type: fs_type.to_string(),
        };
        match by_device.get(&candidate.device) {
            Some(existing) if existing.point.len() <= candidate.point.len() => {}
            _ => {
                by_device.insert(candidate.device.clone(), candidate);
            }
        }
    }
    let mut mounts: Vec<Mount> = by_device.into_values().collect();
    mounts.sort_by(|a, b| (a.point != "/", &a.point).cmp(&(b.point != "/", &b.point)));
    mounts
}

/// `mountinfo` escapes space, tab, newline and backslash as octal (`\040`).
fn unescape(field: &str) -> String {
    let mut out = Vec::with_capacity(field.len());
    let mut rest = field.as_bytes();
    while let Some((&first, tail)) = rest.split_first() {
        let octal = tail
            .get(..3)
            .filter(|_| first == b'\\')
            .and_then(|o| std::str::from_utf8(o).ok())
            .and_then(|o| u8::from_str_radix(o, 8).ok());
        if let (Some(byte), Some(after)) = (octal, tail.get(3..)) {
            out.push(byte);
            rest = after;
        } else {
            out.push(first);
            rest = tail;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Total, used and available bytes of the filesystem at `path`.
pub(crate) fn usage(path: &Path) -> Option<(u64, u64, u64)> {
    let st = rustix::fs::statvfs(path).ok()?;
    let frsize = st.f_frsize;
    let total = st.f_blocks.checked_mul(frsize)?;
    let used = st.f_blocks.saturating_sub(st.f_bfree).checked_mul(frsize)?;
    let available = st.f_bavail.checked_mul(frsize)?;
    Some((total, used, available))
}

#[cfg(test)]
mod tests {
    use super::*;

    const MOUNTINFO: &str = "\
22 1 8:1 / / rw,relatime shared:1 - ext4 /dev/sda1 rw
23 22 0:21 / /proc rw - proc proc rw
24 22 0:5 / /dev rw - devtmpfs udev rw
25 22 8:16 / /mnt/data rw - xfs /dev/sdb rw
26 22 8:16 /sub /srv/bind rw - xfs /dev/sdb rw
27 22 0:50 / /var/lib/docker/overlay2/abc/merged rw - overlay overlay rw
28 22 0:51 / /run rw - tmpfs tmpfs rw
29 22 0:60 / /tank rw - zfs tank rw
30 22 0:61 / /tank/my\\040data rw - zfs tank/my data rw
31 22 0:70 / /mnt/nfs rw - nfs4 server:/x rw
32 22 8:2 / /var/lib/docker/volumes/v/_data rw - ext4 /dev/sda2 rw
";

    #[test]
    fn keeps_local_filesystems_once_per_device_root_first() {
        let m = parse_mountinfo(MOUNTINFO);
        let points: Vec<&str> = m.iter().map(|m| m.point.as_str()).collect();
        assert_eq!(points, ["/", "/mnt/data", "/tank", "/tank/my data"]);
        assert_eq!(m[1].fs_type, "xfs");
    }

    #[test]
    fn statvfs_of_the_temp_dir_is_consistent() {
        let dir = tempfile::tempdir().unwrap();
        let (total, used, avail) = usage(dir.path()).unwrap();
        assert!(total > 0);
        assert!(used <= total);
        assert!(avail <= total);
    }
}
