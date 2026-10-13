//! Pulls against an in-process mock Engine that streams its progress: an
//! error inside a `200` stream fails the pull, and a stream that never ends
//! is cut at the pull's own timeout.
#![allow(
    clippy::unwrap_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::unused_async,
    clippy::needless_pass_by_value
)]

use bytes::Bytes;
use http::{Request, Response, StatusCode};
use hyper::body::{Body, Frame, Incoming};
use hyper_util::rt::TokioIo;
use otterd_engine::{DockerClient, PullError, TransportError};
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};
use tokio::net::UnixListener;
use tokio::sync::mpsc;

/// A response body fed chunk by chunk; it ends when the sender is dropped.
struct Streamed(mpsc::Receiver<Bytes>);

impl Body for Streamed {
    type Data = Bytes;
    type Error = std::convert::Infallible;

    fn poll_frame(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, Self::Error>>> {
        self.0.poll_recv(cx).map(|c| c.map(|b| Ok(Frame::data(b))))
    }
}

/// Answer every request `200` and stream `lines`, one chunk each; when
/// `hang`, keep the stream open afterwards.
fn mock(
    socket: PathBuf,
    lines: &'static [&'static str],
    hang: bool,
    seen: Arc<Mutex<Vec<String>>>,
) {
    let listener = UnixListener::bind(&socket).unwrap();
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let seen = Arc::clone(&seen);
            tokio::spawn(async move {
                let service = hyper::service::service_fn(move |req: Request<Incoming>| {
                    seen.lock().unwrap().push(req.uri().to_string());
                    let (tx, rx) = mpsc::channel(8);
                    tokio::spawn(async move {
                        for l in lines {
                            if tx.send(Bytes::from_static(l.as_bytes())).await.is_err() {
                                return;
                            }
                            tokio::time::sleep(Duration::from_millis(20)).await;
                        }
                        if hang {
                            tokio::time::sleep(Duration::from_secs(3600)).await;
                            drop(tx);
                        }
                    });
                    async move {
                        Ok::<_, std::convert::Infallible>(
                            Response::builder()
                                .status(StatusCode::OK)
                                .body(Streamed(rx))
                                .unwrap(),
                        )
                    }
                });
                let _ = hyper::server::conn::http1::Builder::new()
                    .serve_connection(TokioIo::new(stream), service)
                    .await;
            });
        }
    });
}

async fn client(
    lines: &'static [&'static str],
    hang: bool,
) -> (tempfile::TempDir, DockerClient, Arc<Mutex<Vec<String>>>) {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("docker.sock");
    let seen = Arc::new(Mutex::new(Vec::new()));
    mock(socket.clone(), lines, hang, Arc::clone(&seen));
    (dir, DockerClient::new(socket, Duration::from_secs(5)), seen)
}

#[tokio::test]
async fn an_error_inside_a_200_stream_fails_the_pull() {
    let (_dir, docker, seen) = client(
        &[
            "{\"status\":\"Pulling from library/busybox\",\"id\":\"1.37\"}\r\n",
            "{\"status\":\"Downloading\",\"progressDetail\":{\"current\":1,\"total\":2},\"id\":\"a\"}\r\n",
            "{\"errorDetail\":{\"message\":\"unexpected EOF\"},\"error\":\"unexpected EOF\"}\r\n",
        ],
        false,
    )
    .await;
    let e = docker.pull_image("busybox", "1.37").await.unwrap_err();
    assert!(
        matches!(&e, PullError::Stream(m) if m == "unexpected EOF"),
        "{e:?}"
    );
    assert_eq!(
        seen.lock().unwrap()[0],
        "/images/create?fromImage=busybox&tag=1.37"
    );
}

#[tokio::test]
async fn a_clean_stream_is_a_pull() {
    let (_dir, docker, _) = client(
        &[
            "{\"status\":\"Pulling from library/busybox\",\"id\":\"1.37\"}\r\n",
            "{\"status\":\"Digest: sha256:9ae97d36d26566ff84e8893c64a6dc4fe8ca6d1144bf5b87b2b85a32def253c7\"}\r\n",
            "{\"status\":\"Status: Downloaded newer image for busybox:1.37\"}\r\n",
        ],
        false,
    )
    .await;
    let r = docker.pull_image("busybox", "1.37").await.unwrap();
    assert_eq!(
        r.digest.as_deref(),
        Some("sha256:9ae97d36d26566ff84e8893c64a6dc4fe8ca6d1144bf5b87b2b85a32def253c7")
    );
}

#[tokio::test]
async fn a_stream_that_never_ends_is_cut_at_the_pull_timeout() {
    let (_dir, docker, _) = client(
        &["{\"status\":\"Pulling from library/busybox\",\"id\":\"1.37\"}\r\n"],
        true,
    )
    .await;
    let began = Instant::now();
    let e = docker
        .with_timeout(Duration::from_millis(300))
        .pull_image("busybox", "1.37")
        .await
        .unwrap_err();
    assert!(
        matches!(e, PullError::Transport(TransportError::Timeout(_))),
        "{e:?}"
    );
    assert!(began.elapsed() < Duration::from_secs(3));
}
