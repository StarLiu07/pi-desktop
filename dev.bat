@echo off
rem Pi Desktop launcher (Windows)
rem Adds the Rust + mingw toolchain to PATH, then starts the app in dev mode.
set PATH=%USERPROFILE%\.cargo\bin;C:\msys64\mingw64\bin;%PATH%
cd /d %~dp0
npm run tauri dev
pause
