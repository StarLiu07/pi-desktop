//! Project (workspace folder) management, codex/zcode style.
//!
//! A project is simply the working directory the pi subprocess runs in: pi's
//! bash/read/write tools and AGENTS.md/CLAUDE.md loading all follow the
//! process cwd, and every session file records its cwd in the header. The pi
//! RPC protocol has no "set cwd" command, so switching projects restarts the
//! subprocess with a new `current_dir`.
//!
//! State is persisted in `<appdata>/pi-desktop/projects.json`:
//! `{ "current": <abs path>, "recent": [<abs paths, newest first>] }`.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// Keep at most this many recent projects in the menu.
const MAX_RECENT: usize = 8;

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct ProjectConfig {
    pub current: Option<String>,
    pub recent: Vec<String>,
}

/// Shape returned to the frontend (recent list pruned of dead folders).
#[derive(Serialize, Clone)]
pub struct ProjectsState {
    pub current: Option<String>,
    pub recent: Vec<String>,
}

fn config_dir() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        Path::new(&appdata).join("pi-desktop")
    } else {
        PathBuf::from(".")
    }
}

fn config_path() -> PathBuf {
    config_dir().join("projects.json")
}

/// Load the project config; a missing/corrupt file behaves like a fresh install.
pub fn load_config() -> ProjectConfig {
    let path = config_path();
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => ProjectConfig::default(),
    }
}

fn save_config(cfg: &ProjectConfig) -> Result<(), String> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败: {}", e))?;
    let s = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(config_path(), s).map_err(|e| format!("写入配置失败: {}", e))
}

/// Record `dir` as the most recent project (pure, for tests).
fn remember(cfg: &mut ProjectConfig, dir: &str) {
    cfg.recent.retain(|d| d != dir);
    cfg.recent.insert(0, dir.to_string());
    cfg.recent.truncate(MAX_RECENT);
    cfg.current = Some(dir.to_string());
}

/// Drop projects whose folder no longer exists on disk.
fn prune(cfg: &mut ProjectConfig) {
    cfg.recent.retain(|d| Path::new(d).is_dir());
    if let Some(cur) = &cfg.current {
        if !Path::new(cur).is_dir() {
            cfg.current = None;
        }
    }
}

/// Current project + recent projects (both pruned of missing folders).
#[tauri::command]
pub fn list_projects() -> Result<ProjectsState, String> {
    let mut cfg = load_config();
    prune(&mut cfg);
    Ok(ProjectsState {
        current: cfg.current.clone(),
        recent: cfg.recent.clone(),
    })
}

/// Switch the project: persist it and restart pi with the new working
/// directory. An empty `dir` switches to *no project* — pi runs with its
/// default cwd and conversations are not bound to a folder. The frontend
/// re-initializes after this returns.
#[tauri::command]
pub fn set_project(app: AppHandle, dir: String) -> Result<(), String> {
    let dir = dir.trim().to_string();
    if dir.is_empty() {
        let mut cfg = load_config();
        if cfg.current.is_none() {
            return Ok(()); // already project-less
        }
        cfg.current = None; // keep `recent` so projects stay one click away
        save_config(&cfg)?;
        let _ = crate::pi::stop_pi(app.clone());
        return crate::pi::start_pi_with_cwd(app, None);
    }
    if !Path::new(&dir).is_dir() {
        return Err(format!("目录不存在: {}", dir));
    }
    let mut cfg = load_config();
    if cfg.current.as_deref() == Some(dir.as_str()) {
        return Ok(()); // already on this project
    }
    remember(&mut cfg, &dir);
    save_config(&cfg)?;
    // Restart pi with the new cwd — the running process keeps its old one.
    let _ = crate::pi::stop_pi(app.clone());
    crate::pi::start_pi_with_cwd(app, Some(Path::new(&dir)))
}

/// Native folder picker for choosing a new project. Returns the chosen
/// absolute path, or None when the dialog was cancelled.
#[tauri::command]
pub fn pick_project() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("选择项目文件夹")
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string())
}

