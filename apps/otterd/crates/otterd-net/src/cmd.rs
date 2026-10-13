//! Bounded external commands (`nft`, `iptables`, `ip`, `wg`, `systemctl`, `conntrack`).
//!
//! Every call has a timeout and a captured result. Components take a
//! [`Runner`] so their decision logic is testable with a scripted fake.

use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

/// Default bound for one command.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(10);

/// What a finished command produced.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Output {
    /// Exit code; `None` if killed by a signal.
    pub code: Option<i32>,
    /// Standard output.
    pub stdout: String,
    /// Standard error.
    pub stderr: String,
}

impl Output {
    /// Exit code 0.
    #[must_use]
    pub fn success(&self) -> bool {
        self.code == Some(0)
    }
}

/// A command that could not run to completion.
#[derive(Debug, thiserror::Error)]
pub enum CmdError {
    /// The program could not be started.
    #[error("{program}: could not start: {source}")]
    Spawn {
        /// Program.
        program: String,
        /// Cause.
        #[source]
        source: std::io::Error,
    },
    /// The program ran past its bound and was killed.
    #[error("{program}: timed out after {after:?}")]
    Timeout {
        /// Program.
        program: String,
        /// Bound.
        after: Duration,
    },
    /// The program exited non-zero.
    #[error("{program} {args}: exit {code:?}: {stderr}")]
    Failed {
        /// Program.
        program: String,
        /// Arguments, space-joined.
        args: String,
        /// Exit code.
        code: Option<i32>,
        /// Trimmed stderr.
        stderr: String,
    },
}

/// Runs external programs.
pub trait Runner: Send + Sync {
    /// Runs `program args…`, feeding `stdin` if given, bounded by `timeout`.
    ///
    /// # Errors
    /// [`CmdError::Spawn`] or [`CmdError::Timeout`]. A non-zero exit is an `Ok` [`Output`].
    fn run(
        &self,
        program: &str,
        args: &[&str],
        stdin: Option<&str>,
        timeout: Duration,
    ) -> Result<Output, CmdError>;

    /// Like [`Runner::run`] with the default timeout, turning a non-zero exit into an error.
    ///
    /// # Errors
    /// Any [`CmdError`].
    fn ok(&self, program: &str, args: &[&str], stdin: Option<&str>) -> Result<Output, CmdError> {
        let out = self.run(program, args, stdin, DEFAULT_TIMEOUT)?;
        if out.success() {
            Ok(out)
        } else {
            Err(CmdError::Failed {
                program: program.to_owned(),
                args: args.join(" "),
                code: out.code,
                stderr: out.stderr.trim().chars().take(600).collect(),
            })
        }
    }
}

/// Runs real processes.
#[derive(Debug, Clone, Copy, Default)]
pub struct System;

impl Runner for System {
    fn run(
        &self,
        program: &str,
        args: &[&str],
        stdin: Option<&str>,
        timeout: Duration,
    ) -> Result<Output, CmdError> {
        let mut child = Command::new(program)
            .args(args)
            // Children must not speak for this service to systemd.
            .env_remove("NOTIFY_SOCKET")
            .stdin(if stdin.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|source| CmdError::Spawn {
                program: program.to_owned(),
                source,
            })?;
        if let (Some(text), Some(mut pipe)) = (stdin, child.stdin.take()) {
            let text = text.to_owned();
            // A writer thread so a program that stops reading cannot block the timeout.
            thread::spawn(move || {
                let _ = pipe.write_all(text.as_bytes());
            });
        }
        let mut out_pipe = child.stdout.take();
        let mut err_pipe = child.stderr.take();
        let (tx, rx) = mpsc::channel();
        // Both pipes drain concurrently so a chatty stderr cannot stall stdout.
        let err_reader = thread::spawn(move || {
            let mut err = String::new();
            if let Some(p) = err_pipe.as_mut() {
                let _ = p.read_to_string(&mut err);
            }
            err
        });
        let reader = thread::spawn(move || {
            let mut out = String::new();
            if let Some(p) = out_pipe.as_mut() {
                let _ = p.read_to_string(&mut out);
            }
            let err = err_reader.join().unwrap_or_default();
            let _ = tx.send((out, err));
        });
        if let Ok((stdout, stderr)) = rx.recv_timeout(timeout) {
            let status = child.wait().map_err(|source| CmdError::Spawn {
                program: program.to_owned(),
                source,
            })?;
            let _ = reader.join();
            Ok(Output {
                code: status.code(),
                stdout,
                stderr,
            })
        } else {
            let _ = child.kill();
            let _ = child.wait();
            Err(CmdError::Timeout {
                program: program.to_owned(),
                after: timeout,
            })
        }
    }
}

#[cfg(test)]
pub(crate) mod fake {
    //! A scripted runner for decision-logic tests.
    use super::{CmdError, Output, Runner};
    use std::sync::Mutex;
    use std::time::Duration;

    type Responder = Box<dyn Fn(&str, &[&str], Option<&str>) -> Option<Output> + Send + Sync>;

    /// Records every call; answers from the first matching responder, else exit 0 with no output.
    pub(crate) struct Fake {
        pub(crate) calls: Mutex<Vec<String>>,
        responders: Vec<Responder>,
    }

    impl std::fmt::Debug for Fake {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.debug_struct("Fake").finish_non_exhaustive()
        }
    }

    impl Fake {
        pub(crate) fn new() -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                responders: Vec::new(),
            }
        }

        /// Answers calls whose `program args` line starts with `prefix`.
        pub(crate) fn on(mut self, prefix: &'static str, code: i32, stdout: &'static str) -> Self {
            self.responders.push(Box::new(move |p, a, _| {
                let line = format!("{p} {}", a.join(" "));
                line.starts_with(prefix).then(|| Output {
                    code: Some(code),
                    stdout: stdout.to_owned(),
                    stderr: String::new(),
                })
            }));
            self
        }

        pub(crate) fn lines(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl Runner for Fake {
        fn run(
            &self,
            program: &str,
            args: &[&str],
            stdin: Option<&str>,
            _t: Duration,
        ) -> Result<Output, CmdError> {
            let mut line = format!("{program} {}", args.join(" "));
            if let Some(s) = stdin {
                line.push_str(" <<");
                line.push_str(s);
            }
            self.calls.lock().unwrap().push(line);
            Ok(self
                .responders
                .iter()
                .find_map(|r| r(program, args, stdin))
                .unwrap_or(Output {
                    code: Some(0),
                    ..Output::default()
                }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_runner_captures_and_times_out() {
        let out = System
            .run(
                "sh",
                &["-c", "cat; echo err >&2; exit 3"],
                Some("hi"),
                DEFAULT_TIMEOUT,
            )
            .unwrap();
        assert_eq!(
            (out.code, out.stdout.as_str(), out.stderr.as_str()),
            (Some(3), "hi", "err\n")
        );
        let err = System
            .run("sleep", &["5"], None, Duration::from_millis(100))
            .unwrap_err();
        assert!(matches!(err, CmdError::Timeout { .. }));
        assert!(matches!(
            System.ok("false", &[], None),
            Err(CmdError::Failed { .. })
        ));
    }
}
