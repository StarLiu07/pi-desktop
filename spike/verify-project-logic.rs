// Standalone verification of project.rs' new pure functions
// (project_path_info / create_project_dir) — cargo test binaries crash on
// mingw with 0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND, .text > ~18MB), so the
// logic is re-verified here with plain rustc:
//   rustc spike/verify-project-logic.rs -o /tmp/vp.exe && /tmp/vp.exe
// Mirrors src-tauri/src/project.rs (2026-08-14, v0.1.18) exactly.

use std::path::{Path, PathBuf};

struct ProjectPathInfo {
    exists: bool,
    is_dir: bool,
}

fn project_path_info(dir: &str) -> Result<ProjectPathInfo, String> {
    let p = Path::new(dir.trim());
    if !p.is_absolute() {
        return Err("请输入绝对路径".to_string());
    }
    Ok(ProjectPathInfo {
        exists: p.exists(),
        is_dir: p.is_dir(),
    })
}

fn create_project_dir(dir: &str) -> Result<(), String> {
    let p = Path::new(dir.trim());
    if !p.is_absolute() {
        return Err("请输入绝对路径".to_string());
    }
    if p.exists() && !p.is_dir() {
        return Err(format!("路径已存在但不是文件夹: {}", dir));
    }
    std::fs::create_dir_all(p).map_err(|e| format!("创建文件夹失败: {}", e))
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "pi-desktop-test-{}-{}",
        std::process::id(),
        name
    ));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

fn main() {
    // path_info_distinguishes_kinds
    let dir = scratch("pathinfo");
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("a.txt");
    std::fs::write(&file, "x").unwrap();

    let info = project_path_info(&dir.to_string_lossy()).unwrap();
    assert!(info.exists && info.is_dir, "dir should exist+is_dir");
    let info = project_path_info(&file.to_string_lossy()).unwrap();
    assert!(info.exists && !info.is_dir, "file should exist+not dir");
    let info = project_path_info(&dir.join("missing").to_string_lossy()).unwrap();
    assert!(!info.exists && !info.is_dir, "missing should be neither");
    assert!(
        project_path_info("relative/path").is_err(),
        "relative path must be rejected"
    );

    // create_dir_makes_missing_folder_and_is_idempotent
    let nd = scratch("createdir");
    assert!(!nd.exists());
    create_project_dir(&nd.to_string_lossy()).unwrap();
    assert!(nd.is_dir(), "folder should be created");
    create_project_dir(&nd.to_string_lossy()).unwrap(); // idempotent
    let file2 = nd.join("a.txt");
    std::fs::write(&file2, "x").unwrap();
    assert!(
        create_project_dir(&file2.to_string_lossy()).is_err(),
        "file in the way must error"
    );
    assert!(
        create_project_dir("relative/path").is_err(),
        "relative path must be rejected"
    );

    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_dir_all(&nd);
    println!("project logic verification PASSED");
}
