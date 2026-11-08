//! claude_register.rs — one-click "Claude Code に登録" (#530). Runs `claude mcp add --scope user slidecraft --
//! <server argv>` with arguments built ENTIRELY here: the webview sends no strings (no arbitrary-exec port),
//! it only asks for the plan (read-only, shown in a confirm dialog) and then for the run. Both commands go
//! through the same `build_plan` → the command the user confirmed is the command that runs.
//!
//! The server argv comes from the SAME install facts as the copy path (`collab::install_info`, i.e.
//! `mcp_install_info`), and its rule is locked against the TS copy snippet by a shared fixture
//! (tests/fixtures/mcp-server-argv.json, R8).
//!
//! `--scope user` is fixed: the default (`local`) is keyed to the cwd, and a GUI's cwd is wherever the OS
//! launched it from — registering there would land in a project the user never meant.

use std::ffi::OsString;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::collab::{display_path, install_info};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
/// CREATE_NO_WINDOW — `claude.cmd` runs under cmd.exe and `claude.exe` is a console app; neither may flash a
/// console window over the GUI.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// The MCP server name the registration writes (same as the copy snippet).
const SERVER_NAME: &str = "slidecraft";
/// The launcher the installers put on PATH (ADR-0038 D5 / #519).
const LAUNCHER: &str = "slidecraft-mcp";
/// `claude mcp add` returns in ~1s; a hang (e.g. an unexpected prompt) must not leave the UI spinning.
const RUN_TIMEOUT: Duration = Duration::from_secs(60);
/// Cap on each of stdout/stderr shown in the panel (the tail is replaced by a marker, never silently cut).
const OUTPUT_CAP: usize = 16 * 1024;

/// What a registration points the MCP client at. Launcher on PATH → the one word; otherwise the bundled
/// node + cli.cjs real paths. Mirrors TS `serverArgv` (collab-panel-snippets.ts) — locked by the fixture.
pub fn server_argv(launcher_on_path: bool, node_path: &str, cli_path: &str) -> Vec<String> {
    if launcher_on_path {
        vec![LAUNCHER.to_string()]
    } else {
        vec![node_path.to_string(), cli_path.to_string()]
    }
}

/// The full argument list given to `claude` (program excluded). `--scope user` is fixed (module doc).
pub fn register_args(server: &[String]) -> Vec<String> {
    let mut args: Vec<String> = ["mcp", "add", "--scope", "user", SERVER_NAME, "--"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    args.extend(server.iter().cloned());
    args
}

/// File names that count as the Claude Code CLI. Windows: the native installer's `claude.exe` first, then
/// npm's `claude.cmd` (spawnable directly — Rust's std runs `.cmd` via cmd.exe with argument escaping; no
/// `cmd /c` of our own, confirmed on a Windows 11 install in PR #529). POSIX: `claude`.
fn claude_candidates(windows: bool) -> &'static [&'static str] {
    if windows {
        &["claude.exe", "claude.cmd"]
    } else {
        &["claude"]
    }
}

/// Install locations of Claude Code that a GUI-launched process's PATH commonly lacks (a Finder/Explorer
/// launch does not inherit the interactive shell's PATH — the same gap #519 hit for the launcher).
/// Appended AFTER the process PATH, so the user's own PATH order still wins.
fn claude_extra_dirs(windows: bool, home: Option<&Path>, appdata: Option<&Path>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if windows {
        if let Some(h) = home {
            dirs.push(h.join(".local").join("bin")); // native installer
        }
        if let Some(a) = appdata {
            dirs.push(a.join("npm")); // npm -g
        }
    } else {
        if let Some(h) = home {
            dirs.push(h.join(".local").join("bin")); // native installer
            dirs.push(h.join(".claude").join("local")); // legacy local install
        }
        for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
            dirs.push(PathBuf::from(d));
        }
    }
    dirs
}

/// First `dir/name` that exists, dirs in order and names in candidate order within each dir.
/// `is_file` is injected so the search is unit-testable without touching the disk.
fn find_in_dirs(dirs: &[PathBuf], names: &[&str], is_file: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    dirs.iter()
        .flat_map(|d| names.iter().map(move |n| d.join(n)))
        .find(|p| is_file(p))
}

/// The PATH handed to `claude`: the process PATH, then the directory `claude` was found in, then the extra
/// dirs — deduplicated, order kept. npm's `claude` is `#!/usr/bin/env node`, so without its own directory a
/// Finder-launched GUI would get "env: node: No such file or directory". `None` = keep the inherited PATH
/// (a directory name that cannot be joined into PATH is left out by the OS rules, so we do not guess).
fn child_path(inherited: &[PathBuf], claude_dir: Option<&Path>, extra: &[PathBuf]) -> Option<OsString> {
    let mut all: Vec<PathBuf> = Vec::new();
    for d in inherited.iter().map(PathBuf::as_path).chain(claude_dir).chain(extra.iter().map(PathBuf::as_path)) {
        if !all.iter().any(|x| x == d) {
            all.push(d.to_path_buf());
        }
    }
    std::env::join_paths(all).ok()
}

/// What the webview shows in the confirm dialog, or why there is nothing to run.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind")]
pub enum RegisterPlan {
    #[serde(rename = "ready")]
    Ready { program: String, args: Vec<String> },
    /// No `claude` in any searched dir → the panel falls back to copying the command and lists `searched`.
    #[serde(rename = "claudeNotFound")]
    ClaudeNotFound { searched: Vec<String> },
}

