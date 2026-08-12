//! Pi RPC bridge: spawns the `pi` CLI in RPC mode and relays JSONL events to the frontend.
//!
//! Protocol (calibrated against pi 0.83.0 with real probes in spike/):
//! - requests:  one JSON object per line on stdin  `{"id", "type": <command>, ...}`
//! - responses: `{"id", "type": "response", "command", "success", "data", "error?"}`
//! - events:    `{"type": <event_name>, ...}` streamed on stdout

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager};

/// Frontend event emitted for every JSONL message pi writes to stdout.
pub const EVENT: &str = "pi-event";

/// Live pi child process with a write handle to its stdin.
pub struct PiProcess {
    child: Child,
    stdin: ChildStdin,
}

/// Managed Tauri state: the (optional) running pi process.
pub struct PiState(pub Mutex<Option<PiProcess>>);

impl Default for PiState {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

/// Locate the pi CLI's JS entry point (`dist/cli.js`) by probing common locations.
///
/// `npm root -g` takes ~200ms on Windows and is called on every startup screen
/// check, so cache a *hit* for the process lifetime. Misses are never cached —
/// the user may install pi and hit "我已安装，重试".
static PI_ENTRY: OnceLock<Option<String>> = OnceLock::new();

fn find_pi_entry() -> Option<String> {
    PI_ENTRY.get_or_init(find_pi_entry_uncached).clone()
}

fn find_pi_entry_uncached() -> Option<String> {
    // 1. explicit override
    if let Ok(p) = std::env::var("PI_DESKTOP_PI_ENTRY") {
        if Path::new(&p).exists() {
            return Some(p);
        }
    }
    // 2. global npm root. On Windows npm is npm.cmd (a batch file) — CreateProcess
    //    does not resolve `.cmd`, so spell the file name out per platform.
    let npm = if cfg!(windows) { "npm.cmd" } else { "npm" };
    if let Ok(out) = Command::new(npm).arg("root").arg("-g").output() {
        if out.status.success() {
            let root = String::from_utf8_lossy(&out.stdout).trim().to_string();
            for pkg in [
                "@earendil-works/pi-coding-agent",
                "@mariozechner/pi-coding-agent",
            ] {
                let candidate = Path::new(&root).join(pkg).join("dist").join("cli.js");
                if candidate.exists() {
                    return Some(candidate.to_string_lossy().to_string());
                }
            }
        }
    }
    None
}

/// Desktop session directory. New sessions are created here (the pi subprocess
/// gets `--session-dir`); pi CLI sessions are synced into it on listing.
fn default_session_dir() -> String {
    if let Ok(appdata) = std::env::var("APPDATA") {
        return format!("{}\\pi-desktop\\sessions", appdata);
    }
    "pi-desktop-sessions".to_string()
}

/// Resolve where the pi CLI keeps its sessions when not given an explicit
/// `--session-dir`. Mirrors pi's own resolution (config.js):
/// `$PI_CODING_AGENT_SESSION_DIR` → `$PI_CODING_AGENT_DIR/sessions` →
/// `<home>/.pi/agent/sessions` (sessions live in cwd-encoded subdirs there).
fn pi_cli_sessions_root() -> Option<String> {
    if let Ok(dir) = std::env::var("PI_CODING_AGENT_SESSION_DIR") {
        if !dir.is_empty() {
            return Some(dir);
        }
    }
    if let Ok(dir) = std::env::var("PI_CODING_AGENT_DIR") {
        if !dir.is_empty() {
            return Some(Path::new(&dir).join("sessions").to_string_lossy().to_string());
        }
    }
    let home = if cfg!(windows) {
        std::env::var("USERPROFILE")
    } else {
        std::env::var("HOME")
    }
    .ok()?;
    Some(Path::new(&home).join(".pi").join("agent").join("sessions").to_string_lossy().to_string())
}

/// Copy sessions created by the pi CLI (pre-desktop conversations) into the
/// desktop session dir, so the history tree shows them alongside desktop
/// sessions. Sessions may live in nested cwd-encoded subdirs, so walk
/// recursively.
///
/// Idempotent: only files missing from the destination are copied and existing
/// files are never overwritten — once a session is continued in the desktop,
/// its desktop copy becomes the canonical file. Returns the number of files
/// imported.
fn sync_cli_sessions_into(desktop_dir: &Path, cli_root: &Path) -> Result<usize, String> {
    if !cli_root.is_dir() {
        return Ok(0); // pi CLI never used — nothing to import
    }
    std::fs::create_dir_all(desktop_dir).map_err(|e| format!("创建会话目录失败: {}", e))?;
    let mut imported = 0;
    let mut stack = vec![cli_root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let read_dir = std::fs::read_dir(&dir).map_err(|e| format!("读取 {} 失败: {}", dir.display(), e))?;
        for entry in read_dir.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                let dest = desktop_dir.join(entry.file_name());
                if !dest.exists() {
                    std::fs::copy(&path, &dest)
                        .map_err(|e| format!("复制会话 {} 失败: {}", path.display(), e))?;
                    imported += 1;
                }
            }
        }
    }
    Ok(imported)
}

