//! Unit tests for claude_register.rs (#530). Pure pieces only — argv building, the `claude` search, the
//! child PATH and the output cap — so every OS branch runs on any host. Plus `run()` against a real tiny
//! program on POSIX (exit code + both streams are reported, never swallowed).

use super::*;
use std::collections::HashSet;

#[derive(serde::Deserialize)]
struct Fixture {
    cases: Vec<Case>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    name: String,
    launcher_on_path: bool,
    node_path: String,
    cli_path: String,
    expected: Vec<String>,
}

// R8 agreement: the same fixture is asserted by tests/claude-register.test.ts against TS `serverArgv`
// (the copy snippet) — the one-click run and the copied command point at the same server.
#[test]
fn server_argv_matches_the_shared_fixture() {
    let f: Fixture = serde_json::from_str(include_str!("../../tests/fixtures/mcp-server-argv.json")).unwrap();
    assert!(f.cases.len() >= 4);
    for c in f.cases {
        assert_eq!(server_argv(c.launcher_on_path, &c.node_path, &c.cli_path), c.expected, "{}", c.name);
    }
}

#[test]
fn register_args_fix_the_user_scope_and_append_the_server_after_the_separator() {
    let launcher = register_args(&server_argv(true, "n", "c"));
    assert_eq!(launcher, ["mcp", "add", "--scope", "user", "slidecraft", "--", "slidecraft-mcp"]);

    let real = register_args(&server_argv(false, r"C:\Program Files\SlideCraft\node.exe", r"C:\Program Files\SlideCraft\cli.cjs"));
    assert_eq!(
        real,
        ["mcp", "add", "--scope", "user", "slidecraft", "--", r"C:\Program Files\SlideCraft\node.exe", r"C:\Program Files\SlideCraft\cli.cjs"]
    );
    // A path with spaces stays ONE argv element — no shell is involved, so no quoting is added.
    assert!(real.iter().all(|a| !a.starts_with('"') && !a.starts_with('\'')));
}

#[test]
fn claude_candidates_per_os() {
    assert_eq!(claude_candidates(true), ["claude.exe", "claude.cmd"]);
    assert_eq!(claude_candidates(false), ["claude"]);
}

#[test]
fn extra_dirs_windows_cover_native_and_npm_installs() {
    let d = claude_extra_dirs(true, Some(Path::new(r"C:\Users\a")), Some(Path::new(r"C:\Users\a\AppData\Roaming")));
    assert_eq!(d, [Path::new(r"C:\Users\a").join(".local").join("bin"), Path::new(r"C:\Users\a\AppData\Roaming").join("npm")]);
    assert!(claude_extra_dirs(true, None, None).is_empty());
}

#[test]
fn extra_dirs_posix_cover_native_legacy_and_package_manager_dirs() {
    let d = claude_extra_dirs(false, Some(Path::new("/Users/a")), None);
    assert_eq!(
        d,
        [
            PathBuf::from("/Users/a/.local/bin"),
            PathBuf::from("/Users/a/.claude/local"),
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/usr/bin"),
        ]
    );
    // No HOME → still the system dirs, never a relative ".local/bin".
    assert_eq!(claude_extra_dirs(false, None, None).len(), 3);
}

#[test]
fn find_in_dirs_respects_dir_order_then_candidate_order() {
    let dirs = [PathBuf::from("/a"), PathBuf::from("/b")];
    let present: HashSet<PathBuf> = [PathBuf::from("/b/claude.exe"), PathBuf::from("/a/claude.cmd")].into();
    // /a comes first in PATH, so its claude.cmd wins over /b's claude.exe.
    assert_eq!(find_in_dirs(&dirs, &["claude.exe", "claude.cmd"], |p| present.contains(p)), Some(PathBuf::from("/a/claude.cmd")));
    let both: HashSet<PathBuf> = [PathBuf::from("/a/claude.exe"), PathBuf::from("/a/claude.cmd")].into();
    assert_eq!(find_in_dirs(&dirs, &["claude.exe", "claude.cmd"], |p| both.contains(p)), Some(PathBuf::from("/a/claude.exe")));
    assert_eq!(find_in_dirs(&dirs, &["claude"], |_| false), None);
}

