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
use std::sync::Mutex;
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
fn find_pi_entry() -> Option<String> {
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

/// Default session directory for desktop sessions, kept separate from CLI sessions.
fn default_session_dir() -> String {
    if let Ok(appdata) = std::env::var("APPDATA") {
        return format!("{}\\pi-desktop\\sessions", appdata);
    }
    "pi-desktop-sessions".to_string()
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
#[tauri::command]
pub fn list_sessions(_app: AppHandle) -> Result<Vec<SessionMeta>, String> {
    let dir = default_session_dir();
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
    out.sort_by(|a, b| b.file.cmp(&a.file));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_jsonl_lines() {
        assert_eq!(parse_line("{\"type\":\"x\"}"), Some(json!({"type": "x"})));
        assert_eq!(parse_line("  {\"a\":1}  "), Some(json!({"a": 1})));
        assert_eq!(parse_line(""), None);
        assert_eq!(parse_line("\n"), None);
        assert_eq!(parse_line("not json"), None);
    }
}