/// Parse a single JSONL line into a Value, tolerating surrounding whitespace.
fn parse_line(line: &str) -> Option<Value> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    serde_json::from_str(trimmed).ok()
}

/// Start the pi CLI subprocess in RPC mode. Returns an error string on failure.
/// On success, spawns reader threads that relay pi's stdout (JSONL events) and
/// stderr (free-form logs) to the frontend as `pi-event` / `pi-stderr` events.
#[tauri::command]
pub fn start_pi(app: AppHandle) -> Result<(), String> {
    let state = app.state::<PiState>();
    {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Err("pi 已经在运行".to_string());
        }
    }

    let entry = find_pi_entry().ok_or_else(|| {
        eprintln!("[pi] find_pi_entry failed");
        "未找到 pi CLI。请先安装：npm install -g @earendil-works/pi-coding-agent".to_string()
    })?;
    let session_dir = default_session_dir();
    eprintln!("[pi] entry: {}", entry);
    eprintln!("[pi] session-dir: {}", session_dir);
    if let Err(e) = std::fs::create_dir_all(&session_dir) {
        eprintln!("[pi] create_dir_all failed: {}", e);
        return Err(format!("无法创建会话目录 {}: {}", session_dir, e));
    }

    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut c = Command::new("node");
        c.creation_flags(CREATE_NO_WINDOW);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = Command::new("node");

    let mut child = cmd
        .args([&entry, "--mode", "rpc", "--session-dir", &session_dir])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            eprintln!("[pi] spawn failed: {}", e);
            format!("无法启动 pi: {}", e)
        })?;
    eprintln!("[pi] spawned pid {}", child.id());

    let (stdout, stderr) = match (child.stdout.take(), child.stderr.take()) {
        (Some(o), Some(e)) => (o, e),
        _ => return Err("无法捕获 pi 输出".to_string()),
    };

    {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        *guard = Some(PiProcess {
            stdin: child.stdin.take().ok_or("无法捕获 pi 输入")?,
            child,
        });
    }

    // stdout: JSONL events -> `pi-event`
    let app2 = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(l) => {
                    if let Some(v) = parse_line(&l) {
                        let _ = app2.emit(EVENT, v);
                    }
                }
                Err(_) => break,
            }
        }
        // EOF means pi exited (or crashed) — tell the frontend to reconnect.
        let _ = app2.emit(EVENT, json!({"type": "pi_exit"}));
    });

    // stderr: free-form logs (e.g. provider catalogs) -> `pi-stderr`
    let app3 = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(l) = line {
                let _ = app3.emit("pi-stderr", l);
            }
        }
    });

    Ok(())
}

/// Send a single JSONL request to pi's stdin.
#[tauri::command]
pub fn send_rpc(app: AppHandle, request: Value) -> Result<(), String> {
    let state = app.state::<PiState>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let pi = guard.as_mut().ok_or("pi 未运行")?;
    let line = serde_json::to_string(&request).map_err(|e| e.to_string())?;
    pi.stdin
        .write_all(line.as_bytes())
        .and_then(|_| pi.stdin.write_all(b"\n"))
        .and_then(|_| pi.stdin.flush())
        .map_err(|e| format!("写入 pi 失败: {}", e))
}

