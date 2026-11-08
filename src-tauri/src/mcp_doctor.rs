//! mcp_doctor.rs — the 協働 panel's 接続テスト (#517 子 4). Runs the bundled MCP server's OWN `--doctor`
//! (src/mcp/doctor.ts): the diagnosis — discover probe, initialize, tools/list, mode/--root — exists only there
//! (R8); this command just starts it and hands back what it printed.
//!
//! The program is the bundled node + cli.cjs from the same install facts as the registration
//! (`collab::install_info`), not the `slidecraft-mcp` launcher: a Finder/Explorer-launched GUI often lacks the
//! user's PATH (the #519 gap), and the doctor then spawns that same node + cli.cjs as the server under test.
//! The webview sends no strings (no arbitrary-exec port). If the GUI's collab host is running, the spawned
//! server discovers it and the report says "forward" — which is exactly what a client would get right now.

use std::process::Command;
use std::time::Duration;

use serde::Serialize;

use crate::claude_register::run_captured;
use crate::collab::install_info;

/// The doctor waits up to 10 s per step (3 steps) plus startup; this only guards a genuine hang.
const DOCTOR_TIMEOUT: Duration = Duration::from_secs(60);

/// Program + arguments for the doctor run. Pure (unit-tested).
pub fn doctor_command(node_path: &str, cli_path: &str) -> (String, Vec<String>) {
    (node_path.to_string(), vec![cli_path.to_string(), "--doctor".to_string()])
}

/// The run's result — never-silent: exit code + both streams, or why nothing ran.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind")]
pub enum DoctorOutcome {
    #[serde(rename = "ran")]
    Ran {
        program: String,
        args: Vec<String>,
        /// 0 = a client can connect; 1 = a step failed (the report says which); `None` = killed / timed out.
        #[serde(rename = "exitCode")]
        exit_code: Option<i32>,
        stdout: String,
        stderr: String,
        #[serde(rename = "timedOut")]
        timed_out: bool,
    },
    #[serde(rename = "spawnFailed")]
    SpawnFailed { program: String, args: Vec<String>, error: String },
}

fn run_doctor(program: String, args: Vec<String>) -> DoctorOutcome {
    let mut cmd = Command::new(&program);
    cmd.args(&args);
    match run_captured(cmd, DOCTOR_TIMEOUT) {
        Ok(c) => DoctorOutcome::Ran {
            program,
            args,
            exit_code: c.exit_code,
            stdout: c.stdout,
            stderr: c.stderr,
            timed_out: c.timed_out,
        },
        Err(error) => DoctorOutcome::SpawnFailed { program, args, error },
    }
}

/// 接続テスト: run `<bundled node> <cli.cjs> --doctor`. Read-only for the user's config (writes nothing);
/// off the core thread because it waits on a child for a few seconds.
#[tauri::command]
pub async fn mcp_doctor(app: tauri::AppHandle) -> Result<DoctorOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let info = install_info(&app)?;
        let (program, args) = doctor_command(&info.node_path, &info.cli_path);
        Ok(run_doctor(program, args))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn doctor_command_is_node_cli_and_the_flag() {
        assert_eq!(
            doctor_command("C:\\SlideCraft\\node.exe", "C:\\SlideCraft\\cli.cjs"),
            ("C:\\SlideCraft\\node.exe".to_string(), vec!["C:\\SlideCraft\\cli.cjs".to_string(), "--doctor".to_string()])
        );
    }

    #[cfg(unix)]
    #[test]
    fn run_doctor_returns_exit_code_and_streams() {
        let o = run_doctor("/bin/sh".into(), vec!["-c".into(), "echo report; echo note >&2; exit 1".into()]);
        assert_eq!(
            o,
            DoctorOutcome::Ran {
                program: "/bin/sh".into(),
                args: vec!["-c".into(), "echo report; echo note >&2; exit 1".into()],
                exit_code: Some(1),
                stdout: "report\n".into(),
                stderr: "note\n".into(),
                timed_out: false,
            }
        );
    }

    #[test]
    fn run_doctor_reports_a_missing_node_as_spawn_failed() {
        let o = run_doctor("/definitely/not/here/node".into(), vec!["--doctor".into()]);
        assert!(matches!(o, DoctorOutcome::SpawnFailed { .. }), "{o:?}");
    }

    #[test]
    fn outcome_serializes_with_the_ts_field_names() {
        let o = DoctorOutcome::Ran { program: "n".into(), args: vec![], exit_code: Some(0), stdout: "".into(), stderr: "".into(), timed_out: false };
        let v = serde_json::to_value(o).unwrap();
        assert_eq!(v["kind"], "ran");
        assert_eq!(v["exitCode"], 0);
        assert_eq!(v["timedOut"], false);
    }
}
