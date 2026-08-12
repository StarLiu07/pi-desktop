#!/usr/bin/env bash
# Pi Desktop launcher (Git Bash)
# Adds the Rust + mingw toolchain to PATH, then starts the app in dev mode.
export PATH="$HOME/.cargo/bin:/c/msys64/mingw64/bin:$PATH"
cd "$(dirname "$0")"
npm run tauri dev