/// The run's result — never-silent: exit code + both streams, or the reason nothing ran.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind")]
pub enum RegisterOutcome {
    #[serde(rename = "ran")]
    Ran {
        program: String,
        args: Vec<String>,
        /// `None` = killed by a signal or by the timeout.
        #[serde(rename = "exitCode")]
        exit_code: Option<i32>,
        stdout: String,
        stderr: String,
        #[serde(rename = "timedOut")]
        timed_out: bool,
    },
    #[serde(rename = "claudeNotFound")]
    ClaudeNotFound { searched: Vec<String> },
    #[serde(rename = "spawnFailed")]
    SpawnFailed { program: String, args: Vec<String>, error: String },
}

struct Resolved {
    claude: Option<PathBuf>,
    searched: Vec<PathBuf>,
    extra: Vec<PathBuf>,
    inherited: Vec<PathBuf>,
    args: Vec<String>,
}

/// The ONE resolution both commands use (plan for the dialog, run for the execution).
fn resolve(app: &tauri::AppHandle) -> Result<Resolved, String> {
    let info = install_info(app)?;
    let args = register_args(&server_argv(info.launcher_on_path, &info.node_path, &info.cli_path));
    let windows = cfg!(windows);
    let inherited: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    let home = std::env::var_os(if windows { "USERPROFILE" } else { "HOME" }).map(PathBuf::from);
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from);
    let extra = claude_extra_dirs(windows, home.as_deref(), appdata.as_deref());
    let searched: Vec<PathBuf> = inherited.iter().chain(extra.iter()).cloned().collect();
    let claude = find_in_dirs(&searched, claude_candidates(windows), |p| p.is_file());
    Ok(Resolved { claude, searched, extra, inherited, args })
}

fn plan_of(r: &Resolved) -> RegisterPlan {
    match &r.claude {
        Some(p) => RegisterPlan::Ready { program: display_path(p), args: r.args.clone() },
        None => RegisterPlan::ClaudeNotFound { searched: r.searched.iter().map(|d| display_path(d)).collect() },
    }
}

/// Read-only: the exact command a click would run (or why none). Executes and writes nothing.
#[tauri::command]
pub fn claude_register_plan(app: tauri::AppHandle) -> Result<RegisterPlan, String> {
    Ok(plan_of(&resolve(&app)?))
}

/// Run the registration. Called only after the user confirmed the plan in the dialog. Off the core thread
/// (it waits on a child process for up to RUN_TIMEOUT).
#[tauri::command]
pub async fn register_claude_code(app: tauri::AppHandle) -> Result<RegisterOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let r = resolve(&app)?;
        Ok(match plan_of(&r) {
            RegisterPlan::ClaudeNotFound { searched } => RegisterOutcome::ClaudeNotFound { searched },
            RegisterPlan::Ready { program, args } => {
                let exe = r.claude.as_deref().unwrap_or_else(|| Path::new(&program));
                let path = child_path(&r.inherited, exe.parent(), &r.extra);
                run(exe, program.clone(), args, path)
            }
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn run(exe: &Path, program: String, args: Vec<String>, path: Option<OsString>) -> RegisterOutcome {
    let mut cmd = Command::new(exe);
    cmd.args(&args);
    if let Some(p) = path {
        cmd.env("PATH", p);
    }
    match run_captured(cmd, RUN_TIMEOUT) {
        Ok(c) => RegisterOutcome::Ran {
            program,
            args,
            exit_code: c.exit_code,
            stdout: c.stdout,
            stderr: c.stderr,
            timed_out: c.timed_out,
        },
        Err(error) => RegisterOutcome::SpawnFailed { program, args, error },
    }
}

/// A finished (or timed-out) child: exit code + both streams, each capped by `cap_output`.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Captured {
    /// `None` = killed by a signal or by the timeout.
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

/// Run `cmd` with no stdin and both streams captured, killing it after `timeout`. No console window on
/// Windows. `Err` = it could not be spawned or waited on (the OS error text). Shared by the one-click register
/// and the 接続テスト (mcp_doctor.rs, #517) so both report a child the same way.
pub(crate) fn run_captured(mut cmd: Command, timeout: Duration) -> Result<Captured, String> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let out = child.stdout.take().map(drain);
    let err = child.stderr.take().map(drain);
    let deadline = Instant::now() + timeout;
    let (status, timed_out) = loop {
        match child.try_wait() {
            Ok(Some(s)) => break (Some(s), false),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            Ok(None) => {
                let _ = child.kill();
                break (child.wait().ok(), true);
            }
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(e.to_string());
            }
        }
    };
    let collect = |h: Option<std::thread::JoinHandle<String>>| h.and_then(|h| h.join().ok()).unwrap_or_default();
    Ok(Captured {
        exit_code: if timed_out { None } else { status.and_then(|s| s.code()) },
        stdout: collect(out),
        stderr: collect(err),
        timed_out,
    })
}

/// Read a child pipe to the end on its own thread (a full pipe must never block the child).
fn drain<R: Read + Send + 'static>(mut r: R) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = r.read_to_end(&mut buf);
        cap_output(&String::from_utf8_lossy(&buf))
    })
}

/// Keep at most OUTPUT_CAP bytes (on a char boundary) and SAY that the rest was cut.
fn cap_output(s: &str) -> String {
    if s.len() <= OUTPUT_CAP {
        return s.to_string();
    }
    let mut end = OUTPUT_CAP;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n…（{} バイト省略）", &s[..end], s.len() - end)
}

#[cfg(test)]
#[path = "claude_register_tests.rs"]
mod tests;
