//! Retained-mount staging on a real kernel. Needs root (mounts) and, for the
//! last test, Docker. Ignored by default; run on a Linux host:
//!
//! ```sh
//! sudo cargo test -p otterd-sys --test staging_root -- --ignored --test-threads=1
//! ```
#![cfg(target_os = "linux")]
#![allow(clippy::unwrap_used, clippy::panic, clippy::indexing_slicing)]

use otterd_sys::host::shares_mount_namespace;
use otterd_sys::staging::{
    RetainedSource, StageObservation, ensure_private_root, observe_stage, staging_path_for, unstage,
};
use std::path::{Path, PathBuf};
use std::process::Command;

struct Scratch {
    dir: tempfile::TempDir,
    root: PathBuf,
}

impl Scratch {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("stage-root");
        Self { dir, root }
    }

    fn source(&self, name: &str, marker: &str) -> PathBuf {
        let p = self.dir.path().join(name);
        std::fs::create_dir_all(&p).unwrap();
        std::fs::write(p.join("marker"), marker).unwrap();
        p
    }
}

fn mountinfo_line(path: &Path) -> Option<String> {
    let want = path.display().to_string();
    std::fs::read_to_string("/proc/self/mountinfo")
        .unwrap()
        .lines()
        .find(|l| l.split(' ').nth(4) == Some(want.as_str()))
        .map(str::to_owned)
}

