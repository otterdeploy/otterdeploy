//! Image presence and pulls.
//!
//! A pull is answered `200` as soon as the Engine starts it, and the body then
//! streams one JSON object per line. A failure can arrive inside that `200`
//! stream as `{"error": …}` or `{"errorDetail": {"message": …}}`, so the
//! stream is read to its end and every line is checked. A pull starts no
//! process: it is not a journalled mutation.

use crate::docker::TransportError;
use serde::Deserialize;

/// Longest single progress line accepted.
pub const MAX_PULL_LINE_BYTES: usize = 64 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum PullError {
    #[error(transparent)]
    Transport(#[from] TransportError),
    #[error("the Engine refused the pull ({status}): {message}")]
    Refused { status: u16, message: String },
    #[error("{0}")]
    Stream(String),
    #[error("unreadable pull progress: {0}")]
    Malformed(String),
    #[error("invalid image reference {0:?}")]
    InvalidReference(String),
}

/// What a finished pull stream said.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PullReport {
    /// The `Digest: sha256:…` the Engine announced, if it did.
    pub digest: Option<String>,
    /// The last status line, e.g. `Status: Downloaded newer image for …`.
    pub status: Option<String>,
}

/// Folds a pull's progress stream, fed in arbitrary chunks.
#[derive(Debug, Default)]
pub struct PullProgress {
    pending: Vec<u8>,
    report: PullReport,
}

impl PullProgress {
    /// Consume one chunk; every complete line is checked as it arrives.
    pub fn feed(&mut self, chunk: &[u8]) -> Result<(), PullError> {
        self.pending.extend_from_slice(chunk);
        while let Some(end) = self.pending.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = self.pending.drain(..=end).collect();
            self.line(&line)?;
        }
        if self.pending.len() > MAX_PULL_LINE_BYTES {
            return Err(PullError::Malformed(format!(
                "a progress line exceeds {MAX_PULL_LINE_BYTES} bytes"
            )));
        }
        Ok(())
    }

    /// The stream ended: check what is left and return the report.
    pub fn finish(mut self) -> Result<PullReport, PullError> {
        let rest = std::mem::take(&mut self.pending);
        self.line(&rest)?;
        Ok(self.report)
    }

    fn line(&mut self, line: &[u8]) -> Result<(), PullError> {
        #[derive(Deserialize)]
        struct Detail {
            #[serde(default)]
            message: Option<String>,
        }
        #[derive(Deserialize)]
        struct Line {
            #[serde(default)]
            status: Option<String>,
            #[serde(default)]
            error: Option<String>,
            #[serde(default, rename = "errorDetail")]
            error_detail: Option<Detail>,
        }
        let text = line.trim_ascii();
        if text.is_empty() {
            return Ok(());
        }
        let l: Line = serde_json::from_slice(text).map_err(|e| {
            PullError::Malformed(format!(
                "{e}: {}",
                String::from_utf8_lossy(text)
                    .chars()
                    .take(200)
                    .collect::<String>()
            ))
        })?;
        if l.error.is_some() || l.error_detail.is_some() {
            let message = l
                .error_detail
                .and_then(|d| d.message)
                .filter(|m| !m.is_empty())
                .or(l.error)
                .unwrap_or_else(|| "the Engine reported an error without a message".into());
            return Err(PullError::Stream(message));
        }
        if let Some(status) = l.status {
            if let Some(d) = status.strip_prefix("Digest: ") {
                self.report.digest = Some(d.trim().to_owned());
            }
            self.report.status = Some(status);
        }
        Ok(())
    }
}

/// A local image, as `GET /images/{name}/json` describes it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ImageView {
    pub id: String,
    pub repo_digests: Vec<String>,
}