#[test]
fn child_path_keeps_the_inherited_order_then_adds_claude_dir_and_extras_once() {
    let inherited = [PathBuf::from("/usr/bin"), PathBuf::from("/bin")];
    let extra = [PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/usr/bin")];
    let p = child_path(&inherited, Some(Path::new("/opt/homebrew/bin")), &extra).unwrap();
    let got: Vec<PathBuf> = std::env::split_paths(&p).collect();
    assert_eq!(got, [PathBuf::from("/usr/bin"), PathBuf::from("/bin"), PathBuf::from("/opt/homebrew/bin")]);
}

#[test]
fn plan_of_reports_the_exact_program_and_args_or_the_searched_dirs() {
    let r = Resolved {
        claude: Some(PathBuf::from("/opt/homebrew/bin/claude")),
        searched: vec![PathBuf::from("/usr/bin")],
        extra: vec![],
        inherited: vec![],
        args: register_args(&server_argv(true, "", "")),
    };
    assert_eq!(
        plan_of(&r),
        RegisterPlan::Ready { program: "/opt/homebrew/bin/claude".into(), args: r.args.clone() }
    );
    let none = Resolved { claude: None, ..r };
    assert_eq!(plan_of(&none), RegisterPlan::ClaudeNotFound { searched: vec!["/usr/bin".into()] });
}

#[test]
fn plan_and_outcome_serialize_with_the_kind_tag_the_webview_reads() {
    let plan = serde_json::to_value(RegisterPlan::Ready { program: "claude".into(), args: vec!["mcp".into()] }).unwrap();
    assert_eq!(plan, serde_json::json!({"kind": "ready", "program": "claude", "args": ["mcp"]}));
    let nf = serde_json::to_value(RegisterOutcome::ClaudeNotFound { searched: vec!["/x".into()] }).unwrap();
    assert_eq!(nf, serde_json::json!({"kind": "claudeNotFound", "searched": ["/x"]}));
    let ran = serde_json::to_value(RegisterOutcome::Ran {
        program: "claude".into(),
        args: vec![],
        exit_code: Some(1),
        stdout: "o".into(),
        stderr: "e".into(),
        timed_out: false,
    })
    .unwrap();
    assert_eq!(
        ran,
        serde_json::json!({"kind": "ran", "program": "claude", "args": [], "exitCode": 1, "stdout": "o", "stderr": "e", "timedOut": false})
    );
    let sf = serde_json::to_value(RegisterOutcome::SpawnFailed { program: "p".into(), args: vec![], error: "x".into() }).unwrap();
    assert_eq!(sf, serde_json::json!({"kind": "spawnFailed", "program": "p", "args": [], "error": "x"}));
}

#[test]
fn cap_output_says_how_much_was_cut_and_keeps_utf8_intact() {
    assert_eq!(cap_output("short"), "short");
    let long = "あ".repeat(OUTPUT_CAP); // 3 bytes each → well over the cap
    let capped = cap_output(&long);
    assert!(capped.len() < long.len());
    assert!(capped.contains("バイト省略"));
    assert!(capped.starts_with("あ"));
}

#[cfg(unix)]
#[test]
fn run_reports_exit_code_and_both_streams() {
    let args = vec!["-c".to_string(), "echo out; echo err >&2; exit 3".to_string()];
    let o = run(Path::new("/bin/sh"), "/bin/sh".into(), args.clone(), None);
    assert_eq!(
        o,
        RegisterOutcome::Ran { program: "/bin/sh".into(), args, exit_code: Some(3), stdout: "out\n".into(), stderr: "err\n".into(), timed_out: false }
    );
}

#[test]
fn run_reports_a_missing_program_as_spawn_failed() {
    let o = run(Path::new("/definitely/not/here/claude"), "claude".into(), vec![], None);
    assert!(matches!(o, RegisterOutcome::SpawnFailed { .. }), "{o:?}");
}