fn run(cmd: &mut Command) {
    let out = cmd.output().unwrap();
    assert!(
        out.status.success(),
        "{cmd:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
#[ignore = "needs root on Linux"]
fn symlinks_and_mount_crossings_are_refused() {
    let s = Scratch::new();
    let real = s.source("real", "x");
    let link = s.dir.path().join("link");
    std::os::unix::fs::symlink(&real, &link).unwrap();
    let err = RetainedSource::open(&link).unwrap_err().to_string();
    assert!(err.contains("symlink"), "{err}");
    let err = RetainedSource::open(&link.join("sub"))
        .unwrap_err()
        .to_string();
    assert!(err.contains("symlink"), "{err}");
    let mnt = s.dir.path().join("mnt");
    std::fs::create_dir(&mnt).unwrap();
    run(Command::new("mount")
        .args(["-t", "tmpfs", "tmpfs"])
        .arg(&mnt));
    std::fs::create_dir(mnt.join("inner")).unwrap();
    let err = RetainedSource::open(&mnt.join("inner"))
        .unwrap_err()
        .to_string();
    assert!(err.contains("crosses a mount"), "{err}");
    run(Command::new("umount").arg(&mnt));
    assert!(RetainedSource::open(Path::new("relative")).is_err());
}

#[test]
#[ignore = "needs root on Linux"]
fn a_stage_keeps_the_held_object_through_rename_and_symlink_retarget() {
    let s = Scratch::new();
    let src = s.source("data", "ORIGINAL");
    let held = RetainedSource::open(&src).unwrap();
    let stage = staging_path_for(&s.root, "hold_1");
    let id = held.stage(&s.root, &stage).unwrap();
    assert!(id.same_object(&held.identity()));
    assert_eq!(
        std::fs::read_to_string(stage.join("marker")).unwrap(),
        "ORIGINAL"
    );

    // The tenant renames the directory and puts a new one in its place...
    std::fs::rename(&src, s.dir.path().join("moved")).unwrap();
    s.source("data", "RETARGETED");
    assert_eq!(
        std::fs::read_to_string(stage.join("marker")).unwrap(),
        "ORIGINAL"
    );
    // ...then replaces the path with a symlink to /etc.
    std::fs::remove_dir_all(&src).unwrap();
    std::os::unix::fs::symlink("/etc", &src).unwrap();
    assert_eq!(
        std::fs::read_to_string(stage.join("marker")).unwrap(),
        "ORIGINAL"
    );
    assert!(matches!(
        observe_stage(&stage, &held.identity()).unwrap(),
        StageObservation::Present { .. }
    ));

    // The staging root is private, root-only, and paths are never reused.
    let info = mountinfo_line(&s.root).expect("staging root is a mount");
    assert!(
        !info.contains("shared:"),
        "staging root must be private: {info}"
    );
    let again = RetainedSource::open(&s.dir.path().join("moved")).unwrap();
    let err = again.stage(&s.root, &stage).unwrap_err().to_string();
    assert!(err.contains("already exists"), "{err}");
    assert!(
        again
            .stage(&s.root, &s.dir.path().join("elsewhere"))
            .is_err()
    );

    unstage(&stage).unwrap();
    assert_eq!(
        observe_stage(&stage, &held.identity()).unwrap(),
        StageObservation::Missing
    );
    unstage(&stage).unwrap();
    run(Command::new("umount").arg(&s.root));
}

#[test]
#[ignore = "needs root on Linux"]
fn something_else_at_the_stage_is_a_mismatch_and_a_plain_dir_is_missing() {
    let s = Scratch::new();
    let a = RetainedSource::open(&s.source("a", "A")).unwrap();
    let b = s.source("b", "B");
    ensure_private_root(&s.root).unwrap();
    let stage = staging_path_for(&s.root, "hold_2");
    std::fs::create_dir(&stage).unwrap();
    assert_eq!(
        observe_stage(&stage, &a.identity()).unwrap(),
        StageObservation::Missing
    );
    run(Command::new("mount").arg("--bind").arg(&b).arg(&stage));
    assert!(matches!(
        observe_stage(&stage, &a.identity()).unwrap(),
        StageObservation::Mismatch { .. }
    ));
    unstage(&stage).unwrap();
    run(Command::new("umount").arg(&s.root));
}

#[test]
#[ignore = "needs root on Linux"]
fn mount_namespace_check() {
    assert!(shares_mount_namespace(std::process::id()).unwrap());
    assert!(
        shares_mount_namespace(1).unwrap(),
        "a host process shares pid 1's namespace"
    );
    let mut child = Command::new("unshare")
        .args(["-m", "sleep", "5"])
        .spawn()
        .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(300));
    assert!(!shares_mount_namespace(child.id()).unwrap());
    child.kill().unwrap();
    child.wait().unwrap();
}

#[test]
#[ignore = "needs root and Docker on Linux"]
fn docker_binds_the_stage_not_the_retargeted_path() {
    let s = Scratch::new();
    let src = s.source("bind", "ORIGINAL");
    let held = RetainedSource::open(&src).unwrap();
    let stage = staging_path_for(&s.root, "hold_3");
    held.stage(&s.root, &stage).unwrap();
    let name = format!("otterd-stage-test-{}", std::process::id());
    run(Command::new("docker")
        .args(["create", "--name", &name, "-v"])
        .arg(format!("{}:/data:ro", stage.display()))
        .args(["busybox:1.36", "cat", "/data/marker"]));
    // Retarget between create and start, exactly when Docker resolves binds:
    // move the held directory away and put a symlink to /etc at its path.
    std::fs::rename(&src, s.dir.path().join("bind-moved")).unwrap();
    std::os::unix::fs::symlink("/etc", &src).unwrap();
    let out = Command::new("docker")
        .args(["start", "-a", &name])
        .output()
        .unwrap();
    let _ = Command::new("docker").args(["rm", "-f", &name]).output();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(String::from_utf8_lossy(&out.stdout), "ORIGINAL");
    unstage(&stage).unwrap();
    run(Command::new("umount").arg(&s.root));
}

#[test]
#[ignore = "needs root and Docker on Linux"]
fn control_docker_follows_a_retargeted_plain_bind() {
    // Without staging, Docker resolves the path at start: the retarget wins.
    let s = Scratch::new();
    let src = s.source("plain", "ORIGINAL");
    let name = format!("otterd-plain-test-{}", std::process::id());
    run(Command::new("docker")
        .args(["create", "--name", &name, "-v"])
        .arg(format!("{}:/data:ro", src.display()))
        .args(["busybox:1.36", "cat", "/data/hostname"]));
    std::fs::remove_dir_all(&src).unwrap();
    std::os::unix::fs::symlink("/etc", &src).unwrap();
    let out = Command::new("docker")
        .args(["start", "-a", &name])
        .output()
        .unwrap();
    let _ = Command::new("docker").args(["rm", "-f", &name]).output();
    let host = std::fs::read_to_string("/etc/hostname").unwrap();
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        host,
        "the plain bind followed the symlink"
    );
}