/// Live validation for the add-project dialog — the frontend (WebView) has no
/// filesystem access, so it asks us whether a typed path exists and is a
/// folder. A relative path is rejected outright.
#[derive(Serialize, Clone)]
pub struct ProjectPathInfo {
    pub exists: bool,
    pub is_dir: bool,
}

#[tauri::command]
pub fn project_path_info(dir: String) -> Result<ProjectPathInfo, String> {
    let p = Path::new(dir.trim());
    if !p.is_absolute() {
        return Err("请输入绝对路径".to_string());
    }
    Ok(ProjectPathInfo {
        exists: p.exists(),
        is_dir: p.is_dir(),
    })
}

/// Create the project folder for a path that doesn't exist yet (the
/// add-project dialog's "创建并添加" flow). Idempotent: an existing folder is
/// a no-op, a non-folder file is an error.
#[tauri::command]
pub fn create_project_dir(dir: String) -> Result<(), String> {
    let p = Path::new(dir.trim());
    if !p.is_absolute() {
        return Err("请输入绝对路径".to_string());
    }
    if p.exists() && !p.is_dir() {
        return Err(format!("路径已存在但不是文件夹: {}", dir));
    }
    std::fs::create_dir_all(p).map_err(|e| format!("创建文件夹失败: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remember_dedupes_and_moves_to_front() {
        let mut cfg = ProjectConfig::default();
        remember(&mut cfg, "/a");
        remember(&mut cfg, "/b");
        remember(&mut cfg, "/a");
        assert_eq!(cfg.current.as_deref(), Some("/a"));
        assert_eq!(cfg.recent, vec!["/a".to_string(), "/b".to_string()]);
    }

    #[test]
    fn remember_caps_recent_list() {
        let mut cfg = ProjectConfig::default();
        for i in 0..20 {
            remember(&mut cfg, &format!("/p{}", i));
        }
        assert_eq!(cfg.recent.len(), MAX_RECENT);
        assert_eq!(cfg.recent.first().map(String::as_str), Some("/p19"));
        assert!(!cfg.recent.contains(&"/p0".to_string()));
    }

    #[test]
    fn prune_drops_missing_dirs() {
        let mut cfg = ProjectConfig {
            current: Some("/definitely/not/a/dir".to_string()),
            recent: vec![
                "/definitely/not/a/dir".to_string(),
                std::env::current_dir().unwrap().to_string_lossy().to_string(),
            ],
        };
        prune(&mut cfg);
        assert_eq!(cfg.current, None);
        assert_eq!(cfg.recent.len(), 1);
    }

    /// Unique scratch dir for the filesystem tests (no tempfile dependency).
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pi-desktop-test-{}-{}",
            std::process::id(),
            name
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn path_info_distinguishes_kinds() {
        let dir = scratch("pathinfo");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.txt");
        std::fs::write(&file, "x").unwrap();

        let info = project_path_info(dir.to_string_lossy().to_string()).unwrap();
        assert!(info.exists && info.is_dir);
        let info = project_path_info(file.to_string_lossy().to_string()).unwrap();
        assert!(info.exists && !info.is_dir);
        let info = project_path_info(dir.join("missing").to_string_lossy().to_string()).unwrap();
        assert!(!info.exists && !info.is_dir);
        assert!(project_path_info("relative/path".to_string()).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn create_dir_makes_missing_folder_and_is_idempotent() {
        let dir = scratch("createdir");
        assert!(!dir.exists());
        create_project_dir(dir.to_string_lossy().to_string()).unwrap();
        assert!(dir.is_dir());
        // Idempotent second call.
        create_project_dir(dir.to_string_lossy().to_string()).unwrap();
        // A file in the way is an error.
        let file = dir.join("a.txt");
        std::fs::write(&file, "x").unwrap();
        assert!(create_project_dir(file.to_string_lossy().to_string()).is_err());
        assert!(create_project_dir("relative/path".to_string()).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
