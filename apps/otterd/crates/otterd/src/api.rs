//! The root-only local control socket (`/run/otterd/otterd.sock`, mode 0600).
//!
//! It works with the control plane down and the Engine hung: `GET /status`
//! reads only the journal and in-memory state, and `POST /authority/revoke`
//! applies a recovery-key-signed revocation. Workload commands never come
//! through here; they need a control-plane capability on an authenticated
//! session.

use crate::lifecycle::{Node, NodeError};
use bytes::Bytes;
use http::{Method, Request, Response, StatusCode};
use http_body_util::{BodyExt as _, Full, Limited};
use hyper::body::Incoming;
use hyper_util::rt::TokioIo;
use otterd_proto::envelope::SignedEnvelope;
use std::os::unix::fs::PermissionsExt as _;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use tokio::net::UnixListener;

const MAX_BODY: usize = 256 * 1024;

fn json(status: StatusCode, v: &serde_json::Value) -> Response<Full<Bytes>> {
    let mut r = Response::new(Full::new(Bytes::from(v.to_string())));
    *r.status_mut() = status;
    r
}

/// The status document.
pub fn status(node: &Node) -> Result<serde_json::Value, NodeError> {
    let state = node.engine.journal().snapshot()?;
    let gate = node
        .gate
        .lock()
        .map(|g| g.clone())
        .map_err(|_| NodeError::Internal("gate poisoned".into()))?;
    let unresolved: Vec<_> = state
        .unresolved_submissions()
        .map(|m| serde_json::json!({"mutation": m.record.mutation_id, "verb": m.record.verb, "object": m.record.object_name, "slot": m.record.slot.to_string()}))
        .collect();
    Ok(serde_json::json!({
        "identity": state.identity,
        "incarnation": node.incarnation,
        "bootId": node.engine.boot_id(),
        "engineReachable": node.engine_reachable.load(Ordering::SeqCst),
        "progress": node.progress.snapshot(),
        "tenantGate": gate,
        "revokedBelowTerm": state.revoked_below_term(),
        "slots": node.slot_reports()?,
        "unresolvedStarts": unresolved,
        "openHolds": state.open_holds().collect::<Vec<_>>(),
    }))
}

async fn route(node: Arc<Node>, req: Request<Incoming>) -> Response<Full<Bytes>> {
    match (req.method().clone(), req.uri().path()) {
        (Method::GET, "/status") => match status(&node) {
            Ok(v) => json(StatusCode::OK, &v),
            Err(e) => json(
                StatusCode::INTERNAL_SERVER_ERROR,
                &serde_json::json!({"error": e.to_string()}),
            ),
        },
        (Method::POST, "/authority/revoke") => {
            let body = match Limited::new(req.into_body(), MAX_BODY).collect().await {
                Ok(b) => b.to_bytes(),
                Err(e) => {
                    return json(
                        StatusCode::BAD_REQUEST,
                        &serde_json::json!({"error": e.to_string()}),
                    );
                }
            };
            let env: SignedEnvelope = match serde_json::from_slice(&body) {
                Ok(e) => e,
                Err(e) => {
                    return json(
                        StatusCode::BAD_REQUEST,
                        &serde_json::json!({"error": e.to_string()}),
                    );
                }
            };
            match node.revoke_authority(&env).await {
                Ok(below) => json(
                    StatusCode::OK,
                    &serde_json::json!({"revokedBelowTerm": below}),
                ),
                Err(NodeError::Unauthorized(m)) => {
                    json(StatusCode::UNAUTHORIZED, &serde_json::json!({"error": m}))
                }
                Err(e) => json(
                    StatusCode::CONFLICT,
                    &serde_json::json!({"error": e.to_string()}),
                ),
            }
        }
        _ => json(
            StatusCode::NOT_FOUND,
            &serde_json::json!({"error": "not found"}),
        ),
    }
}

/// Serve the control socket until the task is dropped.
pub async fn serve(node: Arc<Node>, socket: &Path) -> std::io::Result<()> {
    if let Some(dir) = socket.parent() {
        std::fs::create_dir_all(dir)?;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    if socket.exists() {
        std::fs::remove_file(socket)?;
    }
    let listener = UnixListener::bind(socket)?;
    std::fs::set_permissions(socket, std::fs::Permissions::from_mode(0o600))?;
    loop {
        let (stream, _) = listener.accept().await?;
        let node = Arc::clone(&node);
        tokio::spawn(async move {
            let svc = hyper::service::service_fn(move |req| {
                let node = Arc::clone(&node);
                async move { Ok::<_, std::convert::Infallible>(route(node, req).await) }
            });
            if let Err(e) = hyper::server::conn::http1::Builder::new()
                .serve_connection(TokioIo::new(stream), svc)
                .await
            {
                tracing::debug!(error = %e, "control socket connection ended");
            }
        });
    }
}
