//! `otterd-guard`: run by systemd before every otterd start
//! (`ExecStartPre=`). It spends one start of a pending update's budget, and
//! rolls back to the previous slot once the budget is gone. It never fails the
//! start: a broken guard must not keep the node down.

use otterd_update::{GuardAction, Layout};
use std::process::ExitCode;

fn main() -> ExitCode {
    let root = std::env::var("OTTERD_UPDATE_ROOT").unwrap_or_else(|_| "/usr/lib/otterd".into());
    let layout = Layout::new(&root);
    match layout.guard(otterd_proto::version::JOURNAL_FORMAT) {
        Ok(GuardAction::Nothing) => {}
        Ok(action) => println!("{}", serde_json::to_string(&action).unwrap_or_default()),
        Err(e) => eprintln!("otterd-guard: {e}"),
    }
    ExitCode::SUCCESS
}