impl ImageView {
    #[must_use]
    pub fn from_inspect(v: &serde_json::Value) -> Self {
        Self {
            id: v
                .get("Id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            repo_digests: v
                .get("RepoDigests")
                .and_then(serde_json::Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(serde_json::Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default(),
        }
    }

    /// Whether this image is the content `digest` (`sha256:…`) names: its
    /// own id, or a repository digest it was pulled by.
    #[must_use]
    pub fn has_digest(&self, digest: &str) -> bool {
        self.id == digest
            || self
                .repo_digests
                .iter()
                .any(|d| d.rsplit_once('@').is_some_and(|(_, d)| d == digest))
    }
}

/// An image reference safe to put in a request path: Docker's reference
/// charset only.
pub(crate) fn checked_reference(reference: &str) -> Result<&str, PullError> {
    let ok = !reference.is_empty()
        && reference.len() <= 512
        && !reference.starts_with(['/', '.', '-'])
        && !reference.contains("..")
        && reference.bytes().all(|b| {
            b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b'/' | b':' | b'@')
        });
    if ok {
        Ok(reference)
    } else {
        Err(PullError::InvalidReference(reference.to_owned()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(chunks: &[&str]) -> Result<PullReport, PullError> {
        let mut p = PullProgress::default();
        for c in chunks {
            p.feed(c.as_bytes())?;
        }
        p.finish()
    }

    const DIGEST: &str = "sha256:9ae97d36d26566ff84e8893c64a6dc4fe8ca6d1144bf5b87b2b85a32def253c7";

    #[test]
    fn a_clean_stream_reports_its_digest() {
        let r = run(&[
            "{\"status\":\"Pulling from library/busybox\",\"id\":\"1.37\"}\r\n",
            "{\"status\":\"Pull complete\",\"progressDetail\":{},\"id\":\"a\"}\r\n{\"status\":\"Dig",
            "est: sha256:9ae97d36d26566ff84e8893c64a6dc4fe8ca6d1144bf5b87b2b85a32def253c7\"}\r\n",
            "{\"status\":\"Status: Downloaded newer image for busybox:1.37\"}",
        ])
        .unwrap();
        assert_eq!(r.digest.as_deref(), Some(DIGEST));
        assert_eq!(
            r.status.as_deref(),
            Some("Status: Downloaded newer image for busybox:1.37")
        );
    }

    #[test]
    fn an_error_inside_a_200_stream_is_a_failure() {
        let e = run(&[
            "{\"status\":\"Pulling from library/busybox\",\"id\":\"nope\"}\n",
            "{\"errorDetail\":{\"message\":\"manifest for busybox:nope not found: manifest unknown\"},\"error\":\"manifest for busybox:nope not found: manifest unknown\"}\n",
        ])
        .unwrap_err();
        assert!(
            matches!(&e, PullError::Stream(m) if m.contains("manifest unknown")),
            "{e:?}"
        );
        // The bare `error` field alone, and an error on the unterminated last line.
        let e =
            run(&["{\"status\":\"x\"}\n{\"error\":\"toomanyrequests: rate limit\"}"]).unwrap_err();
        assert!(
            matches!(&e, PullError::Stream(m) if m.contains("toomanyrequests")),
            "{e:?}"
        );
        // A detail without a message still fails.
        assert!(matches!(
            run(&["{\"errorDetail\":{}}\n"]),
            Err(PullError::Stream(_))
        ));
    }

    #[test]
    fn unreadable_progress_is_a_failure_not_a_success() {
        assert!(matches!(
            run(&["{\"status\":\"ok\"}\nnot json\n"]),
            Err(PullError::Malformed(_))
        ));
        let mut p = PullProgress::default();
        let long = vec![b'a'; MAX_PULL_LINE_BYTES + 1];
        assert!(matches!(p.feed(&long), Err(PullError::Malformed(_))));
    }

    #[test]
    fn digests_match_by_id_or_repo_digest() {
        let v = ImageView::from_inspect(&serde_json::json!({
            "Id": "sha256:aaaa",
            "RepoDigests": [format!("busybox@{DIGEST}")]
        }));
        assert!(v.has_digest(DIGEST));
        assert!(v.has_digest("sha256:aaaa"));
        assert!(!v.has_digest("sha256:bbbb"));
        assert!(!ImageView::default().has_digest(DIGEST));
    }

    #[test]
    fn references_in_paths_are_checked() {
        for ok in [
            "busybox:1.37",
            "registry:5000/acme/web@sha256:abc",
            "ghcr.io/acme/web_x-y:1.2",
        ] {
            assert!(checked_reference(ok).is_ok(), "{ok}");
        }
        for bad in ["", "a b", "../etc", "x?y=1", "x#y", "/abs", "a%2Fb"] {
            assert!(checked_reference(bad).is_err(), "{bad}");
        }
    }
}