/// Kill the running pi subprocess, if any.
#[tauri::command]
pub fn stop_pi(app: AppHandle) -> Result<(), String> {
    let state = app.state::<PiState>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut pi) = guard.take() {
        let _ = pi.child.kill();
        let _ = pi.child.wait();
    }
    Ok(())
}

/// Whether the pi CLI is installed — drives the setup screen in the frontend.
#[tauri::command]
pub fn pi_installed() -> bool {
    find_pi_entry().is_some()
}

/// Metadata for one session file, used to render the session tree in the sidebar.
#[derive(serde::Serialize)]
pub struct SessionMeta {
    pub id: String,
    pub name: Option<String>,
    pub timestamp: Option<String>,
    pub cwd: Option<String>,
    pub message_count: usize,
    /// File name inside the session dir.
    pub file: String,
    /// Absolute path — `switch_session` requires it (a bare file name is
    /// resolved against the pi process cwd, which points elsewhere).
    pub path: String,
    /// Last USER `message` record id — the `entryId` for the `fork` RPC command.
    pub last_message_id: Option<String>,
}

/// List all session files in the desktop session dir, newest first.
/// pi's RPC has no "list sessions" command, so we scan the session store directly.
/// Before scanning, sessions created by the pi CLI are synced in so history
/// from before the desktop existed shows up too.
#[tauri::command]
pub fn list_sessions(_app: AppHandle) -> Result<Vec<SessionMeta>, String> {
    let dir = default_session_dir();
    if let Some(cli_root) = pi_cli_sessions_root() {
        if let Err(e) = sync_cli_sessions_into(Path::new(&dir), Path::new(&cli_root)) {
            // A sync hiccup must not break history — log and list what we have.
            eprintln!("[pi] cli session sync failed: {}", e);
        }
    }
    let read_dir = std::fs::read_dir(&dir).map_err(|e| format!("读取会话目录失败: {}", e))?;
    let mut out: Vec<SessionMeta> = Vec::new();
    for entry in read_dir.flatten() {
        let path = entry.path();
        let file = entry.file_name().to_string_lossy().to_string();
        if !file.ends_with(".jsonl") {
            continue;
        }
        let mut meta = SessionMeta {
            id: file.trim_end_matches(".jsonl").to_string(),
            name: None,
            timestamp: None,
            cwd: None,
            message_count: 0,
            path: path.to_string_lossy().to_string(),
            file,
            last_message_id: None,
        };
        if let Ok(content) = std::fs::read_to_string(&path) {
            // One pass over the records: session meta (line 1), display name
            // (session_info), last message id (for fork), and message count.
            let mut seen_info = false;
            for (i, line) in content.lines().enumerate() {
                if i == 0 {
                    if let Ok(v) = serde_json::from_str::<Value>(line) {
                        if let Some(id) = v.get("id").and_then(|i| i.as_str()) {
                            meta.id = id.to_string();
                        }
                        if let Some(ts) = v.get("timestamp").and_then(|t| t.as_str()) {
                            meta.timestamp = Some(ts.to_string());
                        }
                        if let Some(cwd) = v.get("cwd").and_then(|c| c.as_str()) {
                            meta.cwd = Some(cwd.to_string());
                        }
                    }
                    continue;
                }
                if let Ok(v) = serde_json::from_str::<Value>(line) {
                    let kind = v.get("type").and_then(|t| t.as_str());
                    match kind {
                        Some("session_info") if !seen_info => {
                            seen_info = true;
                            if let Some(n) = v.get("name").and_then(|n| n.as_str()) {
                                meta.name = Some(n.to_string());
                            }
                        }
                        Some("message") => {
                            // fork's entryId must be the last USER message id
                            // (the branch point), not an assistant reply.
                            let is_user = v
                                .get("message")
                                .and_then(|m| m.get("role"))
                                .and_then(|r| r.as_str())
                                == Some("user");
                            if is_user {
                                if let Some(id) = v.get("id").and_then(|i| i.as_str()) {
                                    meta.last_message_id = Some(id.to_string());
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            meta.message_count = content.lines().count().saturating_sub(1);
        }
        out.push(meta);
    }
    // Newest first. File names are uuids, so compare the parsed session
    // timestamp (line 1 of the file) — fall back to the file name.
    out.sort_by(|a, b| {
        let ta = a.timestamp.as_deref().unwrap_or("");
        let tb = b.timestamp.as_deref().unwrap_or("");
        if !ta.is_empty() || !tb.is_empty() {
            return tb.cmp(ta);
        }
        b.file.cmp(&a.file)
    });
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static TMP_SEQ: AtomicUsize = AtomicUsize::new(0);

    /// Unique temp dir for a test (no tempfile crate dependency).
    fn tmp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pi-desktop-test-{}-{}-{}",
            tag,
            std::process::id(),
            TMP_SEQ.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn parses_jsonl_lines() {
        assert_eq!(parse_line("{\"type\":\"x\"}"), Some(json!({"type": "x"})));
        assert_eq!(parse_line("  {\"a\":1}  "), Some(json!({"a": 1})));
        assert_eq!(parse_line(""), None);
        assert_eq!(parse_line("\n"), None);
        assert_eq!(parse_line("not json"), None);
    }

    #[test]
    fn sync_imports_cli_sessions_idempotently() {
        let root = tmp_dir("sync");
        let cli_root = root.join("cli-root");
        let desktop = root.join("desktop");
        let nested = cli_root.join("--C--Users-Sheldon--");
        std::fs::create_dir_all(&nested).unwrap();

        // A pre-desktop CLI session, nested in a cwd-encoded subdir.
        let cli_session = nested.join("2026-07-22T12-39-14-734Z_019f89d6.jsonl");
        std::fs::write(&cli_session, "{\"type\":\"session\",\"version\":3,\"id\":\"019f89d6\",\"timestamp\":\"2026-07-22T12:39:14.734Z\",\"cwd\":\"C:\\\\Users\\\\Sheldon\"}\n").unwrap();
        // A flat CLI session (e.g. when PI_CODING_AGENT_SESSION_DIR is set).
        let flat_session = cli_root.join("2026-07-30T08-43-18-046Z_019fb231.jsonl");
        std::fs::write(&flat_session, "{\"type\":\"session\",\"version\":3,\"id\":\"019fb231\",\"timestamp\":\"2026-07-30T08:43:18.046Z\"}\n").unwrap();
        // A desktop-created session that must never be touched or re-copied.
        let desktop_session = desktop.join("2026-08-12T12-00-00-000Z_019ff000.jsonl");
        std::fs::create_dir_all(&desktop).unwrap();
        std::fs::write(&desktop_session, "{\"type\":\"session\",\"version\":3,\"id\":\"019ff000\",\"timestamp\":\"2026-08-12T12:00:00.000Z\"}\n").unwrap();

        assert_eq!(sync_cli_sessions_into(&desktop, &cli_root).unwrap(), 2);
        // Second run: nothing left to import.
        assert_eq!(sync_cli_sessions_into(&desktop, &cli_root).unwrap(), 0);
        // Desktop session untouched, imports byte-identical to their sources.
        assert_eq!(
            std::fs::read_to_string(&desktop_session).unwrap(),
            "{\"type\":\"session\",\"version\":3,\"id\":\"019ff000\",\"timestamp\":\"2026-08-12T12:00:00.000Z\"}\n"
        );
        assert_eq!(
            std::fs::read_to_string(desktop.join("2026-07-22T12-39-14-734Z_019f89d6.jsonl")).unwrap(),
            std::fs::read_to_string(&cli_session).unwrap()
        );
        assert!(desktop.join("2026-07-30T08-43-18-046Z_019fb231.jsonl").exists());
        // Missing CLI root is a silent no-op.
        assert_eq!(sync_cli_sessions_into(&desktop, &root.join("nope")).unwrap(), 0);
    }
}
