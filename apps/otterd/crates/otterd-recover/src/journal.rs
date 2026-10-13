//! Read-only journal inspection.

use crate::RecoverError;
use otterd_journal::Journal;
use serde_json::{Value, json};
use std::path::Path;

/// The full folded state.
pub fn show(path: &Path) -> Result<Value, RecoverError> {
    let (state, _) = Journal::read_snapshot(path)?;
    Ok(serde_json::to_value(&state)?)
}

/// Only what blocks recovery or a start: unresolved Engine submissions,
/// unreleased grants, open or unknown holds, and the revocation bound.
pub fn obligations(path: &Path) -> Result<Value, RecoverError> {
    let (state, report) = Journal::read_snapshot(path)?;
    let unresolved: Vec<_> = state.unresolved_submissions().collect();
    let grants: Vec<_> = state.grants.values().filter(|g| !g.is_released()).collect();
    let holds: Vec<_> = state.open_holds().collect();
    Ok(json!({
        "entries": report.entries,
        "tornTailBytes": report.truncated_torn_tail_bytes,
        "identity": state.identity,
        "unresolvedSubmissions": unresolved,
        "unreleasedGrants": grants,
        "openHolds": holds,
        "revokedBelowTerm": state.revoked_below_term(),
    }))
}
